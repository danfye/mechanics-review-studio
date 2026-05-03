const {
  buildCourseKnowledgeModel,
  clamp,
  hashId,
  sourceDocumentIds,
  uniqueBy,
  uniqueStrings,
} = require("./knowledge-model.cjs");
const { evaluateQuestionSet, normalizeQuestionText } = require("./quality.cjs");
const { wrapInlineFormula } = require("./formula-format.cjs");
const { formulaIsUsable, verifiedFormulaScore } = require("./formula-verifier.cjs");
const { buildExerciseQuestion, localExerciseLibraryForCourse } = require("./local-exercise-library.cjs");

const QUESTION_TYPES = [
  "concept_understanding",
  "formula_application",
  "calculation",
  "derivation_proof",
  "mistake_diagnosis",
  "exam_practice",
  "textbook_exercise",
  "variant",
  "comprehensive",
  "subjective_recall",
];

function generateQuestionSet(courseOrModel, docsOrOptions = [], maybeOptions = {}) {
  const hasModel = courseOrModel?.schema_version && Array.isArray(courseOrModel?.chapters);
  const options = hasModel ? docsOrOptions || {} : maybeOptions || {};
  const courseModel = hasModel ? courseOrModel : buildCourseKnowledgeModel(courseOrModel, docsOrOptions || []);
  const count = Math.max(3, Math.min(Number(options.count || 16), 60));
  const warnings = [...(courseModel.warnings || [])];
  const targetTypes = normalizeTargetTypes(options.types);
  const candidates = [];

  candidates.push(...conceptQuestions(courseModel));
  candidates.push(...formulaQuestions(courseModel));
  candidates.push(...homeworkQuestions(courseModel));
  candidates.push(...localLibraryQuestions(courseModel));
  candidates.push(...mistakeQuestions(courseModel));
  candidates.push(...comprehensiveQuestions(courseModel));
  candidates.push(...subjectiveQuestions(courseModel));

  if (!courseModel.formulas?.length) warnings.push("资料不足：未识别到公式，公式应用题和计算题只生成有限的通用检查题。");
  if (!courseModel.homework_problems?.length) warnings.push("资料不足：未识别到作业题，无法保证每道作业题都有原题解析和两个变式。");
  if (!courseModel.mistake_points?.length) warnings.push("资料不足：未识别到高频易错点，错误诊断题会减少。");

  const filtered = targetTypes.size
    ? candidates.filter((question) => targetTypes.has(question.question_type) || targetTypes.has(legacyType(question.question_type)))
    : candidates;
  const selected = selectDiverseQuestions(filtered.length ? filtered : candidates, count, courseModel);
  const normalized = selected.map(toLegacyQuestionFields);
  const evaluation = evaluateQuestionSet(normalized, courseModel, { warnings });
  return {
    questions: normalized,
    evaluation,
    warnings: evaluation.warnings,
    provider: "local",
  };
}

function normalizeTargetTypes(types) {
  const values = Array.isArray(types) ? types : [];
  const mapped = values.flatMap((type) => {
    if (type === "choice") return ["concept_understanding"];
    if (type === "blank") return ["formula_application", "derivation_proof"];
    if (type === "short") return ["concept_understanding", "subjective_recall"];
    if (type === "calculation") return ["calculation"];
    return [type];
  });
  return new Set(mapped.filter(Boolean));
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
  }[questionType] || "short";
}

function conceptQuestions(model) {
  const questions = [];
  for (const concept of (model.concepts || []).slice(0, 12)) {
    const refs = concept.source_refs || [];
    questions.push(makeQuestion({
      seed: [concept.concept_id, "definition"],
      question_type: "concept_understanding",
      difficulty: concept.difficulty === "basic" ? "basic" : "medium",
      related_concepts: [concept.name],
      source_refs: refs,
      question_text: `定义解释：用自己的话说明“${concept.name}”的含义，并指出它在解题中通常连接哪个公式或步骤。`,
      answer: concept.description !== "unknown" ? concept.description : `资料中只识别到“${concept.name}”这一概念，定义需要回到来源页核对。`,
      step_by_step_solution: [
        "先写出概念的研究对象或物理量含义。",
        "再说明它与受力、变形、方程或校核条件的关系。",
        "最后指出使用时需要检查的条件或常见误区。",
      ],
      common_mistakes: ["只背名称，不说明适用场景。", "把相近概念或符号混用。"],
      grading_rubric: ["定义准确 4 分", "能联系解题步骤 3 分", "能说明适用条件或易错点 3 分"],
      estimated_time: 4,
      tags: ["概念", "复述", concept.name],
    }));
    questions.push(makeQuestion({
      seed: [concept.concept_id, "judge"],
      question_type: "concept_understanding",
      difficulty: "medium",
      related_concepts: [concept.name],
      source_refs: refs,
      question_text: `判断正误并解释：只要题目中出现“${concept.name}”，就可以不检查边界条件、单位和正负号，直接代入公式。`,
      answer: "错误。资料中的力学题需要先确认研究对象、适用条件、单位和符号约定，再决定能否代入公式。",
      step_by_step_solution: ["指出该说法过度泛化。", "列出至少两个必须检查的条件。", "结合来源中的公式、规则或例题说明原因。"],
      common_mistakes: ["认为识别关键词就等于会解题。", "忽略单位或正负号。"],
      grading_rubric: ["判断正确 2 分", "理由充分 5 分", "能联系资料来源 3 分"],
      estimated_time: 3,
      tags: ["判断", "概念辨析", concept.name],
    }));
  }
  return questions;
}

function formulaQuestions(model) {
  const questions = [];
  for (const formula of verifiedFormulasForGeneration(model)) {
    const refs = formula.source_refs || [];
    const relatedConcepts = relatedConceptsForItem(model, formula);
    const variables = formula.variables || [];
    const formulaText = formulaInline(formula);
    const variableText = variables.length
      ? variables.map((item) => `${item.symbol} 表示${item.meaning}`).join("，")
      : "资料未明确给出变量含义";
    questions.push(makeQuestion({
      seed: [formula.formula_id, "condition"],
      question_type: "formula_application",
      difficulty: "medium",
      related_concepts: relatedConcepts,
      source_refs: refs,
      question_text: `适用条件判断：公式 ${formulaText} 能否直接用于任意受力位置？请说明适用条件和不能使用的情况。`,
      answer: `不能无条件使用。适用条件：${formula.applicable_conditions || "unknown"}。变量含义：${variableText}。`,
      step_by_step_solution: ["先识别公式对应的物理模型。", "列出变量含义。", "检查资料中给出的适用条件或不适用区域。", "说明错误套用会导致什么问题。"],
      common_mistakes: normalizeMistakes(formula.common_misuses, ["没有检查适用条件。"]),
      grading_rubric: ["变量含义 3 分", "适用条件 4 分", "反例或误用说明 3 分"],
      estimated_time: 5,
      tags: ["公式", "适用条件", formula.name],
    }));

    questions.push(makeQuestion({
      seed: [formula.formula_id, "calculation"],
      question_type: "calculation",
      difficulty: formula.difficulty === "hard" ? "hard" : "medium",
      related_concepts: relatedConcepts,
      source_refs: refs,
      question_text: calculationPrompt(formula),
      answer: calculationAnswer(formula),
      step_by_step_solution: calculationSteps(formula),
      common_mistakes: normalizeMistakes(formula.common_misuses, ["单位未统一。", "把外力和内力混用。"]),
      grading_rubric: ["列式正确 4 分", "代入逻辑清楚 3 分", "单位和结果解释 3 分"],
      estimated_time: formula.difficulty === "hard" ? 10 : 7,
      tags: ["计算", "公式", formula.name],
    }));

    questions.push(makeQuestion({
      seed: [formula.formula_id, "derive"],
      question_type: "derivation_proof",
      difficulty: "hard",
      related_concepts: relatedConcepts,
      source_refs: refs,
      question_text: `推导/补全步骤：从资料中的基本关系出发，说明 ${formulaText} 每一步的物理或数学意义。`,
      answer: `核心是先明确研究对象和基本假设，再用平衡、几何或本构关系得到 ${formulaText}。`,
      step_by_step_solution: [
        "写出研究对象和基本假设。",
        "列出与公式相关的平衡、几何或本构关系。",
        "说明每个变量来自哪个物理量。",
        "指出公式适用条件。",
      ],
      common_mistakes: normalizeMistakes(formula.common_misuses, ["只记结论，不说明假设来源。"]),
      grading_rubric: ["基本关系 3 分", "推导步骤 4 分", "物理意义和条件 3 分"],
      estimated_time: 8,
      tags: ["推导", "公式", formula.name],
    }));
  }
  return questions;
}

function homeworkQuestions(model) {
  const questions = [];
  for (const problem of model.homework_problems || []) {
    const refs = problem.source_refs || [];
    const related = problem.related_concepts?.length ? problem.related_concepts : relatedConceptsForItem(model, problem);
    questions.push(makeQuestion({
      seed: [problem.homework_problem_id, "original"],
      question_type: "calculation",
      difficulty: problem.difficulty || "medium",
      related_concepts: related,
      source_refs: refs,
      question_text: `原题解析：${problem.problem_text}`,
      answer: problem.solution_outline !== "unknown" ? problem.solution_outline : "资料只提供了题干线索，需按研究对象、方程、条件、校核四步补全解答。",
      step_by_step_solution: ["圈出已知量和所求量。", "判断对应章节和公式。", "列方程并说明符号约定。", "完成计算或判断并检查单位。"],
      common_mistakes: ["没有把题干中的条件转成方程。", "直接套公式但没有说明适用范围。"],
      grading_rubric: ["题意分析 2 分", "公式或方法选择 3 分", "过程和校核 5 分"],
      estimated_time: 8,
      tags: ["原题解析", "作业", problem.problem_number || "unknown"],
    }));

    questions.push(makeVariantQuestion(problem, model, 1));
    questions.push(makeVariantQuestion(problem, model, 2));
  }
  return questions;
}

function localLibraryQuestions(model) {
  const exercises = localExerciseLibraryForCourse(model, { limit: 18, minCount: 8 });
  const questions = [];
  for (const exercise of exercises) {
    questions.push(makeQuestion(buildExerciseQuestion(exercise, 0)));
    if (exercise.type === "exam_practice" || exercise.difficulty === "hard") {
      questions.push(makeQuestion(buildExerciseQuestion(exercise, 1)));
    }
  }
  return questions;
}

function makeVariantQuestion(problem, model, variantIndex) {
  const addedCondition = variantIndex === 1 ? "改变一个载荷或截面参数" : "增加一个干扰条件，并说明该条件是否影响求解";
  const related = problem.related_concepts?.length ? problem.related_concepts : relatedConceptsForItem(model, problem);
  return makeQuestion({
    seed: [problem.homework_problem_id, "variant", variantIndex],
    question_type: "variant",
    difficulty: variantIndex === 1 ? "medium" : "hard",
    related_concepts: related,
    source_refs: problem.source_refs || [],
    question_text: `变式题 ${variantIndex}：基于原题“${clamp(problem.problem_text, 140)}”，${addedCondition}，重新判断解题入口并写出完整解法框架。`,
    answer: "保持原题的结构关系，先识别不变量和变化量，再重列方程。干扰条件若不进入平衡、几何或本构关系，应说明不采用。",
    step_by_step_solution: ["对比原题和变式题条件。", "标出变化量和不变关系。", "重新列式。", "说明干扰条件是否进入计算。"],
    common_mistakes: ["只改数值不重新检查条件。", "把无关干扰条件强行代入。"],
    grading_rubric: ["识别结构 3 分", "处理变化条件 4 分", "结果校核 3 分"],
    estimated_time: variantIndex === 1 ? 8 : 10,
    tags: ["变式", "作业", problem.problem_number || "unknown"],
  });
}

function mistakeQuestions(model) {
  const questions = [];
  for (const mistake of model.mistake_points || []) {
    const related = mistake.related_concepts?.length ? mistake.related_concepts : relatedConceptsForItem(model, mistake);
    questions.push(makeQuestion({
      seed: [mistake.mistake_point_id, "diagnosis"],
      question_type: "mistake_diagnosis",
      difficulty: mistake.severity === "high" ? "hard" : "medium",
      related_concepts: related,
      source_refs: mistake.source_refs || [],
      question_text: `错误诊断题：某同学解题时出现下面做法：“${mistake.description}”。请判断错在哪里，并给出正确检查步骤。`,
      answer: `错误关键在于：${mistake.description}。应回到来源资料中的定义、公式适用条件、单位或正负号规则逐项检查。`,
      step_by_step_solution: ["定位错误属于概念、公式、条件、单位还是符号。", "引用来源页中的正确规则。", "给出防止再次出错的检查清单。"],
      common_mistakes: ["只说结果错，不指出错因。", "没有回到来源规则。"],
      grading_rubric: ["错因定位 4 分", "正确规则 4 分", "检查清单 2 分"],
      estimated_time: 6,
      tags: ["易错", "错误诊断"],
    }));
  }
  return questions;
}

function comprehensiveQuestions(model) {
  const questions = [];
  const chapters = model.chapters || [];
  if (chapters.length < 2 && (model.formulas || []).length < 2) return questions;
  const relatedConcepts = uniqueStrings((model.concepts || []).slice(0, 6).map((concept) => concept.name));
  const sourceRefs = uniqueBy(
    [
      ...chapters.flatMap((chapter) => chapter.source_refs || []),
      ...(model.formulas || []).flatMap((formula) => formula.source_refs || []),
    ],
    (ref) => `${ref.document_id}:${ref.unit_index}:${ref.excerpt}`,
  ).slice(0, 4);
  questions.push(makeQuestion({
    seed: [model.course?.course_id, "comprehensive", relatedConcepts.join(",")],
    question_type: "comprehensive",
    difficulty: "comprehensive",
    related_concepts: relatedConcepts,
    source_refs: sourceRefs,
    question_text: `综合题：围绕 ${relatedConcepts.slice(0, 4).join("、") || model.course?.name || "本课程"}，设计一道跨知识点解题流程题，并写出从受力/条件识别到结果校核的完整步骤。`,
    answer: "完整答案应包含：研究对象、关键概念、公式或规则、条件检查、多步骤求解、单位/正负号/合理性校核。",
    step_by_step_solution: ["确定跨章节连接点。", "列出每个知识点负责解决的问题。", "按顺序建立方程或判断链条。", "用易错点做最后校核。"],
    common_mistakes: ["把多个知识点并列罗列，没有形成解题链条。", "跳过条件检查。"],
    grading_rubric: ["知识点连接 3 分", "完整流程 4 分", "校核和易错点 3 分"],
    estimated_time: 15,
    tags: ["综合", "跨章节", "考试重点"],
  }));
  return questions;
}

function subjectiveQuestions(model) {
  const questions = [];
  for (const chapter of (model.chapters || []).slice(0, 8)) {
    questions.push(makeQuestion({
      seed: [chapter.chapter_id, "recall"],
      question_type: "subjective_recall",
      difficulty: "basic",
      related_concepts: (model.concepts || []).filter((concept) => concept.chapter_id === chapter.chapter_id).map((concept) => concept.name).slice(0, 4),
      source_refs: chapter.source_refs || [],
      question_text: `主观复述题：不看资料，用 3-5 句话复述“${chapter.title}”的核心内容、一个公式或规则、一个易错点。`,
      answer: "答案应覆盖章节主题、核心概念/公式、典型题型和易错检查点。可对照来源页补全遗漏。",
      step_by_step_solution: ["先说本节解决什么问题。", "再说核心概念或公式。", "最后说一个例题入口或易错点。"],
      common_mistakes: ["复述只罗列标题，没有说明关系。"],
      grading_rubric: ["主题准确 3 分", "公式/规则 3 分", "易错点和题型 4 分"],
      estimated_time: 4,
      tags: ["复述", "章节", chapter.title],
    }));
  }
  return questions;
}

function makeQuestion(input) {
  const questionId = hashId("question", [input.question_type, ...(input.seed || []), input.question_text]);
  return {
    question_id: questionId,
    question_type: input.question_type,
    difficulty: input.difficulty || "medium",
    related_concepts: uniqueStrings(input.related_concepts || []),
    source_refs: input.source_refs?.length ? input.source_refs : [],
    question_text: input.question_text,
    answer: input.answer || "资料不足，无法生成可靠答案。",
    step_by_step_solution: input.step_by_step_solution?.length ? input.step_by_step_solution : ["资料不足：请回到来源页补充解题步骤。"],
    common_mistakes: input.common_mistakes?.length ? input.common_mistakes : ["资料不足，未识别到明确易错点。"],
    grading_rubric: input.grading_rubric?.length ? input.grading_rubric : ["答案贴合资料来源", "步骤完整", "说明适用条件"],
    estimated_time: Number(input.estimated_time || 5),
    tags: uniqueStrings(input.tags || []),
  };
}

function toLegacyQuestionFields(question) {
  const sourceIds = sourceDocumentIds(question.source_refs || []);
  return {
    ...question,
    id: question.question_id,
    type: legacyType(question.question_type),
    stem: question.question_text,
    explanation: question.step_by_step_solution.join(" "),
    sourceDocumentIds: sourceIds,
    options: question.question_type === "mistake_diagnosis" ? ["错误", "正确", "资料不足，无法判断"] : [],
  };
}

function selectDiverseQuestions(candidates, count, model) {
  const deduped = uniqueBy(candidates, normalizeQuestionText).sort((a, b) => questionSelectionScore(b, model) - questionSelectionScore(a, model));
  const selected = [];
  const byChapter = new Map();
  for (const question of deduped) {
    const chapterKey = question.source_refs?.[0]?.unit_label || "unknown";
    if (!byChapter.has(chapterKey)) byChapter.set(chapterKey, []);
    byChapter.get(chapterKey).push(question);
  }

  const preferredTypes = QUESTION_TYPES;
  for (const type of preferredTypes) {
    if (selected.length >= count) return selected;
    const question = deduped.find((candidate) => !selected.includes(candidate) && candidate.question_type === type);
    if (question) selected.push(question);
  }

  const libraryTarget = Math.min(
    Math.floor(count * 0.35),
    deduped.filter(isLocalLibraryQuestion).length,
  );
  for (const question of deduped.filter(isLocalLibraryQuestion)) {
    if (selected.length >= count || selected.filter(isLocalLibraryQuestion).length >= libraryTarget) break;
    if (!selected.includes(question)) selected.push(question);
  }

  const difficulties = ["basic", "medium", "hard", "comprehensive"];
  for (const difficulty of difficulties) {
    for (const chapter of model.chapters || []) {
      const question = deduped.find(
        (candidate) =>
          !selected.includes(candidate) &&
          candidate.difficulty === difficulty &&
          candidate.source_refs?.some((ref) => chapter.source_refs?.some((source) => source.document_id === ref.document_id)),
      );
      if (question) selected.push(question);
      if (selected.length >= count) return selected;
    }
  }

  while (selected.length < count && selected.length < deduped.length) {
    const nextType = preferredTypes[selected.length % preferredTypes.length];
    const next =
      deduped.find((candidate) => !selected.includes(candidate) && candidate.question_type === nextType) ||
      deduped.find((candidate) => !selected.includes(candidate));
    if (!next) break;
    selected.push(next);
  }
  return selected.slice(0, count);
}

function isLocalLibraryQuestion(question) {
  return (question.tags || []).some((tag) => tag === "考试题型库" || tag === "教材习题库" || tag === "本地题库" || tag === "变式拓展");
}

function questionSelectionScore(question, model) {
  const typeWeights = {
    exam_practice: 42,
    textbook_exercise: 40,
    calculation: 34,
    comprehensive: 32,
    variant: 30,
    formula_application: 28,
    derivation_proof: 24,
    mistake_diagnosis: 24,
    concept_understanding: 16,
    subjective_recall: 12,
  };
  const difficultyWeights = { basic: 4, medium: 10, hard: 14, comprehensive: 16 };
  const conceptNames = new Set((model.concepts || []).map((concept) => concept.name));
  const conceptHits = (question.related_concepts || []).filter((concept) => conceptNames.has(concept)).length;
  const libraryBoost = (question.tags || []).some((tag) => tag === "考试题型库" || tag === "教材习题库") ? 18 : 0;
  const sourceBoost = question.source_refs?.length ? 8 : 0;
  return (
    (typeWeights[question.question_type] || 10) +
    (difficultyWeights[question.difficulty] || 6) +
    Math.min(18, conceptHits * 6) +
    libraryBoost +
    sourceBoost
  );
}

function relatedConceptsForItem(model, item) {
  const text = JSON.stringify(item);
  const names = (model.concepts || []).filter((concept) => text.includes(concept.name)).map((concept) => concept.name);
  return uniqueStrings(names).slice(0, 5);
}

function normalizeMistakes(mistakes, fallback) {
  const values = Array.isArray(mistakes) ? mistakes.filter((item) => item && item !== "unknown") : [];
  return values.length ? values : fallback;
}

function calculationPrompt(formula) {
  const expression = formulaInline(formula);
  if (/轴向拉压|正应力|\\sigma|σ|F_N|F_\{N\}/.test(`${formula.name}\n${formula.expression}`)) {
    return `基础计算题：等截面杆已知轴力 F_N 和截面面积 A。根据资料中的 ${expression}，写出正应力表达式，并说明拉压正负号如何处理。`;
  }
  if (/弯曲|M|I/.test(`${formula.name}\n${formula.expression}`)) {
    return `多步骤计算题：梁的危险截面弯矩为 M，截面惯性矩为 I，最外缘距离为 y。根据 ${expression} 求最大正应力，并说明危险截面如何确定。`;
  }
  if (/扭转|\\tau|τ|T|J/.test(`${formula.name}\n${formula.expression}`)) {
    return `计算题：圆轴承受扭矩 T，半径位置为 r，极惯性矩为 J。根据 ${expression} 求该点剪应力，并说明最大值位置。`;
  }
  return `计算题：根据资料中的公式 ${expression}，设计一组已知量并写出代入、计算和单位检查流程。`;
}

function calculationAnswer(formula) {
  const sourceNote = formula.reference_match ? `参考校验：${formula.reference_match.name}。` : "该公式未命中基础公式库，必须回到来源页核对。";
  return `按资料公式 ${formulaInline(formula)} 建立计算关系。${sourceNote}变量含义：${
    (formula.variables || []).map((item) => `${item.symbol}=${item.meaning}`).join("，") || "unknown"
  }。适用条件：${formula.applicable_conditions || "unknown"}。`;
}

function calculationSteps(formula) {
  return [
    "整理已知量和所求量，统一单位。",
    `确认公式适用条件：${formula.applicable_conditions || "unknown"}。`,
    `代入公式：${formulaInline(formula)}。`,
    "计算后检查正负号、单位和物理合理性。",
  ];
}

function formulaInline(formula) {
  return wrapInlineFormula(formula.expression) || formula.expression || "unknown";
}

function verifiedFormulasForGeneration(model) {
  return [...(model.formulas || [])]
    .filter((formula) => formulaIsUsable(formula, { requireReference: true }))
    .sort((a, b) => verifiedFormulaScore(b) - verifiedFormulaScore(a) || Number(b.exam_focus?.score || 0) - Number(a.exam_focus?.score || 0));
}

module.exports = {
  QUESTION_TYPES,
  generateQuestionSet,
};
