const { uniqueStrings } = require("./knowledge-model.cjs");

const REQUIRED_FIELDS = [
  "question_id",
  "question_type",
  "difficulty",
  "related_concepts",
  "source_refs",
  "question_text",
  "answer",
  "step_by_step_solution",
  "common_mistakes",
  "grading_rubric",
  "estimated_time",
  "tags",
];

function normalizeQuestionText(question) {
  return String(question.question_text || question.stem || "")
    .replace(/[^\p{L}\p{N}=+\-*/^_]+/gu, "")
    .toLowerCase()
    .slice(0, 120);
}

function evaluateQuestionSet(questions = [], courseModel = {}, options = {}) {
  const list = Array.isArray(questions) ? questions : [];
  const issues = [];
  const warnings = [];
  const typeCounts = countBy(list, (q) => q.question_type || q.type || "unknown");
  const difficultyCounts = countBy(list, (q) => q.difficulty || "unknown");
  const duplicateGroups = findDuplicates(list);
  const missing = list
    .map((question) => ({
      question_id: question.question_id || question.id || "unknown",
      fields: REQUIRED_FIELDS.filter((field) => isMissing(question, field)),
    }))
    .filter((item) => item.fields.length);

  if (!list.length) issues.push("没有生成题目。");
  if (Object.keys(typeCounts).length < Math.min(4, list.length)) warnings.push("题型多样性不足。");
  if (!difficultyCounts.basic) warnings.push("缺少 basic 难度题。");
  if (!difficultyCounts.medium) warnings.push("缺少 medium 难度题。");
  if (!difficultyCounts.hard && !difficultyCounts.comprehensive) warnings.push("缺少 hard/comprehensive 难度题。");
  if (missing.length) issues.push(`${missing.length} 道题缺少必要字段。`);
  if (duplicateGroups.length) issues.push(`发现 ${duplicateGroups.length} 组疑似重复题。`);
  if (!list.some((q) => q.question_type === "comprehensive" || q.difficulty === "comprehensive")) {
    warnings.push("没有综合题。");
  }
  if ((courseModel.mistake_points || []).length && !list.some((q) => q.question_type === "mistake_diagnosis")) {
    warnings.push("资料有易错点，但题集中没有错误诊断题。");
  }
  if ((courseModel.formulas || []).length) {
    const hasFormulaApplication = list.some((q) => q.question_type === "formula_application");
    const hasCalculation = list.some((q) => q.question_type === "calculation");
    if (!hasFormulaApplication) warnings.push("资料有公式，但缺少适用条件判断或公式应用题。");
    if (!hasCalculation) warnings.push("资料有公式，但缺少计算题。");
  }
  if (list.some((q) => !Array.isArray(q.source_refs) || !q.source_refs.length)) {
    issues.push("存在没有 source_refs 的题目。");
  }

  const conceptCoverage = knowledgeCoverage(list, courseModel);
  const sourceCoverage = sourceCoverageScore(list);
  const typeDiversity = Math.min(1, Object.keys(typeCounts).length / 6);
  const difficultyDistribution = Math.min(1, Object.keys(difficultyCounts).filter((key) => key !== "unknown").length / 4);
  const completeness = list.length
    ? 1 - missing.reduce((sum, item) => sum + item.fields.length, 0) / (list.length * REQUIRED_FIELDS.length)
    : 0;
  const duplicatePenalty = list.length ? Math.min(0.35, duplicateGroups.length / list.length) : 0;
  const score = Math.round(
    Math.max(
      0,
      (typeDiversity * 22 +
        difficultyDistribution * 18 +
        conceptCoverage.score * 22 +
        sourceCoverage * 16 +
        completeness * 18 +
        (hasComprehensive(list) ? 4 : 0)) *
        (1 - duplicatePenalty),
    ),
  );

  return {
    score,
    level: score >= 80 ? "good" : score >= 55 ? "partial" : "weak",
    summary: {
      total: list.length,
      type_counts: typeCounts,
      difficulty_counts: difficultyCounts,
      concept_coverage: conceptCoverage,
      source_ref_coverage: sourceCoverage,
      duplicate_groups: duplicateGroups.length,
      complete_question_ratio: completeness,
    },
    checks: {
      type_diversity: Object.keys(typeCounts).length >= Math.min(4, list.length),
      difficulty_distribution: Boolean(difficultyCounts.basic && difficultyCounts.medium && (difficultyCounts.hard || difficultyCounts.comprehensive)),
      knowledge_coverage: conceptCoverage.score >= 0.45 || !(courseModel.concepts || []).length,
      answer_and_steps: list.every((q) => q.answer && Array.isArray(q.step_by_step_solution) && q.step_by_step_solution.length),
      source_refs: list.every((q) => Array.isArray(q.source_refs) && q.source_refs.length),
      duplicate_questions: duplicateGroups.length === 0,
      mistake_points: !(courseModel.mistake_points || []).length || list.some((q) => q.question_type === "mistake_diagnosis"),
      comprehensive_question: hasComprehensive(list),
    },
    missing_fields: missing,
    duplicates: duplicateGroups,
    issues,
    warnings: uniqueStrings([...warnings, ...(options.warnings || [])]),
  };
}

function countBy(values, keyFn) {
  return values.reduce((counts, value) => {
    const key = keyFn(value);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function isMissing(question, field) {
  const value = question[field];
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === null || value === "";
}

function findDuplicates(questions) {
  const buckets = new Map();
  for (const question of questions) {
    const key = normalizeQuestionText(question);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(question.question_id || question.id || "unknown");
  }
  return [...buckets.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([fingerprint, question_ids]) => ({ fingerprint, question_ids }));
}

function knowledgeCoverage(questions, courseModel) {
  const allConcepts = (courseModel.concepts || []).map((concept) => concept.name).filter(Boolean);
  if (!allConcepts.length) return { score: 1, covered: [], total: 0, missing: [] };
  const covered = new Set();
  for (const question of questions) {
    const text = `${question.question_text || ""}\n${question.answer || ""}\n${(question.related_concepts || []).join("\n")}`;
    for (const concept of allConcepts) {
      if (text.includes(concept)) covered.add(concept);
    }
  }
  return {
    score: covered.size / allConcepts.length,
    covered: [...covered],
    total: allConcepts.length,
    missing: allConcepts.filter((concept) => !covered.has(concept)).slice(0, 12),
  };
}

function sourceCoverageScore(questions) {
  if (!questions.length) return 0;
  const withSources = questions.filter((question) => Array.isArray(question.source_refs) && question.source_refs.length);
  return withSources.length / questions.length;
}

function hasComprehensive(questions) {
  return questions.some((question) => question.question_type === "comprehensive" || question.difficulty === "comprehensive");
}

module.exports = {
  REQUIRED_FIELDS,
  evaluateQuestionSet,
  normalizeQuestionText,
};
