const crypto = require("node:crypto");
const { wrapInlineFormula } = require("./formula-format.cjs");

const LEARNING_PACK_VERSION = 1;

function buildDocumentLearningPack(doc = {}, documentModel = {}) {
  const packId = hashId("learning_pack", [doc.id || documentModel.document_id, documentModel.generated_at || "", LEARNING_PACK_VERSION]);
  const concepts = rankItems(documentModel.concepts || [], scoreConcept).slice(0, 14).map((concept) => ({
    id: concept.concept_id,
    name: concept.name,
    description: concept.description || "",
    group: concept.concept_group || "",
    confidence: concept.candidate_confidence || "medium",
    priority: scoreConcept(concept),
    source_refs: concept.source_refs || [],
  }));
  const formulas = rankItems(documentModel.formulas || [], scoreFormula).slice(0, 10).map((formula) => ({
    id: formula.formula_id,
    name: formula.name,
    expression: formula.expression,
    display: wrapInlineFormula(formula.expression) || formula.expression,
    applicable_conditions: formula.applicable_conditions || "",
    common_misuses: formula.common_misuses || [],
    verification_status: formula.verification_status || "unverified",
    confidence: formula.verification_confidence || "medium",
    priority: scoreFormula(formula),
    source_refs: formula.source_refs || [],
  }));
  const problemTemplates = [...(documentModel.examples || []), ...(documentModel.homework_problems || [])]
    .slice(0, 10)
    .map((problem) => ({
      id: problem.example_id || problem.homework_problem_id,
      title: problem.title || "资料题型",
      stem: problem.problem_text || "",
      related_concepts: problem.related_concepts || [],
      difficulty: problem.difficulty || "medium",
      source_refs: problem.source_refs || [],
      template: problemTemplate(problem),
    }));
  const pitfalls = (documentModel.mistake_points || []).slice(0, 10).map((mistake) => ({
    id: mistake.mistake_point_id,
    text: mistake.description,
    related_concepts: mistake.related_concepts || [],
    checklist: pitfallChecklist(mistake),
    source_refs: mistake.source_refs || [],
  }));
  const drillTemplates = buildDrillTemplates({ concepts, formulas, problemTemplates, pitfalls }).slice(0, 12);
  const coverage = {
    concepts: concepts.length,
    formulas: formulas.length,
    problemTemplates: problemTemplates.length,
    pitfalls: pitfalls.length,
    drillTemplates: drillTemplates.length,
  };
  return {
    version: LEARNING_PACK_VERSION,
    id: packId,
    document_id: doc.id || documentModel.document_id,
    file_name: doc.originalName || documentModel.file_name || "",
    generated_at: new Date().toISOString(),
    profile: documentModel.focus_profile || null,
    title: `${doc.originalName || documentModel.file_name || "资料"} 增量知识包`,
    summary: learningPackSummary(coverage),
    coverage,
    concepts,
    formulas,
    problem_templates: problemTemplates,
    pitfalls,
    drill_templates: drillTemplates,
    source_refs: uniqueRefs([
      ...concepts.flatMap((item) => item.source_refs || []),
      ...formulas.flatMap((item) => item.source_refs || []),
      ...problemTemplates.flatMap((item) => item.source_refs || []),
      ...pitfalls.flatMap((item) => item.source_refs || []),
    ]).slice(0, 10),
  };
}

function buildCourseLearningPack(courseModel = {}) {
  const documentPacks = (courseModel.documents || []).flatMap((doc) => (doc.learning_pack ? [doc.learning_pack] : []));
  const concepts = mergeByName(documentPacks.flatMap((pack) => pack.concepts || []), "name").slice(0, 24);
  const formulas = mergeByName(documentPacks.flatMap((pack) => pack.formulas || []), "expression").slice(0, 18);
  const problemTemplates = mergeByName(documentPacks.flatMap((pack) => pack.problem_templates || []), "title").slice(0, 18);
  const pitfalls = mergeByName(documentPacks.flatMap((pack) => pack.pitfalls || []), "text").slice(0, 18);
  const drillTemplates = mergeByName(documentPacks.flatMap((pack) => pack.drill_templates || []), "title").slice(0, 24);
  return {
    version: LEARNING_PACK_VERSION,
    id: hashId("course_learning_pack", [courseModel.course?.course_id, documentPacks.map((pack) => pack.id).join("|"), LEARNING_PACK_VERSION]),
    course_id: courseModel.course?.course_id || "unknown",
    title: `${courseModel.course?.name || "当前科目"} 增量知识包`,
    generated_at: courseModel.generated_at || new Date().toISOString(),
    document_pack_ids: documentPacks.map((pack) => pack.id),
    summary: learningPackSummary({
      concepts: concepts.length,
      formulas: formulas.length,
      problemTemplates: problemTemplates.length,
      pitfalls: pitfalls.length,
      drillTemplates: drillTemplates.length,
    }),
    concepts,
    formulas,
    problem_templates: problemTemplates,
    pitfalls,
    drill_templates: drillTemplates,
    source_refs: uniqueRefs(documentPacks.flatMap((pack) => pack.source_refs || [])).slice(0, 12),
  };
}

function learningPackContext(pack = {}, options = {}) {
  const conceptLimit = Number(options.conceptLimit || 10);
  const formulaLimit = Number(options.formulaLimit || 8);
  const problemLimit = Number(options.problemLimit || 8);
  const pitfallLimit = Number(options.pitfallLimit || 8);
  const drillLimit = Number(options.drillLimit || 8);
  return [
    `## ${pack.title || "增量知识包"}`,
    pack.summary ? `摘要：${pack.summary}` : "",
    `### 新增/高优先知识点\n${(pack.concepts || []).slice(0, conceptLimit).map((item) => `- ${item.name}：${item.description || "按资料证据复习"}`).join("\n") || "- 暂无"}`,
    `### 新增/高优先公式与规则\n${(pack.formulas || []).slice(0, formulaLimit).map((item) => `- ${item.name || "公式"}：${item.display || wrapInlineFormula(item.expression) || item.expression}；条件：${item.applicable_conditions || "回到来源页核对"}`).join("\n") || "- 暂无"}`,
    `### 资料题型模板\n${(pack.problem_templates || []).slice(0, problemLimit).map((item) => `- ${item.title}：${item.template || item.stem || "按资料题型重做"}`).join("\n") || "- 暂无"}`,
    `### 防错清单\n${(pack.pitfalls || []).slice(0, pitfallLimit).map((item) => `- ${item.text}；检查：${(item.checklist || []).join(" / ") || "条件、符号、单位"}`).join("\n") || "- 暂无"}`,
    `### 可生成训练\n${(pack.drill_templates || []).slice(0, drillLimit).map((item) => `- ${item.title}：${item.prompt}`).join("\n") || "- 暂无"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function learningPackQuestions(pack = {}, options = {}) {
  const limit = Number(options.limit || 12);
  const questions = [];
  for (const item of pack.drill_templates || []) {
    questions.push({
      seed: ["learning_pack", pack.id, item.id],
      question_type: item.type || "exam_practice",
      difficulty: item.difficulty || "medium",
      related_concepts: item.related_concepts || [],
      source_refs: item.source_refs || [],
      question_text: item.prompt,
      answer: item.answer || "先回到来源页确认条件，再按模板完成完整步骤。",
      step_by_step_solution: item.steps || ["定位来源证据。", "写出适用条件。", "列出解题或解释步骤。", "完成检查清单。"],
      common_mistakes: item.common_mistakes || ["没有回到来源证据。", "跳过适用条件。"],
      grading_rubric: item.rubric || ["来源定位 2 分", "方法选择 3 分", "步骤完整 3 分", "检查 2 分"],
      estimated_time: item.estimated_time || 8,
      tags: uniqueStrings(["增量知识包", ...(item.tags || [])]),
    });
    if (questions.length >= limit) break;
  }
  return questions;
}

function buildDrillTemplates({ concepts, formulas, problemTemplates, pitfalls }) {
  const drills = [];
  for (const problem of problemTemplates) {
    drills.push({
      id: hashId("drill", ["problem", problem.id || problem.title]),
      type: "exam_practice",
      title: `同类题模板：${problem.title}`,
      prompt: `基于资料题型“${problem.title}”，重新设计一道同类题，并写出条件识别、列式/推理步骤和最后检查。`,
      answer: problem.template || "保留原题型入口，替换条件后重新完成完整步骤。",
      related_concepts: problem.related_concepts || [],
      source_refs: problem.source_refs || [],
      difficulty: problem.difficulty || "medium",
      tags: ["同类题", "资料题型"],
    });
  }
  for (const formula of formulas) {
    drills.push({
      id: hashId("drill", ["formula", formula.id || formula.expression]),
      type: "formula_application",
      title: `公式应用：${formula.name || formula.expression}`,
      prompt: `围绕 ${formula.display || formula.expression} 设计一道应用题，说明适用条件、变量含义和常见误用。`,
      answer: `需要写出 ${formula.display || formula.expression} 的适用条件：${formula.applicable_conditions || "回到来源页核对"}。`,
      related_concepts: concepts.slice(0, 4).map((item) => item.name),
      source_refs: formula.source_refs || [],
      difficulty: "medium",
      tags: ["公式", "应用"],
    });
  }
  for (const pitfall of pitfalls) {
    drills.push({
      id: hashId("drill", ["pitfall", pitfall.id || pitfall.text]),
      type: "mistake_diagnosis",
      title: `易错诊断：${pitfall.text}`,
      prompt: `针对易错点“${pitfall.text}”，设计一道错误诊断题，要求指出错误入口、正确规则和防错检查清单。`,
      answer: `防错检查：${(pitfall.checklist || []).join("；") || "条件、符号、单位、来源页证据"}`,
      related_concepts: pitfall.related_concepts || [],
      source_refs: pitfall.source_refs || [],
      difficulty: "medium",
      tags: ["易错", "诊断"],
    });
  }
  return mergeByName(drills, "title");
}

function problemTemplate(problem = {}) {
  const concepts = (problem.related_concepts || []).slice(0, 4).join("、");
  return `保留“${problem.title || "资料题型"}”的题型入口${concepts ? `，覆盖 ${concepts}` : ""}，改变条件后要求写出完整步骤和检查点。`;
}

function pitfallChecklist(mistake = {}) {
  const text = `${mistake.description || ""}\n${(mistake.related_concepts || []).join(" ")}`;
  const checks = [];
  if (/单位|量纲|MPa|N|mol|K\b|秒|s\b/i.test(text)) checks.push("统一单位/量纲");
  if (/符号|正负|方向|极性|流入|流出|方向/i.test(text)) checks.push("检查符号和方向");
  if (/条件|适用|前提|近似|边界|初值|定义域|收敛/i.test(text)) checks.push("核对适用条件");
  if (/公式|方程|KCL|KVL|递推|转移|平衡|守恒/i.test(text)) checks.push("重列核心公式/方程");
  checks.push("回到来源页证据");
  return uniqueStrings(checks).slice(0, 4);
}

function learningPackSummary(coverage = {}) {
  return [
    coverage.concepts ? `${coverage.concepts} 个高优先知识点` : "",
    coverage.formulas ? `${coverage.formulas} 条公式/规则` : "",
    coverage.problemTemplates ? `${coverage.problemTemplates} 个资料题型` : "",
    coverage.pitfalls ? `${coverage.pitfalls} 个防错点` : "",
    coverage.drillTemplates ? `${coverage.drillTemplates} 个训练模板` : "",
  ]
    .filter(Boolean)
    .join("；") || "资料证据不足，建议补充更多课件或例题。";
}

function scoreConcept(concept = {}) {
  return (
    Number(concept.importance_score || 0) +
    Number(concept.selection_score || 0) +
    Number(concept.evidence_score || 0) +
    (concept.candidate_confidence === "high" ? 30 : concept.candidate_confidence === "medium" ? 12 : 0)
  );
}

function scoreFormula(formula = {}) {
  const status = formula.verification_status || formula.verification?.status || "unverified";
  return Number(formula.exam_focus?.score || 0) + (status === "verified" || status === "corrected" ? 80 : status === "plausible" ? 35 : 8);
}

function rankItems(items, scoreFn) {
  return [...items].sort((a, b) => Number(scoreFn(b) || 0) - Number(scoreFn(a) || 0));
}

function mergeByName(items = [], keyName) {
  const seen = new Set();
  const out = [];
  for (const item of rankItems(items, (value) => value.priority || value.estimated_time || 0)) {
    const key = String(item?.[keyName] || item?.id || "").replace(/\s+/g, "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function uniqueRefs(refs = []) {
  const seen = new Set();
  const out = [];
  for (const ref of refs || []) {
    const key = `${ref.document_id || ref.documentId}:${ref.unit_index ?? ref.unitIndex ?? ""}:${ref.excerpt || ref.anchor_text || ""}`;
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function hashId(prefix, parts = []) {
  return `${prefix}_${crypto.createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 12)}`;
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    const key = text.replace(/\s+/g, "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

module.exports = {
  LEARNING_PACK_VERSION,
  buildCourseLearningPack,
  buildDocumentLearningPack,
  learningPackContext,
  learningPackQuestions,
};
