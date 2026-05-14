const crypto = require("node:crypto");
const {
  clamp,
  sourceDocumentIds,
  uniqueStrings,
} = require("./knowledge-model.cjs");
const { wrapInlineFormula } = require("./formula-format.cjs");

const REQUIRED_SOLUTION_SECTIONS = [
  "题意与已知",
  "考点定位",
  "解题步骤",
  "答案",
  "易错提醒",
];

function normalizeApiQuestion(raw = {}, fallback = {}) {
  const stem = cleanText(raw.stem || raw.question_text || raw.question || fallback.stem || fallback.question_text || "");
  const answer = cleanText(raw.answer || raw.final_answer || raw.result || fallback.answer || "");
  const explanation = cleanText(raw.explanation || raw.analysis || raw.solution || fallback.explanation || "");
  const steps = normalizeStringList(raw.step_by_step_solution || raw.steps || raw.solution_steps || fallback.step_by_step_solution);
  const commonMistakes = normalizeStringList(raw.common_mistakes || raw.mistakes || fallback.common_mistakes);
  const gradingRubric = normalizeStringList(raw.grading_rubric || raw.rubric || fallback.grading_rubric);
  const sourceRefs = normalizeSourceRefs(raw.source_refs || raw.sourceRefs || fallback.source_refs || fallback.sourceRefs);
  const questionType = cleanText(raw.question_type || raw.type || fallback.question_type || fallback.type || "calculation");

  return {
    id: raw.id || raw.question_id || fallback.id || stableId("q", stem || answer || Date.now()),
    question_id: raw.question_id || raw.id || fallback.question_id || stableId("q", stem || answer || Date.now()),
    question_type: questionType,
    type: legacyType(questionType),
    difficulty: cleanText(raw.difficulty || fallback.difficulty || "medium"),
    stem,
    question_text: stem,
    options: Array.isArray(raw.options) ? raw.options.map(cleanText).filter(Boolean) : [],
    answer: answer || "资料不足，无法生成可靠答案。",
    explanation: explanation || steps.join(" "),
    step_by_step_solution: steps.length ? steps : fallbackSteps(questionType),
    common_mistakes: commonMistakes.length ? commonMistakes : ["没有检查适用条件、单位或边界条件。"],
    grading_rubric: gradingRubric.length ? gradingRubric : ["题意分析清楚", "列式或逻辑完整", "答案和校核明确"],
    estimated_time: clamp(Number(raw.estimated_time || raw.estimatedTime || fallback.estimated_time || 8), 3, 40),
    related_concepts: uniqueStrings(raw.related_concepts || raw.concepts || fallback.related_concepts || []),
    tags: uniqueStrings(raw.tags || fallback.tags || []),
    sourceDocumentIds: uniqueStrings([
      ...(Array.isArray(raw.sourceDocumentIds) ? raw.sourceDocumentIds : []),
      ...(Array.isArray(fallback.sourceDocumentIds) ? fallback.sourceDocumentIds : []),
      ...sourceDocumentIds(sourceRefs),
    ]),
    sourceRefs,
  };
}

function normalizeApiQuestionList(rawList = [], fallbackList = [], options = {}) {
  const count = clamp(Number(options.count || rawList.length || fallbackList.length || 0), 0, 60);
  const normalized = [];
  const sourceFallback = Array.isArray(fallbackList) ? fallbackList : [];
  const sourceRaw = Array.isArray(rawList) ? rawList : [];
  for (let index = 0; index < Math.max(sourceRaw.length, sourceFallback.length); index += 1) {
    const question = normalizeApiQuestion(sourceRaw[index] || {}, sourceFallback[index] || sourceFallback[0] || {});
    if (!question.stem) continue;
    normalized.push(question);
    if (normalized.length >= count) break;
  }
  return normalized;
}

function localSolveQuestion(course = {}, docs = [], body = {}, courseModel = null) {
  const questionText = cleanText(body.question || body.stem || "");
  const context = buildSolutionContext(docs, questionText, courseModel);
  const relatedConcepts = context.concepts.slice(0, 5);
  const formulaHint = context.formulas[0];
  const method = inferMethod(questionText, context, course?.name || "");
  const sourceRefs = context.sourceRefs.slice(0, 4);
  const steps = buildLocalSteps(method, formulaHint, relatedConcepts);
  const finalAnswer = buildLocalAnswer(method, formulaHint);
  const mistakes = buildMistakeWarnings(method, formulaHint);

  return normalizeSolution({
    id: stableId("solution", [course?.id, questionText, Date.now()].join("|")),
    courseId: course?.id || body.courseId || "",
    question: questionText,
    title: cleanText(body.title || inferTitle(questionText, relatedConcepts, method)),
    subject: cleanText(course?.name || body.subject || "当前科目"),
    method,
    knowns: extractKnowns(questionText),
    target: inferTarget(questionText),
    relatedConcepts,
    formulaHints: context.formulas.slice(0, 4),
    steps,
    answer: finalAnswer,
    commonMistakes: mistakes,
    reviewCards: buildReviewCards(questionText, relatedConcepts, context.formulas, mistakes),
    similarDrillPrompt: buildSimilarDrillPrompt(questionText, method, relatedConcepts),
    sourceDocumentIds: sourceDocumentIds(sourceRefs),
    sourceRefs,
    provider: "local",
  });
}

function normalizeSolution(raw = {}, fallback = {}) {
  const question = cleanText(raw.question || raw.stem || fallback.question || "");
  const steps = normalizeSolutionSteps(raw.steps || raw.step_by_step_solution || raw.solution_steps || fallback.steps);
  const sourceRefs = normalizeSourceRefs(raw.sourceRefs || raw.source_refs || fallback.sourceRefs || fallback.source_refs);
  const commonMistakes = normalizeStringList(raw.commonMistakes || raw.common_mistakes || raw.mistakes || fallback.commonMistakes);
  const formulaHints = normalizeStringList(raw.formulaHints || raw.formulas || raw.formula_hints || fallback.formulaHints).slice(0, 8);
  const relatedConcepts = uniqueStrings(raw.relatedConcepts || raw.related_concepts || raw.concepts || fallback.relatedConcepts || []).slice(0, 8);
  const answer = cleanText(raw.answer || raw.finalAnswer || raw.final_answer || raw.result || fallback.answer || "");
  const method = cleanText(raw.method || raw.solutionMethod || raw.entry || fallback.method || "按题意识别条件，建立方程或逻辑链后求解。");
  const reviewCards = normalizeReviewCards(raw.reviewCards || raw.memoryCards || raw.review_cards || fallback.reviewCards, {
    question,
    relatedConcepts,
    formulaHints,
    commonMistakes,
  });
  return {
    id: raw.id || fallback.id || stableId("solution", `${question}:${answer}`),
    courseId: raw.courseId || raw.course_id || fallback.courseId || "",
    title: cleanText(raw.title || fallback.title || inferTitle(question, relatedConcepts, method)),
    subject: cleanText(raw.subject || fallback.subject || ""),
    question,
    knowns: normalizeStringList(raw.knowns || raw.givens || fallback.knowns).slice(0, 10),
    target: cleanText(raw.target || raw.toSolve || raw.to_solve || fallback.target || inferTarget(question)),
    relatedConcepts,
    formulaHints,
    method,
    steps: steps.length ? steps : buildLocalSteps(method, formulaHints[0], relatedConcepts),
    answer: answer || "资料不足，当前只能给出解题框架，建议补充题目条件或接入 API。",
    commonMistakes: commonMistakes.length ? commonMistakes : buildMistakeWarnings(method, formulaHints[0]),
    reviewCards,
    similarDrillPrompt: cleanText(raw.similarDrillPrompt || raw.similar_drill_prompt || fallback.similarDrillPrompt || buildSimilarDrillPrompt(question, method, relatedConcepts)),
    sourceDocumentIds: uniqueStrings([
      ...(Array.isArray(raw.sourceDocumentIds) ? raw.sourceDocumentIds : []),
      ...(Array.isArray(fallback.sourceDocumentIds) ? fallback.sourceDocumentIds : []),
      ...sourceDocumentIds(sourceRefs),
    ]),
    sourceRefs,
    provider: raw.provider || fallback.provider || "local",
    quality: solutionQuality({ question, steps, answer, relatedConcepts, formulaHints, sourceRefs, reviewCards }),
  };
}

function buildSolutionContext(docs = [], questionText = "", courseModel = null) {
  const tokens = tokenize(questionText);
  const ranked = [];
  for (const doc of docs) {
    const units = Array.isArray(doc.units) && doc.units.length ? doc.units : [{ label: "全文", text: doc.text || "" }];
    for (const [unitIndex, unit] of units.entries()) {
      const text = cleanText(unit.text || "");
      if (!text) continue;
      let score = 0;
      for (const token of tokens) if (text.includes(token)) score += token.length > 1 ? 2 : 1;
      if (/[=≈≤≥<>/]|\\(?:frac|sqrt)|[σσετγθφωΩμνΔδψ]/u.test(text)) score += 2;
      if (/例题|题目|求|解|公式|条件|方法|证明/.test(text)) score += 2;
      if (score <= 0) continue;
      ranked.push({
        score,
        text,
        sourceRef: makeSourceRef(doc, unit, unitIndex, text),
      });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  const modelConcepts = (courseModel?.concepts || [])
    .filter((concept) => tokens.some((token) => cleanText(concept.name).includes(token) || cleanText(concept.description).includes(token)))
    .sort((a, b) => Number(b.selection_score || b.importance_score || 0) - Number(a.selection_score || a.importance_score || 0));
  const modelFormulas = (courseModel?.formulas || [])
    .filter((formula) => {
      const joined = `${formula.name || ""} ${formula.expression || ""} ${formula.applicable_conditions || ""}`;
      return tokens.some((token) => joined.includes(token)) || ranked.some((item) => item.text.includes(formula.name || formula.expression || "__none__"));
    })
    .slice(0, 6);
  const concepts = uniqueStrings([
    ...modelConcepts.map((concept) => concept.name),
    ...extractChineseTerms(questionText),
    ...(courseModel?.concepts || []).slice(0, 4).map((concept) => concept.name),
  ]);
  const formulas = uniqueStrings([
    ...modelFormulas.map((formula) => wrapInlineFormula(formula.expression) || formula.expression),
    ...extractFormulaHints(questionText),
    ...(courseModel?.formulas || []).slice(0, 4).map((formula) => wrapInlineFormula(formula.expression) || formula.expression),
  ]);
  return {
    snippets: ranked.slice(0, 6).map((item) => item.text),
    sourceRefs: ranked.slice(0, 6).map((item) => item.sourceRef),
    concepts,
    formulas,
  };
}

function solutionQuality(solution = {}) {
  const checks = {
    has_question: Boolean(cleanText(solution.question)),
    has_steps: Array.isArray(solution.steps) && solution.steps.length >= 3,
    has_answer: Boolean(cleanText(solution.answer)),
    has_review_memory: Array.isArray(solution.reviewCards) && solution.reviewCards.length >= 2,
    has_source_refs: Array.isArray(solution.sourceRefs) && solution.sourceRefs.length > 0,
  };
  let score = 0;
  if (checks.has_question) score += 15;
  if (checks.has_steps) score += 30;
  if (checks.has_answer) score += 20;
  if ((solution.relatedConcepts || []).length) score += 10;
  if ((solution.formulaHints || []).length) score += 10;
  if (checks.has_review_memory) score += 10;
  if (checks.has_source_refs) score += 5;
  return {
    score,
    level: score >= 85 ? "strong" : score >= 65 ? "usable" : "partial",
    checks,
    requiredSections: REQUIRED_SOLUTION_SECTIONS,
  };
}

function normalizeSolutionSteps(values = []) {
  const list = Array.isArray(values) ? values : String(values || "").split(/\n+/);
  return list
    .map((item, index) => {
      if (typeof item === "object" && item) {
        return {
          title: cleanText(item.title || `步骤 ${index + 1}`),
          detail: cleanText(item.detail || item.content || item.text || ""),
          formula: cleanText(item.formula || ""),
        };
      }
      return {
        title: `步骤 ${index + 1}`,
        detail: cleanText(item),
        formula: "",
      };
    })
    .filter((step) => step.detail || step.formula)
    .slice(0, 10);
}

function normalizeReviewCards(values = [], fallback = {}) {
  const list = Array.isArray(values) ? values : [];
  const cards = list
    .map((item) => ({
      type: cleanText(item.type || "review"),
      title: cleanText(item.title || item.front || ""),
      body: cleanText(item.body || item.back || item.content || ""),
    }))
    .filter((card) => card.title && card.body)
    .slice(0, 8);
  if (cards.length) return cards;
  return buildReviewCards(fallback.question, fallback.relatedConcepts, fallback.formulaHints, fallback.commonMistakes);
}

function buildReviewCards(question, concepts = [], formulas = [], mistakes = []) {
  const cards = [];
  if (concepts.length) {
    cards.push({
      type: "concept",
      title: `考点：${concepts[0]}`,
      body: `复习时先判断题目是否属于 ${concepts.slice(0, 3).join("、")}，再决定公式或方法入口。`,
    });
  }
  if (formulas.length) {
    cards.push({
      type: "formula",
      title: "公式入口",
      body: `优先核对 ${formulas[0]} 的变量含义和适用条件。`,
    });
  }
  cards.push({
    type: "method",
    title: "解题流程",
    body: "按“已知量/所求量 -> 方法选择 -> 列式或逻辑链 -> 结果校核”的顺序复盘。",
  });
  if (mistakes.length) {
    cards.push({
      type: "pitfall",
      title: "易错检查",
      body: mistakes.slice(0, 2).join("；"),
    });
  }
  if (!concepts.length && !formulas.length && question) {
    cards.push({
      type: "prompt",
      title: "题目记忆",
      body: clamp(cleanText(question), 180),
    });
  }
  return cards.slice(0, 6);
}

function buildLocalSteps(method, formulaHint, relatedConcepts = []) {
  return [
    { title: "题意与已知", detail: "圈出题目给出的量、条件、限制和最终所求，先不要急着代公式。", formula: "" },
    { title: "考点定位", detail: `判断题目入口：${method}${relatedConcepts.length ? ` 相关考点：${relatedConcepts.slice(0, 3).join("、")}。` : ""}`, formula: "" },
    { title: "列式或逻辑链", detail: formulaHint ? "把题设条件转成公式中的变量，检查单位和适用范围。" : "把条件转成方程、图示关系、守恒关系或证明链条。", formula: formulaHint || "" },
    { title: "求解与校核", detail: "完成代入、化简或推理后，用单位、边界条件、正负号和数量级检查结果。", formula: "" },
  ];
}

function buildLocalAnswer(method, formulaHint) {
  if (formulaHint) return `本地解题框架：先确认 ${method}，再使用 ${formulaHint} 完成列式，最后检查单位、符号和适用条件。`;
  return `本地解题框架：先确认 ${method}，再根据题设建立方程或逻辑链。当前题目缺少足够结构化数据，建议接入 API 生成完整数值推导。`;
}

function buildMistakeWarnings(method, formulaHint) {
  const warnings = ["没有先判断适用条件就代入。", "忽略单位、正负号或边界条件。"];
  if (formulaHint) warnings.push(`把 ${formulaHint} 中的变量含义混用。`);
  if (/受力|弯矩|轴力|扭矩|力学/.test(method)) warnings.push("受力图、内力图或危险截面判断错误。");
  return uniqueStrings(warnings).slice(0, 4);
}

function inferMethod(questionText, context, courseName = "") {
  const text = `${courseName} ${questionText} ${context.concepts.join(" ")}`;
  if (/弯矩|剪力|梁|挠度|惯性矩|弯曲/.test(text)) return "梁弯曲题：先画剪力图/弯矩图，确定危险截面，再做强度或变形校核。";
  if (/轴力|拉压|伸长|胡克|弹性模量|正应力/.test(text)) return "轴向拉压题：先用截面法求轴力，再由应力、应变和变形关系求解。";
  if (/扭矩|扭转|极惯性矩|剪应力/.test(text)) return "圆轴扭转题：先求扭矩分布，再用剪应力和扭转角公式。";
  if (/积分|导数|极限|微分|高等数学/.test(text)) return "高等数学题：先识别函数结构和条件，再选择求导、积分、极限或级数方法。";
  if (/电路|电压|电流|KCL|KVL|节点|回路/.test(text)) return "电路题：先定参考方向，再列 KCL/KVL 或等效模型。";
  if (/化学|平衡|浓度|反应|pH|Ksp/.test(text)) return "化学题：先识别反应类型、守恒关系和平衡条件，再列式计算。";
  return "综合 STEM 题：先识别题型入口和约束条件，再建立方程、模型或证明链条。";
}

function inferTitle(question, concepts = [], method = "") {
  if (concepts.length) return `${concepts[0]}解题`;
  const compact = cleanText(question).replace(/[：:，,。?？].*$/u, "");
  if (compact) return clamp(compact, 24);
  return clamp(method, 24) || "题目解答";
}

function inferTarget(question) {
  const match = cleanText(question).match(/(?:求|计算|证明|判断|说明|写出)([^。？?；;]{1,40})/u);
  return match ? cleanText(match[0]) : "按题目要求求解并说明理由";
}

function extractKnowns(question) {
  return uniqueStrings(
    cleanText(question)
      .split(/[，,。；;；]/)
      .filter((part) => /已知|给定|设|为|=|受|作用|长度|面积|浓度|电压|电流|质量|速度/.test(part))
      .slice(0, 8),
  );
}

function buildSimilarDrillPrompt(question, method, concepts = []) {
  return `基于原题“${clamp(cleanText(question), 120)}”，保持${concepts.slice(0, 2).join("、") || "同一考点"}和解题入口，改变数值、条件或问法，生成一道同类型训练题。解题入口：${method}`;
}

function normalizeStringList(values = []) {
  const list = Array.isArray(values) ? values : String(values || "").split(/\n|；|;/);
  return uniqueStrings(list.map(cleanText)).slice(0, 12);
}

function normalizeSourceRefs(sourceRefs = []) {
  return (Array.isArray(sourceRefs) ? sourceRefs : [])
    .map((ref) => ({
      document_id: cleanText(ref.document_id || ref.documentId || ""),
      file_name: cleanText(ref.file_name || ref.fileName || ref.docName || ""),
      unit_index: Number.isInteger(Number(ref.unit_index ?? ref.unitIndex)) ? Number(ref.unit_index ?? ref.unitIndex) : undefined,
      unit_label: cleanText(ref.unit_label || ref.unitLabel || ref.label || ""),
      locator_label: cleanText(ref.locator_label || ref.locatorLabel || ref.anchor_label || ref.label || ""),
      excerpt: clamp(cleanText(ref.excerpt || ref.anchor_text || ref.anchorText || ""), 240),
    }))
    .filter((ref) => ref.document_id)
    .slice(0, 8);
}

function makeSourceRef(doc, unit, unitIndex, text) {
  return {
    document_id: doc?.id || "",
    file_name: doc?.originalName || "",
    unit_index: unitIndex,
    unit_label: unit?.label || "全文",
    locator_label: unit?.label || "资料片段",
    excerpt: clamp(cleanText(text), 220),
  };
}

function extractChineseTerms(text) {
  return uniqueStrings(cleanText(text).match(/[\u4e00-\u9fff]{2,8}/g) || [])
    .filter((term) => !/已知|求解|计算|证明|判断|说明|如果|一个|多少|为何|怎么/.test(term))
    .slice(0, 8);
}

function extractFormulaHints(text) {
  const matches = cleanText(text).match(/(?:\\[A-Za-z]+|[A-Za-zσσετγθφωΩμνΔδψ])[\s_{}^A-Za-z0-9\\+\-*/=<>≈≤≥().,，;；·×±]{0,100}(?:=|≤|≥|≈|<|>|\/)[\s_{}^A-Za-z0-9\\+\-*/=<>≈≤≥().,，;；·×±σσετγθφωΩμνΔδψ]{1,120}/gu) || [];
  return uniqueStrings(matches.map((item) => wrapInlineFormula(item) || item)).slice(0, 5);
}

function tokenize(text) {
  return uniqueStrings([
    ...(cleanText(text).match(/[\u4e00-\u9fff]{2,8}/g) || []),
    ...(cleanText(text).match(/[A-Za-z][A-Za-z0-9_]{1,}/g) || []),
    ...(cleanText(text).match(/[σσετγθφωΩμνΔδψ]/gu) || []),
  ]).slice(0, 40);
}

function fallbackSteps(questionType) {
  if (questionType === "calculation") return ["识别已知量和所求量。", "选择适用公式并统一单位。", "代入计算并检查结果。"];
  return ["识别考点。", "组织关键条件。", "给出结论并说明理由。"];
}

function legacyType(questionType) {
  return {
    concept_understanding: "short",
    formula_application: "blank",
    calculation: "calculation",
    derivation_proof: "short",
    mistake_diagnosis: "choice",
    exam_practice: "calculation",
    textbook_exercise: "calculation",
    variant: "calculation",
    comprehensive: "calculation",
    subjective_recall: "short",
  }[questionType] || questionType || "short";
}

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 16)}`;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

module.exports = {
  REQUIRED_SOLUTION_SECTIONS,
  buildSolutionContext,
  localSolveQuestion,
  normalizeApiQuestion,
  normalizeApiQuestionList,
  normalizeSolution,
  solutionQuality,
};
