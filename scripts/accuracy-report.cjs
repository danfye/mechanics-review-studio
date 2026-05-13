const fs = require("node:fs");
const path = require("node:path");
const {
  buildCourseKnowledgeModel,
  evaluateQuestionSet,
  generateCramPack,
  generateQuestionSet,
  localReviewPlan,
} = require("../server.cjs");

const ROOT = path.join(__dirname, "..");
const DEFAULT_FIXTURE_DIR = path.join(ROOT, "fixtures", "accuracy");
const FIXED_NOW = "2026-05-09T00:00:00.000Z";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listFixtureFiles(targets) {
  if (targets.length) {
    return targets.map((target) => path.resolve(process.cwd(), target));
  }
  return fs
    .readdirSync(DEFAULT_FIXTURE_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(DEFAULT_FIXTURE_DIR, name));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function termCoverage(terms, values) {
  const expected = Array.isArray(terms) ? terms.filter(Boolean) : [];
  const haystack = normalizeText(values.join("\n"));
  const hits = expected.filter((term) => haystack.includes(normalizeText(term)));
  return {
    expected: expected.length,
    hit: hits.length,
    ratio: expected.length ? round(hits.length / expected.length) : 1,
    missing: expected.filter((term) => !hits.includes(term)),
  };
}

function sourceRefsOf(item) {
  const direct = item?.source_refs || item?.sourceRefs || [];
  return Array.isArray(direct) ? direct : [];
}

function sourceRefCoverage(items) {
  const list = (items || []).filter(Boolean);
  const withRefs = list.filter((item) => sourceRefsOf(item).length);
  return {
    total: list.length,
    withRefs: withRefs.length,
    ratio: list.length ? round(withRefs.length / list.length) : 1,
  };
}

function validSourceRefs(items, documents) {
  const docsById = new Map((documents || []).map((doc) => [doc.id, doc]));
  const refs = (items || []).flatMap(sourceRefsOf);
  const invalid = refs.filter((ref) => {
    const documentId = ref.document_id || ref.documentId;
    const doc = docsById.get(documentId);
    if (!doc) return true;
    if (ref.unit_index === undefined || ref.unit_index === null) return false;
    const index = Number(ref.unit_index);
    return !Number.isInteger(index) || index < 0 || index >= (doc.units || []).length;
  });
  return {
    total: refs.length,
    valid: refs.length - invalid.length,
    ratio: refs.length ? round((refs.length - invalid.length) / refs.length) : 1,
    invalid: invalid.slice(0, 5),
  };
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function collectModelItems(model) {
  return [
    ...(model.documents || []),
    ...(model.chapters || []),
    ...(model.concepts || []),
    ...(model.formulas || []),
    ...(model.examples || []),
    ...(model.homework_problems || []),
    ...(model.mistake_points || []),
  ];
}

function evaluateMinimums(metrics, minimums = {}) {
  const checks = [
    ["documents", metrics.material.documents, minimums.documents],
    ["concepts", metrics.knowledge.concepts, minimums.concepts],
    ["formulas", metrics.formulas.count, minimums.formulas],
    ["questions", metrics.questions.count, minimums.questions],
    ["planItems", metrics.plan.items, minimums.planItems],
    ["cramFocusTopics", metrics.cram.focusTopics, minimums.cramFocusTopics],
    ["sourceRefCoverage", metrics.sourceRefs.overall.ratio, minimums.sourceRefCoverage],
  ].filter((entry) => entry[2] !== undefined);

  return checks.map(([name, actual, expected]) => ({
    name,
    actual,
    expected,
    pass: Number(actual) >= Number(expected),
  }));
}

function runFixture(fixturePath) {
  const fixture = readJson(fixturePath);
  const course = fixture.course || {};
  const documents = fixture.documents || [];
  const mistakes = fixture.mistakes || [];
  const sessions = fixture.sessions || [];
  const expected = fixture.expected || {};

  const model = buildCourseKnowledgeModel(course, documents, { generatedAt: FIXED_NOW });
  const questionResult = generateQuestionSet(model, { count: expected.questionCount || 12 });
  const questions = questionResult.questions || [];
  const questionEvaluation = questionResult.evaluation || evaluateQuestionSet(questions, model);
  const plan = localReviewPlan(course, documents, mistakes, sessions, { limit: 6 });
  const cramPack = generateCramPack(model, questions, {
    documents,
    mistakes,
    sessions,
    totalMinutes: 90,
    questionCount: 8,
    topicLimit: 6,
    now: FIXED_NOW,
  });

  const modelItems = collectModelItems(model);
  const planItems = plan.items || [];
  const cramItems = [
    ...(cramPack.focusTopics || []),
    ...(cramPack.formulas || []),
    ...(cramPack.pitfalls || []),
    ...(cramPack.mistakeQueue || []),
    ...(cramPack.drillQuestions || []),
  ];
  const allSourceItems = [...modelItems, ...questions, ...planItems, ...cramItems];

  const metrics = {
    fixture: path.basename(fixturePath),
    fixtureId: fixture.id || path.basename(fixturePath, ".json"),
    course: course.name || course.id || "unknown",
    material: {
      documents: documents.length,
      units: documents.reduce((sum, doc) => sum + (doc.units || []).length, 0),
      textChars: documents.reduce((sum, doc) => sum + String(doc.text || "").length, 0),
      modelDocuments: model.documents?.length || 0,
      parseQualityLevels: (model.documents || []).map((doc) => doc.parse_quality?.level || "unknown"),
    },
    knowledge: {
      chapters: model.stats?.chapters || model.chapters?.length || 0,
      concepts: model.stats?.concepts || model.concepts?.length || 0,
      examples: model.stats?.examples || model.examples?.length || 0,
      homeworkProblems: model.stats?.homework_problems || model.homework_problems?.length || 0,
      mistakePoints: model.stats?.mistake_points || model.mistake_points?.length || 0,
      expectedConceptCoverage: termCoverage(expected.conceptTerms, (model.concepts || []).map((item) => item.name)),
    },
    formulas: {
      count: model.stats?.formulas || model.formulas?.length || 0,
      verified: (model.formulas || []).filter((item) => item.reference_match?.sources?.length || item.external_source_refs?.length).length,
      expectedFormulaCoverage: termCoverage(
        expected.formulaTerms,
        (model.formulas || []).flatMap((item) => [item.name, item.expression]),
      ),
    },
    questions: {
      count: questions.length,
      qualityScore: questionEvaluation.score,
      typeCounts: questionEvaluation.summary?.type_counts || {},
      sourceRefCoverage: questionEvaluation.summary?.source_ref_coverage ?? sourceRefCoverage(questions).ratio,
      expectedQuestionCoverage: termCoverage(
        expected.questionTerms,
        questions.flatMap((item) => [item.question_text, item.answer, item.explanation, ...(item.related_concepts || [])]),
      ),
      warnings: questionResult.warnings || [],
    },
    plan: {
      items: planItems.length,
      nextReview: plan.nextReview?.title || null,
      withSourceRefs: sourceRefCoverage(planItems),
    },
    cram: {
      focusTopics: cramPack.focusTopics?.length || 0,
      formulas: cramPack.formulas?.length || 0,
      pitfalls: cramPack.pitfalls?.length || 0,
      mistakeQueue: cramPack.mistakeQueue?.length || 0,
      drillQuestions: cramPack.drillQuestions?.length || 0,
      timelineSteps: cramPack.timeline?.length || 0,
      withSourceRefs: sourceRefCoverage(cramItems),
      warnings: cramPack.warnings || [],
    },
    sourceRefs: {
      model: sourceRefCoverage(modelItems),
      questions: sourceRefCoverage(questions),
      plan: sourceRefCoverage(planItems),
      cram: sourceRefCoverage(cramItems),
      overall: sourceRefCoverage(allSourceItems),
      validity: validSourceRefs(allSourceItems, documents),
    },
  };

  const checks = evaluateMinimums(metrics, expected.minimums);
  metrics.checks = checks;
  metrics.pass = checks.every((check) => check.pass) && metrics.sourceRefs.validity.ratio === 1;
  return metrics;
}

function renderTable(results) {
  const rows = results.map((item) => ({
    fixture: item.fixtureId,
    course: item.course,
    docs: item.material.documents,
    units: item.material.units,
    concepts: item.knowledge.concepts,
    formulas: item.formulas.count,
    questions: item.questions.count,
    plan: item.plan.items,
    cramTopics: item.cram.focusTopics,
    sourceRefs: item.sourceRefs.overall.ratio,
    pass: item.pass,
  }));
  console.table(rows);
}

function main() {
  const args = process.argv.slice(2);
  const table = args.includes("--table");
  const files = listFixtureFiles(args.filter((arg) => arg !== "--table"));
  const results = files.map(runFixture);
  const report = {
    generatedAt: FIXED_NOW,
    fixtureCount: results.length,
    pass: results.every((item) => item.pass),
    totals: {
      documents: results.reduce((sum, item) => sum + item.material.documents, 0),
      units: results.reduce((sum, item) => sum + item.material.units, 0),
      concepts: results.reduce((sum, item) => sum + item.knowledge.concepts, 0),
      formulas: results.reduce((sum, item) => sum + item.formulas.count, 0),
      questions: results.reduce((sum, item) => sum + item.questions.count, 0),
      planItems: results.reduce((sum, item) => sum + item.plan.items, 0),
      cramFocusTopics: results.reduce((sum, item) => sum + item.cram.focusTopics, 0),
    },
    results,
  };

  if (table) {
    renderTable(results);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }

  if (!report.pass) {
    process.exitCode = 1;
  }
}

main();
