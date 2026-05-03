const {
  buildCourseKnowledgeModel,
  cleanText,
  hashId,
  isContentsLikeText,
  splitSentences,
  uniqueBy,
  uniqueStrings,
} = require("./knowledge-model.cjs");
const { scoreConceptImportance } = require("./exam-focus.cjs");
const { toLatexFormula } = require("./formula-format.cjs");

function generateMindMap(courseOrModel, docsOrOptions = [], maybeOptions = {}) {
  const hasModel = courseOrModel?.schema_version && Array.isArray(courseOrModel?.chapters);
  const options = hasModel ? docsOrOptions || {} : maybeOptions || {};
  const model = hasModel ? courseOrModel : buildCourseKnowledgeModel(courseOrModel, docsOrOptions || []);
  const nodes = [];
  const edges = [];

  for (const chapter of model.chapters || []) {
    nodes.push(nodeFromItem(chapter.chapter_id, "chapter", chapter.title, chapter, {
      chapter_id: chapter.chapter_id,
      difficulty: chapter.difficulty,
      exam_focus: chapter.exam_focus,
      badges: chapter.exam_focus?.level === "high" ? ["高频考点"] : [],
    }));
    if (chapter.exam_focus?.level !== "low") {
      const focusId = hashId("focus", [chapter.chapter_id, chapter.exam_focus.level]);
      nodes.push(nodeFromItem(focusId, "exam_focus", chapter.title, chapter, {
        chapter_id: chapter.chapter_id,
        difficulty: chapter.difficulty,
        exam_focus: chapter.exam_focus,
        badges: ["考试重点"],
        summary: focusSummary(chapter, model),
      }));
      edges.push(makeEdge(focusId, chapter.chapter_id, "belongs_to", "考试重点归属章节", chapter.source_refs));
    }
  }

  addObjectNodes(nodes, edges, model.concepts || [], "concept", "concept_id", "name");
  addObjectNodes(nodes, edges, model.formulas || [], "formula", "formula_id", "name", (item) => item.expression);
  addObjectNodes(nodes, edges, model.theorem_or_rules || [], "theorem_or_rule", "rule_id", "name", (item) => item.statement);
  addObjectNodes(nodes, edges, model.examples || [], "example", "example_id", "title", (item) => item.problem_text);
  addObjectNodes(nodes, edges, model.homework_problems || [], "homework_problem", "homework_problem_id", "title", (item) => item.problem_text);
  addObjectNodes(nodes, edges, model.mistake_points || [], "mistake_point", "mistake_point_id", "description", (item) => item.description);

  for (const edge of model.dependency_edges || []) {
    edges.push(makeEdge(edge.from_id, edge.to_id, edge.relation, edge.description, edge.source_refs, edge.confidence));
  }

  for (const formula of model.formulas || []) {
    for (const concept of (model.concepts || []).filter((item) => item.chapter_id === formula.chapter_id).slice(0, 3)) {
      edges.push(makeEdge(formula.formula_id, concept.concept_id, "depends_on", `${formula.name} 依赖 ${concept.name}`, formula.source_refs, "low"));
    }
  }
  for (const problem of [...(model.examples || []), ...(model.homework_problems || [])]) {
    const problemId = problem.example_id || problem.homework_problem_id;
    for (const concept of (model.concepts || []).filter((item) => problem.related_concepts?.includes(item.name)).slice(0, 3)) {
      edges.push(makeEdge(concept.concept_id, problemId, "tested_by", `${concept.name} 被该题考察`, problem.source_refs, "medium"));
    }
  }
  for (const mistake of model.mistake_points || []) {
    for (const concept of (model.concepts || []).filter((item) => item.chapter_id === mistake.chapter_id).slice(0, 2)) {
      edges.push(makeEdge(concept.concept_id, mistake.mistake_point_id, "causes_mistake", `${concept.name} 容易导致该错误`, mistake.source_refs, "low"));
    }
  }
  addSimilarityEdges(model, edges);

  const filtered = applyFilters(
    {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      course: model.course,
      nodes: uniqueBy(nodes, (node) => node.id),
      edges: uniqueBy(edges, (edge) => `${edge.from_id}:${edge.to_id}:${edge.relation}`),
    },
    options,
  );
  const cardDeck = buildKnowledgeCardDeck(model, filtered, options);
  return {
    ...filtered,
    cardDeck,
    mermaid: toMermaid(filtered),
    json: JSON.stringify(filtered, null, 2),
    stats: {
      nodes: filtered.nodes.length,
      edges: filtered.edges.length,
      chapters: filtered.nodes.filter((node) => node.type === "chapter").length,
      formulas: filtered.nodes.filter((node) => node.type === "formula").length,
      mistakes: filtered.nodes.filter((node) => node.type === "mistake_point").length,
      cards: cardDeck.cards.length,
    },
  };
}

function nodeFromItem(id, type, label, item, extra = {}) {
  const summary = nodeSummary(type, label, item, extra);
  return {
    id,
    type,
    label: cleanNodeLabel(label || "unknown"),
    chapter_id: extra.chapter_id || item.chapter_id || "unknown",
    difficulty: extra.difficulty || item.difficulty || "medium",
    exam_focus: extra.exam_focus || item.exam_focus || { level: "low", score: 0, reasons: [] },
    source_refs: cleanSourceRefs(item.source_refs || []),
    summary,
    formula: type === "formula" ? toLatexFormula(extra.summary || item.expression || label || "", { extract: true }) : "",
    related_question_ids: [],
    badges: extra.badges || badgesFor(type, item),
  };
}

function cleanNodeLabel(value) {
  return cleanText(value)
    .replace(/^考试重点[：:]\s*/u, "")
    .replace(/\s*[-－–—]\s*/g, "-")
    .replace(/\s*[、,.，．]\s*/g, "、")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 54);
}

function nodeSummary(type, label, item, extra = {}) {
  if (type === "exam_focus") return cleanSummary(extra.summary || focusSummary(item));
  if (type === "chapter") return cleanSummary(chapterSummary(item));
  if (type === "concept") return conceptSummary(label, item);
  if (type === "formula") return cleanSummary(item.applicable_conditions && item.applicable_conditions !== "unknown" ? item.applicable_conditions : item.name);
  return cleanSummary(extra.summary || item.description || item.statement || item.problem_text || label || "unknown");
}

function conceptSummary(label, item = {}) {
  const name = cleanNodeLabel(label);
  const fallback = CONCEPT_SUMMARY_FALLBACKS[name];
  const summary = cleanConceptSummary(name, item.description || "");
  if (fallback && shouldPreferConceptFallback(name, summary, fallback)) return fallback;
  if (fallback && (!summary || summary.length > fallback.length + 28 || /作出|推论|结论|下图|图中|简易桁架|^\(?\d+\)?/.test(summary))) return fallback;
  if (fallback && isNoisySummary(summary, name)) return fallback;
  return summary || fallback || `围绕“${name}”复述定义、适用条件和典型题入口。`;
}

const CONCEPT_SUMMARY_FALLBACKS = {
  轴向拉压: "外力合力作用线与杆件轴线重合，杆件主要沿轴线方向伸长或缩短。",
  轴力: "横截面上的内力，作用线通过截面形心并垂直于横截面，通常记为 F_N。",
  轴力图: "表示轴力沿杆轴线位置变化的图形，用来确定最大轴力和危险截面。",
  应力: "截面上一点处内力的密集程度，强度校核时需要区分正应力和剪应力。",
  正应力: "垂直于截面的应力分量，轴向拉压杆常用公式为 \\sigma = \\frac{F_N}{A}。",
  圣维南原理: "不同等效加载方式主要影响载荷作用点附近区域，远离加载区后应力分布趋于一致。",
  平面截面假设: "变形前为平面的横截面，变形后仍保持平面并垂直于杆轴线。",
  平衡方程: "由受力平衡列出的方程，用来求未知内力、约束反力或截面力。",
  危险截面: "内力或应力达到控制值的截面，强度校核通常优先在这里进行。",
  受力分析: "明确研究对象、外力、约束反力和内力方向，是列方程前的第一步。",
  适用条件: "公式使用前必须检查载荷形式、边界条件、变形假设和局部效应范围。",
  强度条件: "要求工作应力不超过材料许用应力，用来判断构件是否安全。",
};

function shouldPreferConceptFallback(name, summary, fallback) {
  if (!summary) return true;
  if (summary === fallback) return false;
  if (["应力", "正应力", "轴力图", "圣维南原理", "平面截面假设", "危险截面", "受力分析"].includes(name)) return true;
  if (/利用平衡关系|横坐标轴|确定出最大轴力|可知：下图/.test(summary)) return true;
  return false;
}

function cleanConceptSummary(name, value) {
  const raw = cleanText(value);
  if (!raw || /^unknown$/i.test(raw)) return "";
  const sentences = splitSentences(raw);
  const useful =
    sentences.find((sentence) => isGoodConceptSentence(sentence, name, true)) ||
    sentences.find((sentence) => isGoodConceptSentence(sentence, name, false)) ||
    "";
  const summary = cleanSummary(useful || raw, 130);
  return isNoisySummary(summary, name) ? "" : summary;
}

function isGoodConceptSentence(sentence, name, requireName) {
  const text = cleanSummary(sentence, 160);
  if (!text || isNoisySummary(text, name)) return false;
  if (requireName && !text.includes(name)) return false;
  if (/拓展|例题|思考题|问题|公式适用条件|理论分析|实验验证|画轴力图|作出|推论|结论|下图|图中|简易桁架/.test(text)) return false;
  return /是|指|表示|定义|特点|作用|用来|意义|条件|规定|假设|原理|变形|受力/.test(text);
}

function isNoisySummary(summary, label) {
  const text = cleanText(summary);
  if (!text || text === "unknown") return true;
  if (text.replace(/\s+/g, "") === label.replace(/\s+/g, "")) return true;
  if (/\d+\s*[-－–—]\s*\d+\s*[、,.，．:：]/.test(text)) return true;
  if (isContentsLikeText(text)) return true;
  if (/(?:\b[A-Z]\s*\d+\s*){3,}|(?:\b[A-Z]\s*){4,}|(?:\bF\s*){4,}|F\s*=\s*N\s*F|Φ|TaoFM/i.test(text)) return true;
  if (/^拓展|^截面法求轴力|^画轴力图|理论分析|实验验证|问题 的提出/.test(text)) return true;
  if (/作出|推论|结论|下图|图中|简易桁架/.test(text) && text.length > 45) return true;
  const symbolNoise = (text.match(/\bF\s*N|\bF\b|\bN\b|\bA\b|\bM\b|σ|τ|γ|∫|Φ|A\(x\)|F_N/gu) || []).length;
  if (text.length > 90 && symbolNoise >= 6) return true;
  if (text.length > 110 && !/[。；;，,]/.test(text.slice(0, 50)) && symbolNoise >= 3) return true;
  return false;
}

function chapterSummary(chapter) {
  const refText = (chapter.source_refs || []).map((ref) => ref.excerpt).join(" ");
  const sentences = splitSentences(refText);
  const useful =
    sentences.find((sentence) => !isContentsLikeText(sentence) && !sentence.includes(chapter.title) && /特点|外力|轴线|变形|公式|条件|截面|应力|伸长|缩短/.test(sentence)) ||
    sentences.find((sentence) => !isContentsLikeText(sentence) && !sentence.includes(chapter.title) && sentence.length >= 8) ||
    "";
  return useful || "按定义、公式、例题和易错点整理本节。";
}

function focusSummary(chapter, model = {}) {
  const parts = [];
  const concepts = (model.concepts || []).filter((item) => item.chapter_id === chapter.chapter_id).map((item) => item.name);
  const formulas = (model.formulas || []).filter((item) => item.chapter_id === chapter.chapter_id).map((item) => item.expression);
  const mistakes = normalizedMistakeTexts((model.mistake_points || []).filter((item) => item.chapter_id === chapter.chapter_id));
  if (concepts.length) parts.push(`概念：${uniqueStrings(concepts).slice(0, 3).join("、")}`);
  if (formulas.length) parts.push(`公式：${formulas.map((item) => toLatexFormula(item)).filter(Boolean).slice(0, 2).join("；")}`);
  if (mistakes.length) parts.push(`易错：${cleanSummary(mistakes[0], 42)}`);
  if (parts.length) return parts.join("。");
  return chapterSummary(chapter);
}

function cleanSummary(value, maxLength = 120) {
  const text = cleanText(value)
    .replace(/^unknown$/i, "")
    .replace(/^考试重点[：:]\s*/u, "")
    .replace(/材料力学/gu, "")
    .replace(/(?:\b[A-Z]\s*\d+\s*){3,}/g, " ")
    .replace(/(?:\bF\s*){4,}/g, " ")
    .replace(/\s*Φ\s*/g, " ")
    .replace(/\s+\d{1,3}\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "按来源页复述定义、条件和典型题入口。";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function cleanSourceRefs(refs) {
  return uniqueBy(
    (refs || []).map((ref) => ({
      ...ref,
      excerpt: cleanSourceExcerpt(ref.excerpt || ref.anchor_text || ""),
    })),
    (ref) => `${ref.document_id}:${ref.unit_index}:${ref.excerpt}`,
  ).filter((ref) => ref.excerpt);
}

function cleanSourceExcerpt(value) {
  const text = cleanText(value)
    .replace(/材料力学/gu, "")
    .replace(/\s+\d{1,3}\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (isContentsLikeText(text)) return "";
  const sentences = splitSentences(text);
  const useful =
    sentences.find((sentence) => !isContentsLikeText(sentence) && /特点|外力|轴线|变形|公式|条件|轴力|应力|伸长|缩短|截面/.test(sentence)) ||
    sentences.find((sentence) => !isContentsLikeText(sentence)) ||
    text;
  return useful.length > 96 ? `${useful.slice(0, 95)}…` : useful;
}

function addObjectNodes(nodes, edges, items, type, idField, labelField, summaryFn) {
  for (const item of items) {
    const id = item[idField];
    if (!id) continue;
    nodes.push(nodeFromItem(id, type, item[labelField], item, { summary: summaryFn ? summaryFn(item) : undefined }));
    if (item.chapter_id && item.chapter_id !== "unknown") {
      edges.push(makeEdge(id, item.chapter_id, "belongs_to", "属于该章节", item.source_refs));
    }
  }
}

function makeEdge(fromId, toId, relation, label, sourceRefs = [], confidence = "medium") {
  return {
    edge_id: hashId("map_edge", [fromId, toId, relation, label]),
    from_id: fromId,
    to_id: toId,
    relation,
    label: label || relation,
    source_refs: sourceRefs || [],
    confidence,
  };
}

function badgesFor(type, item) {
  const badges = [];
  if (item.exam_focus?.level === "high") badges.push("高频考点");
  if (type === "mistake_point") badges.push("易错点");
  if (type === "formula") badges.push("公式");
  if (item.difficulty === "comprehensive") badges.push("综合");
  return badges;
}

function addSimilarityEdges(model, edges) {
  const conceptNames = (model.concepts || []).map((concept) => concept.name);
  const pairRules = [
    ["轴力", "应力", "contrasts_with", "轴力是截面内力，应力是单位面积内力密集程度"],
    ["拉伸", "压缩", "contrasts_with", "拉压方向和正负号相反"],
    ["剪力", "弯矩", "similar_to", "二者都来自梁的内力分析，但物理量不同"],
    ["应力", "应变", "similar_to", "二者通过本构关系联系"],
  ];
  for (const [a, b, relation, label] of pairRules) {
    const left = (model.concepts || []).find((concept) => conceptNames.includes(a) && concept.name.includes(a));
    const right = (model.concepts || []).find((concept) => conceptNames.includes(b) && concept.name.includes(b));
    if (left && right) edges.push(makeEdge(left.concept_id, right.concept_id, relation, label, [...left.source_refs, ...right.source_refs], "low"));
  }
}

const CARD_KIND_META = {
  focus: { label: "考点卡", icon: "target", tone: "focus" },
  concept: { label: "概念卡", icon: "network", tone: "concept" },
  formula: { label: "公式卡", icon: "sigma", tone: "formula" },
  problem: { label: "题型卡", icon: "file-question", tone: "problem" },
  mistake: { label: "易错卡", icon: "alert-triangle", tone: "mistake" },
};

function buildKnowledgeCardDeck(model, map = {}, options = {}) {
  const scoped = scopedModelParts(model, options);
  const cards = [
    ...buildFocusCards(model, scoped),
    ...buildConceptCards(model, scoped),
    ...buildFormulaCards(model, scoped),
    ...buildProblemCards(model, scoped),
    ...buildMistakeCards(model, scoped),
  ];
  const dedupedCards = uniqueBy(cards.filter(Boolean), (card) => `${card.kind}:${card.title}:${card.primary_formula || ""}`);
  const deckCards = balancedCardDeck(dedupedCards, options.cardLimit || 24);
  const lanes = [
    makeLane("focus", "考点卡", "按概念群、公式群和题型入口聚合，不按页号切片。", deckCards, 4),
    makeLane("concept", "概念卡", "只保留有考纲优先级或公式/题目证据支撑的核心概念。", deckCards, 6),
    makeLane("formula", "公式卡", "每张卡保留适用条件、变量含义和常见误用。", deckCards, 6),
    makeLane("problem", "题型卡", "从例题/作业反推题型入口和解题动作。", deckCards, 5),
    makeLane("mistake", "易错卡", "把资料里的注意点转成考前检查清单。", deckCards, 5),
  ].filter((lane) => lane.cards.length);
  const visualPlan = buildVisualPlan(model, scoped, deckCards, lanes);

  return {
    title: model.course?.name || "当前科目",
    generated_at: map.generated_at || new Date().toISOString(),
    cards: deckCards,
    lanes,
    visual_plan: visualPlan,
    key_connections: buildDeckConnections(map, deckCards),
    stats: {
      cards: deckCards.length,
      lanes: lanes.length,
      concepts: scoped.concepts.length,
      formulas: scoped.formulas.length,
      problems: scoped.problems.length,
      mistakes: scoped.mistakes.length,
    },
  };
}

function balancedCardDeck(cards = [], limit = 24) {
  const sorted = [...cards].sort((a, b) => b.priority - a.priority);
  const required = ["focus", "concept", "formula", "problem", "mistake"]
    .map((kind) => sorted.find((card) => card.kind === kind))
    .filter(Boolean);
  return uniqueBy([...required, ...sorted], (card) => card.card_id || `${card.kind}:${card.title}`).slice(0, limit);
}

function buildVisualPlan(model, scoped, cards, lanes) {
  const focusCards = cards.filter((card) => card.kind === "focus").sort((a, b) => b.priority - a.priority);
  const conceptCards = cards.filter((card) => card.kind === "concept").sort((a, b) => b.priority - a.priority);
  const formulaCards = cards.filter((card) => card.kind === "formula").sort((a, b) => b.priority - a.priority);
  const problemCards = cards.filter((card) => card.kind === "problem").sort((a, b) => b.priority - a.priority);
  const mistakeCards = cards.filter((card) => card.kind === "mistake").sort((a, b) => b.priority - a.priority);
  const leadCards = balancedLeadCards({ focusCards, conceptCards, formulaCards, problemCards, mistakeCards }, cards);
  const topConcepts = uniqueStrings(cards.flatMap((card) => card.concepts || [])).slice(0, 8);
  const topFormulas = uniqueStrings(cards.flatMap((card) => card.primary_formula ? [card.primary_formula] : card.formulas || [])).slice(0, 3);
  const focusNames = focusCards.length
    ? focusCards.map((card) => card.title).slice(0, 3)
    : scoped.chapters.map((chapter) => meaningfulChapterTitle(chapter.title)).filter(Boolean).slice(0, 3);
  const studyPath = [
    {
      id: "concept",
      label: "先抓概念",
      title: topConcepts.slice(0, 3).join("、") || focusNames[0] || "核心概念",
      description: "把定义、物理意义和适用条件说清楚。",
      icon: "network",
      tone: "concept",
    },
    {
      id: "formula",
      label: "再核公式",
      title: formulaCards[0]?.title || "核心公式",
      description: topFormulas[0] ? toLatexFormula(topFormulas[0]) : "默写公式并标出变量、单位和边界条件。",
      icon: "sigma",
      tone: "formula",
    },
    {
      id: "problem",
      label: "进入题型",
      title: problemCards[0]?.title || "典型题入口",
      description: visualProblemAction(problemCards[0]) || "从例题/作业反推解题动作。",
      icon: "file-question",
      tone: "problem",
    },
    {
      id: "mistake",
      label: "最后排错",
      title: mistakeCards[0]?.title || "易错检查",
      description: mistakeCards[0]?.summary || "用正负号、单位、适用条件做最后检查。",
      icon: "alert-triangle",
      tone: "mistake",
    },
  ].map((item) => ({ ...item, description: cleanSummary(item.description, 74) }));

  return {
    title: model.course?.name || "当前科目",
    subtitle: visualSubtitle(scoped, cards, lanes),
    lead_cards: leadCards.map(compactVisualCard),
    study_path: studyPath,
    concept_cloud: topConcepts,
    formula_highlights: topFormulas.map((item) => toLatexFormula(item) || item),
    focus_names: uniqueStrings(focusNames).slice(0, 4),
  };
}

function balancedLeadCards(groups, cards) {
  const preferred = [
    groups.focusCards?.[0],
    groups.formulaCards?.[0],
    groups.problemCards?.[0],
    groups.mistakeCards?.[0],
    groups.conceptCards?.[0],
  ].filter(Boolean);
  const fallback = [...cards].sort((a, b) => b.priority - a.priority);
  return uniqueBy([...preferred, ...fallback], (card) => card.card_id || `${card.kind}:${card.title}`).slice(0, 4);
}

function visualSubtitle(scoped, cards, lanes) {
  const parts = [];
  const focusCount = cards.filter((card) => card.kind === "focus").length;
  const coreConceptCount = cards.filter((card) => card.kind === "concept").length;
  if (focusCount) parts.push(`${focusCount} 个考点组`);
  if (coreConceptCount) parts.push(`${coreConceptCount} 张核心概念卡`);
  if (scoped.formulas.length) parts.push(`${scoped.formulas.length} 条公式`);
  if (scoped.problems.length) parts.push(`${scoped.problems.length} 个题型入口`);
  if (scoped.mistakes.length) parts.push(`${scoped.mistakes.length} 个易错点`);
  if (parts.length) return `${parts.slice(0, 3).join(" · ")}，已整理成 ${lanes.length || 1} 组复习卡片。`;
  return `已整理成 ${cards.length} 张复习卡片。`;
}

function compactVisualCard(card) {
  const summary = card.kind === "problem" ? visualProblemAction(card) || card.summary : card.summary;
  return {
    card_id: card.card_id,
    kind: card.kind,
    kind_label: card.kind_label,
    icon: card.icon,
    tone: card.tone,
    title: card.title,
    summary: cleanSummary(summary, 78),
    formula: card.kind === "formula" ? card.primary_formula || card.formulas?.[0] || "" : "",
    badges: (card.badges || []).slice(0, 3),
    priority: card.priority,
  };
}

function visualProblemAction(card) {
  if (!card) return "";
  const action = (card.checks || []).find((item) => item && !/^解题动作：思考题/.test(item));
  if (action) return cleanSummary(action.replace(/^解题动作[：:]\s*/u, ""), 74);
  return card.practice?.[0] ? `先做：${cleanSummary(card.practice[0], 54)}` : "";
}

function scopedModelParts(model, options = {}) {
  const chapterId = options.chapterId || "";
  const byChapter = (item) => !chapterId || item.chapter_id === chapterId || item.id === chapterId;
  const byDifficulty = (item) => !options.difficulty || item.difficulty === options.difficulty || item.type === "chapter";
  const byFocus = (item) => !options.examFocusOnly || item.exam_focus?.level === "high";
  const include = (item) => byChapter(item) && byDifficulty(item) && byFocus(item);
  const chapters = (model.chapters || []).filter((item) => byChapter(item) && byDifficulty(item));
  const rawConcepts = (model.concepts || []).filter(include);
  const formulas = (model.formulas || []).filter(include);
  const rules = (model.theorem_or_rules || []).filter(include);
  const examples = (model.examples || []).filter(include);
  const homework = (model.homework_problems || []).filter(include);
  const problems = [...examples, ...homework];
  const mistakes = rankScopedMistakes((model.mistake_points || []).filter((item) => byChapter(item)), rawConcepts, formulas, problems);
  const concepts = rankScopedConcepts(rawConcepts, formulas, problems, mistakes);
  return {
    chapters,
    concepts,
    formulas,
    rules,
    examples,
    homework,
    problems,
    mistakes,
  };
}

function rankScopedConcepts(concepts = [], formulas = [], problems = [], mistakes = []) {
  return [...concepts]
    .map((concept) => {
      const chapterIds = [concept.chapter_id];
      const relatedFormulaCount = relatedFormulas(concept.name, chapterIds, formulas).length;
      const relatedProblemCount = relatedProblems(concept.name, chapterIds, problems).length;
      const relatedMistakeCount = relatedMistakes(concept.name, chapterIds, mistakes).length;
      const counts = concept.evidence_counts || {};
      const score =
        scoreConceptImportance(concept) +
        Number(concept.selection_score || 0) * 0.35 +
        relatedFormulaCount * 18 +
        relatedProblemCount * 16 +
        relatedMistakeCount * 18 +
        Number(counts.title_hits || 0) * 12 +
        Number(counts.definition_sentences || 0) * 10;
      return { ...concept, card_selection_score: Math.round(score) };
    })
    .filter((concept) => {
      if (concept.candidate_confidence === "high") return true;
      if (Number(concept.card_selection_score || 0) >= 170) return true;
      return Boolean(Number(concept.evidence_counts?.formulas_near || 0) || Number(concept.evidence_counts?.problem_anchors || 0));
    })
    .sort((a, b) => Number(b.card_selection_score || 0) - Number(a.card_selection_score || 0))
    .slice(0, 20);
}

function rankScopedMistakes(mistakes = [], concepts = [], formulas = [], problems = []) {
  return [...mistakes]
    .map((mistake) => {
      const chapterIds = [mistake.chapter_id];
      const relatedConceptCount = relatedConceptNames(mistake.description, chapterIds, concepts).length + (mistake.related_concepts || []).length;
      const relatedFormulaCount = formulas.filter((formula) => formula.chapter_id === mistake.chapter_id).length;
      const relatedProblemCount = relatedProblems((mistake.related_concepts || []).join(" ") || mistake.description, chapterIds, problems).length;
      const score =
        Number(mistake.selection_score || 0) +
        (mistake.severity === "high" ? 28 : 14) +
        Math.min(24, relatedConceptCount * 6) +
        Math.min(24, relatedFormulaCount * 8) +
        Math.min(24, relatedProblemCount * 8);
      return { ...mistake, card_selection_score: Math.round(score) };
    })
    .filter((mistake) => Number(mistake.card_selection_score || 0) >= 44 && normalizeMistakeText(mistake.description))
    .sort((a, b) => Number(b.card_selection_score || 0) - Number(a.card_selection_score || 0))
    .slice(0, 12);
}

function buildFocusCards(model, scoped) {
  const cards = [];
  for (const chapter of scoped.chapters) {
    const title = meaningfulChapterTitle(chapter.title);
    if (!title) continue;
    const concepts = scoped.concepts.filter((item) => item.chapter_id === chapter.chapter_id);
    const formulas = scoped.formulas.filter((item) => item.chapter_id === chapter.chapter_id);
    const problems = scoped.problems.filter((item) => item.chapter_id === chapter.chapter_id);
    const mistakes = scoped.mistakes.filter((item) => item.chapter_id === chapter.chapter_id);
    const signalCount = concepts.length + formulas.length + problems.length + mistakes.length;
    if (!signalCount) continue;
    cards.push(
      makeKnowledgeCard("focus", title, {
        subtitle: chapter.exam_focus?.level === "high" ? "高频考点聚合" : "章节考点聚合",
        summary: focusSummary(chapter, model),
        concepts: concepts.map((item) => item.name).slice(0, 6),
        formulas: formulas.map((item) => item.expression).slice(0, 3),
        checks: focusChecks(concepts, formulas, problems, mistakes),
        practice: problems.map((item) => item.title).slice(0, 3),
        mistakes: normalizedMistakeTexts(mistakes).slice(0, 3),
        source_refs: collectSourceRefs([chapter, ...concepts, ...formulas, ...problems, ...mistakes], 4),
        badges: [focusLabelFor(chapter.exam_focus?.level), difficultyLabelFor(chapter.difficulty)].filter(Boolean),
        priority: cardPriority(chapter, { concepts, formulas, problems, mistakes }),
      }),
    );
  }

  if (!cards.length && (scoped.concepts.length || scoped.formulas.length || scoped.problems.length || scoped.mistakes.length)) {
    cards.push(
      makeKnowledgeCard("focus", "核心复习入口", {
        subtitle: "按知识对象自动聚合",
        summary: "先抓核心概念和公式，再进入题型练习，最后用易错卡做检查。",
        concepts: scoped.concepts.map((item) => item.name).slice(0, 6),
        formulas: scoped.formulas.map((item) => item.expression).slice(0, 3),
        checks: ["口述核心概念", "写出公式适用条件", "用例题验证解题流程", "按易错点做最后检查"],
        practice: scoped.problems.map((item) => item.title).slice(0, 3),
        mistakes: scoped.mistakes.map((item) => item.description).slice(0, 3),
        source_refs: collectSourceRefs([...scoped.concepts, ...scoped.formulas, ...scoped.problems, ...scoped.mistakes], 4),
        badges: ["综合入口"],
        priority: 80,
      }),
    );
  }
  return cards.sort((a, b) => b.priority - a.priority).slice(0, 6);
}

function buildConceptCards(model, scoped) {
  const grouped = groupBy(scoped.concepts, (concept) => cleanNodeLabel(concept.name));
  return [...grouped.entries()]
    .map(([name, concepts]) => {
      const chapterIds = uniqueStrings(concepts.map((item) => item.chapter_id));
      const formulas = relatedFormulas(name, chapterIds, scoped.formulas);
      const rules = relatedRules(name, chapterIds, scoped.rules);
      const problems = relatedProblems(name, chapterIds, scoped.problems);
      const mistakes = relatedMistakes(name, chapterIds, scoped.mistakes);
      const best = bestConceptEvidence(name, concepts);
      return makeKnowledgeCard("concept", name, {
        subtitle: chapterSubtitle(model, chapterIds),
        summary: conceptSummary(name, best),
        concepts: relatedConceptNames(name, chapterIds, scoped.concepts).slice(0, 5),
        formulas: formulas.map((item) => item.expression).slice(0, 3),
        checks: conceptChecks(name, formulas, rules, problems),
        practice: problems.map((item) => item.title).slice(0, 3),
        mistakes: normalizedMistakeTexts(mistakes).slice(0, 3),
        source_refs: collectSourceRefs([...concepts, ...formulas, ...rules, ...problems, ...mistakes], 4),
        badges: conceptBadges(concepts, formulas, problems, mistakes),
        priority: conceptCardPriority(concepts, formulas, problems, mistakes),
      });
    })
    .filter((card) => card.priority >= 92 || card.formulas.length || card.practice.length || card.mistakes.length)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, conceptCardLimit(scoped));
}

function buildFormulaCards(model, scoped) {
  return scoped.formulas
    .map((formula) => {
      const chapterIds = [formula.chapter_id];
      const concepts = relatedConceptNames(formula.name, chapterIds, scoped.concepts).slice(0, 5);
      const problems = relatedProblems(formula.name, chapterIds, scoped.problems);
      const mistakes = relatedMistakes(formula.name, chapterIds, scoped.mistakes);
      const condition = cleanKnown(formula.applicable_conditions);
      return makeKnowledgeCard("formula", formula.name || "公式", {
        subtitle: chapterSubtitle(model, chapterIds),
        summary: condition || "先确认适用条件、变量含义和单位，再代入计算。",
        primary_formula: formula.expression,
        formulas: [formula.expression],
        concepts,
        checks: [
          condition ? `适用条件：${condition}` : "先判断题目是否满足线弹性、小变形和对应边界条件。",
          ...(formula.variables || []).map((item) => `${item.symbol}：${item.meaning}`).slice(0, 5),
          ...(formula.common_misuses || []).filter((item) => cleanKnown(item)).slice(0, 2),
        ],
        practice: problems.map((item) => item.title).slice(0, 3),
        mistakes: normalizedMistakeTexts(mistakes).slice(0, 3),
        source_refs: cleanSourceRefs(formula.source_refs || []),
        badges: [focusLabelFor(formula.exam_focus?.level), difficultyLabelFor(formula.difficulty)].filter(Boolean),
        priority: 20 + Number(formula.exam_focus?.score || 0) + problems.length * 7 + mistakes.length * 8,
      });
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 12);
}

function buildProblemCards(model, scoped) {
  const grouped = groupBy(scoped.problems, problemGroupKey);
  return [...grouped.values()]
    .map((problems) => {
      const first = problems[0];
      const relatedNames = uniqueStrings(problems.flatMap((problem) => problem.related_concepts || []));
      const chapterIds = uniqueStrings(problems.map((problem) => problem.chapter_id));
      const formulas = scoped.formulas.filter((formula) => chapterIds.includes(formula.chapter_id));
      const mistakes = relatedMistakes(relatedNames.join(" "), chapterIds, scoped.mistakes);
      const title = relatedNames.length ? `题型：${relatedNames.slice(0, 2).join(" / ")}` : `题型：${cleanProblemTitle(first.title)}`;
      return makeKnowledgeCard("problem", title, {
        subtitle: chapterSubtitle(model, chapterIds),
        summary: cleanSummary(first.problem_text || first.title, 150),
        concepts: relatedNames.slice(0, 6),
        formulas: formulas.map((item) => item.expression).slice(0, 3),
        checks: problemChecks(first, formulas, mistakes),
        practice: problems.map((item) => item.title).slice(0, 4),
        mistakes: normalizedMistakeTexts(mistakes).slice(0, 3),
        source_refs: collectSourceRefs([...problems, ...formulas, ...mistakes], 4),
        badges: [problems.some((item) => item.example_id) ? "例题入口" : "", problems.some((item) => item.homework_problem_id) ? "作业入口" : ""].filter(Boolean),
        priority: problems.length * 14 + formulas.length * 8 + mistakes.length * 8 + maxFocusScore(problems),
      });
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 10);
}

function buildMistakeCards(model, scoped) {
  return scoped.mistakes
    .map((mistake) => {
      const chapterIds = [mistake.chapter_id];
      const concepts = mistake.related_concepts?.length
        ? mistake.related_concepts
        : relatedConceptNames(mistake.description, chapterIds, scoped.concepts).slice(0, 4);
      const formulas = scoped.formulas.filter((formula) => formula.chapter_id === mistake.chapter_id).slice(0, 3);
      const problems = relatedProblems(concepts.join(" "), chapterIds, scoped.problems);
      const normalized = normalizeMistakeText(mistake.description);
      if (!normalized) return null;
      return makeKnowledgeCard("mistake", `易错：${cleanMistakeTitle(normalized)}`, {
        subtitle: mistake.severity === "high" ? "高风险检查点" : "常见检查点",
        summary: normalized,
        concepts,
        formulas: formulas.map((item) => item.expression),
        checks: [
          "做题前先写出适用条件、正负号约定和单位。",
          "代入公式前区分外力、内力和应力/应变。",
          mistake.severity === "high" ? "这类错误优先做一道反例诊断题。" : "",
        ].filter(Boolean),
        practice: problems.map((item) => item.title).slice(0, 3),
        mistakes: [normalized],
        source_refs: collectSourceRefs([mistake, ...formulas, ...problems], 4),
        badges: [mistake.severity === "high" ? "高风险" : "易错点"],
        priority: Number(mistake.card_selection_score || 0) + (mistake.severity === "high" ? 12 : 0) + formulas.length * 8 + problems.length * 8,
      });
    })
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 10);
}

function makeKnowledgeCard(kind, title, values = {}) {
  const meta = CARD_KIND_META[kind] || CARD_KIND_META.concept;
  const sourceRefs = cleanSourceRefs(values.source_refs || []);
  return {
    card_id: hashId("card", [kind, title, values.primary_formula || "", sourceRefs.map((ref) => `${ref.document_id}:${ref.unit_index}`).join(",")]),
    kind,
    kind_label: meta.label,
    icon: meta.icon,
    tone: meta.tone,
    title: cleanCardTitle(title),
    subtitle: cleanSummary(values.subtitle || meta.label, 44),
    summary: cleanSummary(values.summary || "", 180),
    primary_formula: values.primary_formula || "",
    formulas: uniqueStrings(values.formulas || []).map((item) => toLatexFormula(item) || item).slice(0, 4),
    concepts: uniqueStrings(values.concepts || []).slice(0, 8),
    checks: cleanList(values.checks, 5, 120),
    practice: cleanList(values.practice, 4, 100),
    mistakes: cleanList(values.mistakes, 4, 120),
    source_refs: sourceRefs.slice(0, 4),
    badges: uniqueStrings([meta.label, ...(values.badges || [])]).slice(0, 5),
    priority: Number(values.priority || 0),
  };
}

function makeLane(kind, title, description, cards, limit) {
  return {
    id: kind,
    title,
    description,
    cards: cards
      .filter((card) => card.kind === kind)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit),
  };
}

function buildDeckConnections(map, cards) {
  const cardTitles = new Set(cards.map((card) => cleanNodeLabel(card.title)));
  return (map.edges || [])
    .map((edge) => {
      const from = (map.nodes || []).find((node) => node.id === edge.from_id);
      const to = (map.nodes || []).find((node) => node.id === edge.to_id);
      const fromTitle = cleanNodeLabel(from?.label || "");
      const toTitle = cleanNodeLabel(to?.label || "");
      if (!fromTitle || !toTitle) return null;
      return {
        from: fromTitle,
        to: toTitle,
        relation: edge.relation,
        description: cleanSummary(edge.label || edge.description || edge.relation, 86),
        source_refs: cleanSourceRefs(edge.source_refs || []).slice(0, 2),
        score: (cardTitles.has(fromTitle) ? 2 : 0) + (cardTitles.has(toTitle) ? 2 : 0) + (edge.confidence === "medium" ? 1 : 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function groupBy(values, keyFn) {
  const map = new Map();
  for (const value of values || []) {
    const key = keyFn(value) || "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }
  return map;
}

function bestBy(values, scoreFn) {
  return [...(values || [])].sort((a, b) => scoreFn(b) - scoreFn(a))[0] || {};
}

function bestConceptEvidence(name, concepts) {
  return bestBy(concepts, (item) => {
    const text = cleanSummary(item.description || "", 160);
    let score = Number(item.exam_focus?.score || 0);
    if (text.includes(name)) score += 18;
    if (CONCEPT_SUMMARY_FALLBACKS[name] && text === CONCEPT_SUMMARY_FALLBACKS[name]) score += 20;
    if (/是|指|表示|定义|特点|作用|用来|意义|条件|规定|假设|原理/.test(text)) score += 12;
    if (isNoisySummary(text, name)) score -= 80;
    score += Math.max(0, 80 - text.length) * 0.08;
    return score;
  });
}

function collectSourceRefs(items, limit = 4) {
  return cleanSourceRefs((items || []).flatMap((item) => item?.source_refs || [])).slice(0, limit);
}

function cleanList(values = [], limit = 4, maxLength = 100) {
  return uniqueStrings(
    values
      .map((value) => cleanText(value))
      .filter(Boolean)
      .map((value) => cleanSummary(value, maxLength))
      .filter((value) => value && value !== "unknown" && !/^按来源页/.test(value)),
  ).slice(0, limit);
}

function cleanKnown(value) {
  const text = cleanSummary(value || "", 140);
  return text && text !== "unknown" && !/^按来源页/.test(text) ? text : "";
}

function cleanCardTitle(value) {
  return cleanNodeLabel(value || "知识卡片").replace(/^题型：题型：/u, "题型：").slice(0, 42);
}

function cleanProblemTitle(value) {
  return cleanNodeLabel(value || "典型题").replace(/^题目\s*/u, "").slice(0, 28);
}

function cleanMistakeTitle(value) {
  return cleanSummary(value || "检查点", 36).replace(/^易错[：:]\s*/u, "");
}

function normalizedMistakeTexts(mistakes = []) {
  return uniqueStrings(mistakes.map((mistake) => normalizeMistakeText(mistake.description)).filter(Boolean));
}

function normalizeMistakeText(value) {
  const text = cleanSummary(value || "", 180);
  if (!text || /^unknown$/i.test(text)) return "";
  if (/正负号|拉为正|压为负|外法线|同一位置/.test(text)) return "轴力和应力必须统一正负号约定，拉为正、压为负。";
  if (/集中力|局部|圣维南|加载方式|不适用于集中力/.test(text)) return "套用应力公式前要避开集中力作用点附近的局部效应。";
  if (/单位|N\s*，?\s*kN|mm|m/.test(text)) return "代入计算前统一 N、kN、mm、m 等单位。";
  if (/外力|轴力|F_N|F N|混用|截面内力/.test(text)) return "不要把外力 F、截面轴力 F_N 和应力 σ 混为一谈。";
  if (/危险截面|最大轴力|强度计算/.test(text)) return "强度校核前先找最大内力位置和危险截面。";
  if (/弯曲|偏心|M|Fe/.test(text)) return "外力不通过杆轴线时不能按纯轴向拉压处理。";
  if (isNoisySummary(text, "易错")) return "";
  return text.length > 92 ? `${text.slice(0, 91)}…` : text;
}

function meaningfulChapterTitle(value) {
  const title = cleanNodeLabel(value || "");
  if (!title || /^unknown$/i.test(title)) return "";
  if (/^第\s*\d+\s*页$/u.test(title)) return "";
  if (/^(?:page|slide)\s*\d+$/iu.test(title)) return "";
  if (/^全文$/u.test(title)) return "";
  if (/^(?:作业题|思考题|例题|题目|问题|练习|计算题|选择题|填空题|简答题|判断题)(?:\s*\d+)?$/u.test(title)) return "";
  return title;
}

function chapterSubtitle(model, chapterIds = []) {
  const titles = uniqueStrings(
    (model.chapters || [])
      .filter((chapter) => chapterIds.includes(chapter.chapter_id))
      .map((chapter) => meaningfulChapterTitle(chapter.title))
      .filter(Boolean),
  );
  return titles.length ? titles.slice(0, 2).join(" / ") : "跨页聚合";
}

function relatedFormulas(name, chapterIds, formulas) {
  const text = cleanText(name);
  return formulas.filter((formula) => {
    const formulaText = `${formula.name}\n${formula.expression}\n${formula.applicable_conditions}`;
    return formulaText.includes(text) || text.includes("应力") && /\\sigma|σ|应力/.test(formulaText) || text.includes("轴力") && /F_N|F_\{N\}|轴力/.test(formulaText);
  });
}

function relatedRules(name, chapterIds, rules) {
  const text = cleanText(name);
  return rules.filter((rule) => chapterIds.includes(rule.chapter_id) || `${rule.name}\n${rule.statement}`.includes(text));
}

function relatedProblems(name, chapterIds, problems) {
  const terms = uniqueStrings([name, ...String(name || "").split(/[、/\s]+/u)]).filter((item) => item.length >= 2);
  return problems.filter((problem) => {
    const related = problem.related_concepts || [];
    const source = `${problem.title}\n${problem.problem_text}`;
    return related.some((concept) => terms.some((term) => concept.includes(term) || term.includes(concept))) || terms.some((term) => source.includes(term));
  });
}

function relatedMistakes(name, chapterIds, mistakes) {
  const terms = uniqueStrings([name, ...String(name || "").split(/[、/\s]+/u)]).filter((item) => item.length >= 2);
  return mistakes.filter((mistake) => {
    const related = mistake.related_concepts || [];
    const source = mistake.description || "";
    return related.some((concept) => terms.some((term) => concept.includes(term) || term.includes(concept))) || terms.some((term) => source.includes(term));
  });
}

function relatedConceptNames(name, chapterIds, concepts) {
  const current = cleanNodeLabel(name);
  return concepts
    .filter((concept) => chapterIds.includes(concept.chapter_id) || concept.name === current)
    .map((concept) => concept.name)
    .filter((conceptName) => conceptName !== current);
}

function conceptChecks(name, formulas, rules, problems) {
  return [
    `能用自己的话说明“${name}”的定义和物理意义。`,
    formulas.length ? `能说出 ${cleanNodeLabel(formulas[0].name)} 与该概念的关系。` : "",
    rules.length ? `能说明 ${cleanNodeLabel(rules[0].name)} 的使用前提。` : "",
    problems.length ? "能从题干判断它是否是本题的入口概念。" : "",
  ].filter(Boolean);
}

function focusChecks(concepts, formulas, problems, mistakes) {
  return [
    concepts.length ? `先复述：${concepts.slice(0, 3).map((item) => item.name).join("、")}` : "",
    formulas.length ? `默写并解释：${formulas.slice(0, 2).map((item) => item.name).join("、")}` : "",
    problems.length ? "至少做一道同类型例题/作业题。" : "",
    mistakes.length ? "最后按易错点逐条检查。" : "",
  ].filter(Boolean);
}

function problemChecks(problem, formulas, mistakes) {
  const outline = cleanKnown(problem.solution_outline);
  return [
    outline ? `解题动作：${outline}` : "先识别研究对象、载荷、约束和所求量。",
    formulas.length ? `优先检查公式：${formulas.slice(0, 2).map((item) => item.name).join("、")}` : "",
    "写出单位、符号约定和结果物理意义。",
    mistakes.length ? "做完后用易错卡反查一遍。" : "",
  ].filter(Boolean);
}

function conceptBadges(concepts, formulas, problems, mistakes) {
  return [
    focusLabelFor(bestBy(concepts, (item) => Number(item.exam_focus?.score || 0)).exam_focus?.level),
    bestBy(concepts, scoreConceptImportance).profile_label || "",
    formulas.length ? `${formulas.length} 公式` : "",
    problems.length ? `${problems.length} 题` : "",
    mistakes.length ? "关联易错" : "",
  ].filter(Boolean);
}

function conceptCardPriority(concepts, formulas, problems, mistakes) {
  const best = bestBy(concepts, scoreConceptImportance);
  return (
    scoreConceptImportance(best) +
    Math.min(24, concepts.length * 5) +
    formulas.length * 12 +
    problems.length * 10 +
    mistakes.length * 10 +
    maxFocusScore(concepts) * 0.25
  );
}

function conceptCardLimit(scoped) {
  const signal = scoped.formulas.length + scoped.problems.length + scoped.mistakes.length;
  if (signal >= 12) return 8;
  if (signal >= 6) return 7;
  return 6;
}

function problemGroupKey(problem) {
  const related = uniqueStrings(problem.related_concepts || []);
  if (related.length) return `concept:${related.slice(0, 2).join("/")}`;
  return `chapter:${problem.chapter_id || cleanNodeLabel(problem.title)}`;
}

function maxFocusScore(items = []) {
  return Math.max(0, ...items.map((item) => Number(item.exam_focus?.score || 0)));
}

function cardPriority(item, related = {}) {
  return (
    Number(item.exam_focus?.score || 0) +
    (related.concepts?.length || 0) * 5 +
    (related.formulas?.length || 0) * 8 +
    (related.problems?.length || 0) * 7 +
    (related.mistakes?.length || 0) * 8
  );
}

function focusLabelFor(value) {
  return {
    high: "高频",
    medium: "重点",
    low: "",
  }[value] || "";
}

function difficultyLabelFor(value) {
  return {
    basic: "基础",
    medium: "中等",
    hard: "较难",
    comprehensive: "综合",
  }[value] || "";
}

function applyFilters(map, options = {}) {
  let nodes = map.nodes;
  if (options.chapterId) nodes = nodes.filter((node) => node.chapter_id === options.chapterId || node.id === options.chapterId);
  if (options.difficulty) nodes = nodes.filter((node) => node.difficulty === options.difficulty || node.type === "chapter");
  if (options.examFocusOnly) nodes = nodes.filter((node) => node.exam_focus?.level === "high" || node.badges?.includes("高频考点") || node.type === "chapter");
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    ...map,
    nodes,
    edges: map.edges.filter((edge) => nodeIds.has(edge.from_id) && nodeIds.has(edge.to_id)),
  };
}

function toMermaid(map) {
  const lines = ["graph TD"];
  const safe = (value) => String(value || "unknown").replace(/["<>]/g, "").slice(0, 42);
  for (const node of map.nodes.slice(0, 80)) {
    lines.push(`  ${mermaidId(node.id)}["${safe(node.label)}"]`);
  }
  for (const edge of map.edges.slice(0, 120)) {
    lines.push(`  ${mermaidId(edge.from_id)} -->|${safe(edge.relation)}| ${mermaidId(edge.to_id)}`);
  }
  return lines.join("\n");
}

function mermaidId(id) {
  return String(id || "unknown").replace(/[^A-Za-z0-9_]/g, "_");
}

module.exports = {
  generateMindMap,
  toMermaid,
};
