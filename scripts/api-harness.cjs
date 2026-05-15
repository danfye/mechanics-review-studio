const fs = require("node:fs");
const path = require("node:path");
const { createApiKeyStore } = require("../lib/server/api-key-store.cjs");
const { createChatApiClient, normalizeApiBaseUrl } = require("../lib/server/api-client.cjs");
const {
  aiPptTeachingSkillPrompt,
  aiSolutionSkillPrompt,
  pptTeachingSummaryRequest,
  solutionSkillRequest,
} = require("../lib/core/ai-skills.cjs");
const {
  buildCourseKnowledgeModel,
  generateMindMap,
  parseJsonFromModel,
} = require("../server.cjs");
const {
  localSolveQuestion,
  normalizeSolution,
} = require("../lib/core/solution-generator.cjs");

const ROOT = path.join(__dirname, "..");
const DEFAULT_FIXTURE_DIR = path.join(ROOT, "fixtures", "harness");
const DB_PATH = path.join(ROOT, "data", "db.json");
const FIXED_NOW = "2026-05-16T00:00:00.000Z";
const { callChatApi } = createChatApiClient({ timeoutMs: 90000, cacheLimit: 8 });

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

function loadApiSettings() {
  const db = readJson(DB_PATH);
  const apiKey = createApiKeyStore().getApiKey();
  const settings = {
    ...(db.settings || {}),
    apiBaseUrl: normalizeApiBaseUrl(db.settings?.apiBaseUrl),
    apiKey,
    model: String(db.settings?.model || "").trim(),
  };
  const missing = [];
  if (settings.provider !== "api") missing.push("settings.provider=api");
  if (!settings.apiBaseUrl) missing.push("settings.apiBaseUrl");
  if (!settings.model) missing.push("settings.model");
  if (!settings.apiKey) missing.push("本机 API Key 文件");
  if (missing.length) {
    throw new Error(`API harness 需要完整 API 配置，当前缺少：${missing.join("、")}。请先在设置页保存 API 增强版配置。`);
  }
  return settings;
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

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function truncateText(value, maxChars = 9000) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.floor(maxChars * 0.7))}\n\n[中间内容已截断]\n\n${text.slice(-Math.floor(maxChars * 0.3))}`;
}

function buildTextEvidence(courseModel = {}, documents = [], maxChars = 16000) {
  const concepts = (courseModel.concepts || [])
    .slice(0, 12)
    .map((item) => `- ${item.name}: ${item.description || item.evidence || ""}`)
    .join("\n");
  const formulas = (courseModel.formulas || [])
    .slice(0, 10)
    .map((item) => `- ${item.name}: ${item.expression || ""} ${item.applicable_conditions || ""}`)
    .join("\n");
  const snippets = documents
    .flatMap((doc) =>
      (doc.units?.length ? doc.units : [{ label: "全文", text: doc.text || "" }]).slice(0, 8).map((unit, indexValue) =>
        [
          `### ${doc.originalName || doc.id} / ${unit.label || "全文"}`,
          `source_ref=${JSON.stringify({
            document_id: doc.id,
            file_name: doc.originalName || "",
            unit_index: indexValue,
            unit_label: unit.label || "全文",
            locator_label: unit.label || "资料片段",
            excerpt: String(unit.text || "").slice(0, 180),
          })}`,
          String(unit.text || "").slice(0, 900),
        ].join("\n"),
      ),
    )
    .join("\n\n");
  return truncateText(
    [
      "## 结构化考点",
      concepts || "暂无",
      "## 关键公式",
      formulas || "暂无",
      "## 资料片段",
      snippets || "暂无",
    ].join("\n\n"),
    maxChars,
  );
}

function buildSummaryDraft(courseModel = {}, mindMap = {}) {
  const chapters = (courseModel.chapters || [])
    .slice(0, 8)
    .map((item) => `- ${item.title || item.name}: ${(item.key_points || []).slice(0, 3).join("；")}`)
    .join("\n");
  const formulas = (courseModel.formulas || [])
    .slice(0, 8)
    .map((item) => `- ${item.name}: ${item.expression || ""}`)
    .join("\n");
  return [
    `本地提纲统计：${mindMap.stats?.nodes || 0} 个节点 / ${mindMap.stats?.edges || 0} 条关系。`,
    chapters ? `章节：\n${chapters}` : "",
    formulas ? `公式：\n${formulas}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function scorePptTeaching(content, expected = {}) {
  const sections = expected.requiredSections || [];
  const sectionHits = sections.filter((term) => normalizeText(content).includes(normalizeText(term)));
  const conceptCoverage = termCoverage(expected.conceptTerms, [content]);
  const formulaCoverage = termCoverage(expected.formulaTerms, [content]);
  const hasLatex = /\$[^$\n]{2,}\$|\\frac|\\sigma|\\Delta|F_\{?N\}?/.test(content);
  const score = Math.min(
    100,
    Math.round(
      (sections.length ? (sectionHits.length / sections.length) * 45 : 45) +
        conceptCoverage.ratio * 25 +
        formulaCoverage.ratio * 20 +
        (hasLatex ? 10 : 0),
    ),
  );
  return {
    score,
    level: score >= 85 ? "strong" : score >= 70 ? "usable" : "partial",
    sectionCoverage: {
      expected: sections.length,
      hit: sectionHits.length,
      missing: sections.filter((term) => !sectionHits.includes(term)),
      ratio: sections.length ? round(sectionHits.length / sections.length) : 1,
    },
    conceptCoverage,
    formulaCoverage,
    hasLatex,
  };
}

function reviewCardTypeCoverage(cards = [], expectedTypes = []) {
  const expected = Array.isArray(expectedTypes) ? expectedTypes.filter(Boolean) : [];
  const values = cards.flatMap((card) => [card.type, card.title, card.body]);
  const aliases = {
    method: ["method", "入口", "流程", "方法"],
    formula: ["formula", "公式", "规则"],
    pitfall: ["pitfall", "易错", "检查", "误用"],
    drill: ["drill", "同类", "训练", "变式"],
  };
  const hits = expected.filter((type) => {
    const haystack = normalizeText(values.join("\n"));
    return (aliases[type] || [type]).some((term) => haystack.includes(normalizeText(term)));
  });
  return {
    expected: expected.length,
    hit: hits.length,
    ratio: expected.length ? round(hits.length / expected.length) : 1,
    missing: expected.filter((type) => !hits.includes(type)),
  };
}

function validateSolutionStructure(solution, expected = {}) {
  const failures = [];
  if (!solution.question) failures.push("solution.question 缺失");
  if (!Array.isArray(solution.steps) || solution.steps.length < 3) failures.push("solution.steps 少于 3 步");
  if (!solution.answer) failures.push("solution.answer 缺失");
  if (!solution.similarDrillPrompt) failures.push("solution.similarDrillPrompt 缺失");
  if (!Array.isArray(solution.reviewCards) || solution.reviewCards.length < Number(expected.minimumReviewCards || 4)) {
    failures.push(`reviewCards 少于 ${expected.minimumReviewCards || 4} 张`);
  }
  if (expected.requireSourceRefs && (!Array.isArray(solution.sourceRefs) || !solution.sourceRefs.length)) {
    failures.push("sourceRefs 缺失");
  }
  return failures;
}

async function runPptTeachingFixture(settings, fixture) {
  const courseModel = buildCourseKnowledgeModel(fixture.course, fixture.documents, { generatedAt: FIXED_NOW });
  const mindMap = generateMindMap(courseModel);
  const content = await callChatApi(
    settings,
    [
      {
        role: "system",
        content: aiPptTeachingSkillPrompt(),
      },
      {
        role: "user",
        content: [
          pptTeachingSummaryRequest(fixture.course?.name || "未命名科目", mindMap.stats || {}),
          buildTextEvidence(courseModel, fixture.documents),
          `本地提纲草稿（只作参考，可重组和改写，但不要丢失可验证证据）：\n${buildSummaryDraft(courseModel, mindMap)}`,
        ].join("\n\n"),
      },
    ],
    null,
    { cache: false, timeoutMs: 90000, temperature: 0.15 },
  );
  const quality = scorePptTeaching(content, fixture.expected || {});
  return {
    fixture: fixture.id,
    type: fixture.type,
    pass: true,
    quality,
    strictPass: quality.score >= Number(fixture.expected?.minimumScore || 70),
    excerpt: content.slice(0, 500),
  };
}

async function runSolutionFixture(settings, fixture) {
  const courseModel = buildCourseKnowledgeModel(fixture.course, fixture.documents, { generatedAt: FIXED_NOW });
  const localSolution = localSolveQuestion(fixture.course, fixture.documents, { question: fixture.question }, courseModel);
  const content = await callChatApi(
    settings,
    [
      {
        role: "system",
        content: aiSolutionSkillPrompt(),
      },
      {
        role: "user",
        content: [
          solutionSkillRequest(fixture.course?.name || "未命名科目", fixture.question),
          buildTextEvidence(courseModel, fixture.documents, 14000),
          `本地解题草稿（只作兜底和提示，API 应输出更像老师讲解的版本）：\n${JSON.stringify(localSolution, null, 2)}`,
        ].join("\n\n"),
      },
    ],
    { type: "json_object" },
    { cache: false, timeoutMs: 90000, temperature: 0.1 },
  );
  const parsed = parseJsonFromModel(content);
  const solution = normalizeSolution(parsed, { ...localSolution, provider: "api" });
  const structureFailures = validateSolutionStructure(solution, fixture.expected || {});
  const conceptCoverage = termCoverage(fixture.expected?.relatedConcepts, [
    solution.relatedConcepts.join("\n"),
    solution.method,
    solution.steps.map((step) => `${step.title} ${step.detail} ${step.formula}`).join("\n"),
  ]);
  const formulaCoverage = termCoverage(fixture.expected?.formulaTerms, [
    solution.formulaHints.join("\n"),
    solution.steps.map((step) => step.formula || step.detail).join("\n"),
    solution.answer,
  ]);
  const cardTypeCoverage = reviewCardTypeCoverage(solution.reviewCards, fixture.expected?.reviewCardTypes);
  const strictPass =
    solution.quality.score >= Number(fixture.expected?.minimumQualityScore || 75) &&
    !conceptCoverage.missing.length &&
    !formulaCoverage.missing.length &&
    !cardTypeCoverage.missing.length;
  return {
    fixture: fixture.id,
    type: fixture.type,
    pass: structureFailures.length === 0,
    strictPass,
    structureFailures,
    quality: solution.quality,
    conceptCoverage,
    formulaCoverage,
    cardTypeCoverage,
    provider: solution.provider,
    reviewCards: solution.reviewCards.length,
    sourceRefs: solution.sourceRefs.length,
  };
}

async function runFixture(settings, fixturePath) {
  const fixture = readJson(fixturePath);
  if (fixture.type === "ppt_teaching") return runPptTeachingFixture(settings, fixture);
  if (fixture.type === "solution") return runSolutionFixture(settings, fixture);
  throw new Error(`未知 harness fixture type: ${fixture.type || "(empty)"} in ${fixturePath}`);
}

function renderTable(results) {
  const rows = results.map((item) => ({
    fixture: item.fixture,
    type: item.type,
    score: item.quality?.score,
    level: item.quality?.level,
    pass: item.pass,
    strict: item.strictPass,
    missing:
      item.structureFailures?.join("; ") ||
      item.quality?.sectionCoverage?.missing?.join("; ") ||
      item.cardTypeCoverage?.missing?.join("; ") ||
      "",
  }));
  console.table(rows);
}

async function main() {
  const args = process.argv.slice(2);
  const table = args.includes("--table");
  const strict = args.includes("--strict");
  const files = listFixtureFiles(args.filter((arg) => arg !== "--table" && arg !== "--strict"));
  const settings = loadApiSettings();
  const results = [];
  for (const file of files) {
    results.push(await runFixture(settings, file));
  }
  const report = {
    generatedAt: FIXED_NOW,
    provider: "api",
    model: settings.model,
    fixtureCount: results.length,
    pass: results.every((item) => item.pass),
    strictPass: results.every((item) => item.pass && item.strictPass),
    results,
  };
  if (table) {
    renderTable(results);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  if (!report.pass || (strict && !report.strictPass)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
