const crypto = require("node:crypto");
const path = require("node:path");
const { toLatexFormula } = require("./formula-format.cjs");
const { formulaIsUsable, formulaSignature, verifyFormula, verifiedFormulaScore } = require("./formula-verifier.cjs");
const {
  COURSE_FOCUS_VERSION,
  detectConceptCandidates,
  detectCourseProfile,
  scoreConceptImportance,
} = require("./exam-focus.cjs");

const DIFFICULTIES = ["basic", "medium", "hard", "comprehensive"];
const LOCATOR_VERSION = 4;
const PROBLEM_MARKERS = [
  "例\\s*题",
  "例",
  "题\\s*目",
  "习\\s*题",
  "练\\s*习",
  "作\\s*业",
  "思\\s*考\\s*题",
  "计算题",
  "选择题",
  "填空题",
  "简答题",
  "判断题",
  "问题",
];
const PROBLEM_MARKER_SOURCE = PROBLEM_MARKERS.join("|");
const PROBLEM_NUMBER_SOURCE = "[A-Za-z]?\\d+(?:[.-]\\d+)*|[一二三四五六七八九十百]+";
const CONCEPT_REASON_WEIGHTS = {
  教学要求信号: 16,
  计算或公式信号: 22,
  题目入口信号: 18,
  公式符号信号: 20,
  易错信号: 18,
  概念定义信号: 14,
  章节标题信号: 12,
  结构化句子信号: 10,
  基础词典命中: 3,
  术语命中: 3,
};

const MECHANICS_CONCEPTS = [
  "轴向拉压",
  "轴力",
  "轴力图",
  "应力",
  "正应力",
  "应变",
  "胡克定律",
  "圣维南原理",
  "平面截面假设",
  "强度条件",
  "危险截面",
  "弯矩",
  "剪力",
  "梁弯曲",
  "扭转",
  "剪应力",
  "主应力",
  "莫尔圆",
  "压杆稳定",
  "欧拉公式",
  "固有频率",
  "受力分析",
  "平衡方程",
  "边界条件",
  "适用条件",
];

const CONCEPT_ALIASES = new Map([
  ["拉压", "轴向拉压"],
  ["拉伸", "轴向拉压"],
  ["压缩", "轴向拉压"],
  ["F N", "轴力"],
  ["F_N", "轴力"],
  ["FN", "轴力"],
  ["sigma", "应力"],
  ["σ", "应力"],
  ["epsilon", "应变"],
  ["ε", "应变"],
  ["弯曲正应力", "梁弯曲"],
  ["剪力图", "剪力"],
  ["临界载荷", "压杆稳定"],
]);

function hashId(prefix, parts) {
  return `${prefix}_${crypto
    .createHash("sha1")
    .update(parts.filter((part) => part !== undefined && part !== null).join("|"))
    .digest("hex")
    .slice(0, 12)}`;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanText(value) {
  return normalizeText(value)
    .replace(/TaoFM-\s*/gi, "")
    .replace(/\b\d{4}\/\d{1,2}\/\d{1,2}\b/g, "")
    .replace(/\s+第\s*\d+\s*页\s*/g, " ")
    .replace(/\s+\d{1,3}\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanFormulaCandidateText(value) {
  return normalizeText(value)
    .replace(/TaoFM-\s*/gi, "")
    .replace(/\b\d{4}\/\d{1,2}\/\d{1,2}\b/g, "")
    .replace(/\s+第\s*\d+\s*页\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isContentsLikeText(value) {
  const text = cleanText(value);
  const sectionCount = (text.match(/\d+\s*[-－–—]\s*\d+\s*[、,.，．:：]/g) || []).length;
  const sectionLabelCount = (text.match(/\d+\s*[-－–—]\s*\d+/g) || []).length;
  const explanatorySignals = (text.match(/特点|外力|轴线|变形|公式|条件|计算|截面|应力|应变|例题|问题/g) || []).length;
  return /^目录\b|^目录\s/u.test(text) || sectionCount >= 4 || sectionLabelCount >= 4 || (sectionCount >= 3 && explanatorySignals <= 4);
}

function clamp(value, max = 120) {
  const text = cleanText(value);
  if (text.length <= max) return text || "unknown";
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  return values.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values) {
  return uniqueBy(
    values.map((value) => String(value || "").trim()).filter(Boolean),
    (value) => value.replace(/\s+/g, "").toLowerCase(),
  );
}

function splitSentences(textValue) {
  return normalizeText(textValue)
    .split(/[\n。；;!?！？]+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 4 && line.length <= 260);
}

function extractPageNumber(label = "") {
  const match = String(label).match(/第\s*(\d+)\s*页/);
  return match ? Number(match[1]) : null;
}

function extractSlideNumber(doc, label = "") {
  if (String(doc?.type || "").toLowerCase() !== "pptx") return null;
  return extractPageNumber(label);
}

function extractProblemNumber(textValue) {
  const marker = cleanText(textValue).match(new RegExp(`(?:${PROBLEM_MARKER_SOURCE})\\s*(${PROBLEM_NUMBER_SOURCE})`, "u"));
  if (marker) return marker[1];
  const numbered = cleanText(textValue).match(new RegExp(`(?:第\\s*)?(${PROBLEM_NUMBER_SOURCE})\\s*[题问]`, "u"));
  return numbered ? numbered[1] : "unknown";
}

function sourceRef(doc, unit, unitIndex, excerpt, options = {}) {
  const label = unit?.label || "全文";
  const locatorLabel = options.anchor_label || label;
  const locatorConfidence = options.locator_confidence || options.confidence || "medium";
  return {
    document_id: doc?.id || doc?.document_id || "unknown",
    file_name: doc?.originalName || doc?.file_name || "unknown",
    document_type:
      doc?.type ||
      doc?.document_type ||
      path.extname(doc?.originalName || "").replace(".", "").toLowerCase() ||
      "unknown",
    unit_index: Number.isInteger(unitIndex) ? unitIndex : 0,
    unit_label: label,
    page_number: extractPageNumber(label),
    slide_number: extractSlideNumber(doc, label),
    problem_number: options.problem_number || extractProblemNumber(excerpt || unit?.text || "") || "unknown",
    paragraph_index: Number.isInteger(options.paragraph_index) ? options.paragraph_index : 0,
    locator_version: LOCATOR_VERSION,
    locator_type: options.locator_type || "unit",
    locator_label: locatorLabel,
    locator_confidence: locatorConfidence,
    anchor_label: options.anchor_label || "",
    anchor_text: options.anchor_text ? clamp(options.anchor_text, 120) : "",
    excerpt: clamp(excerpt || unit?.text || "", 180),
    confidence: locatorConfidence,
  };
}

function firstSourceRef(item) {
  return Array.isArray(item?.source_refs) && item.source_refs.length ? item.source_refs[0] : null;
}

function sourceDocumentIds(sourceRefs = []) {
  return uniqueStrings(sourceRefs.map((ref) => ref.document_id).filter((value) => value && value !== "unknown"));
}

function detectChapterTitle(textValue, fallbackLabel = "") {
  const text = cleanText(textValue);
  const numbered = text.match(/\d+\s*[-－–—]\s*\d+\s*[、,.，．:：]\s*[\p{L}\p{N}\s（）()、]{2,38}/u);
  if (numbered) {
    return clamp(cleanDetectedChapterTitle(numbered[0]), 48);
  }
  const chapter = text.match(/第\s*[一二三四五六七八九十\d]+\s*章\s*[\p{L}\p{N}\s（）()、-]{0,34}/u);
  if (chapter) return clamp(chapter[0], 48);
  const markdown = normalizeText(textValue).match(/^#{1,3}\s+(.+)$/m);
  if (markdown) return clamp(markdown[1], 48);
  return fallbackLabel ? clamp(fallbackLabel, 48) : "unknown";
}

function cleanDetectedChapterTitle(value) {
  const text = cleanText(value)
    .replace(/\s*[-－–—]\s*/g, "-")
    .replace(/\s*[、,.，．:：]\s*/g, "、")
    .replace(/\s+/g, " ")
    .trim();
  const section = text.match(/^(\d+-\d+、)\s*(.+)$/u);
  if (!section) return text;
  let body = section[2]
    .replace(/\s+(?:[\p{L}\p{N}、]{1,14})?(?:是|为|以|必须|需要|说明|判断|计算|求|提示|注意|常见错误)[\s\S]*$/u, "")
    .replace(/\s+(?:外力|截面法|横截面|公式|适用条件|例题|作业题|思考题|问题)[\s\S]*$/u, "")
    .trim();
  if (!body || body.length < 3) body = section[2].split(/\s+/u)[0] || section[2];
  return `${section[1]}${body}`;
}

function difficultyFromText(textValue, fallback = "medium") {
  const text = cleanText(textValue);
  if (/综合|跨章节|压轴|多步骤|复杂|联合|证明|推导|反推|设计|应用/.test(text)) return "comprehensive";
  if (/证明|推导|提高|困难|主应力|稳定|超静定|变截面|危险截面|强度计算/.test(text)) return "hard";
  if (/例题|计算|判断|适用条件|轴力图|平衡方程|公式/.test(text)) return "medium";
  if (/定义|概念|特点|单位|基本|横截面/.test(text)) return "basic";
  return DIFFICULTIES.includes(fallback) ? fallback : "medium";
}

function examFocusFromEvidence(textValue, counts = {}) {
  const text = cleanText(textValue);
  const reasons = [];
  let score = 0;
  if (counts.formulas) {
    score += counts.formulas * 14;
    reasons.push(`包含 ${counts.formulas} 条公式线索`);
  }
  if (counts.examples) {
    score += counts.examples * 10;
    reasons.push(`包含 ${counts.examples} 个例题/问题`);
  }
  if (counts.homework) {
    score += counts.homework * 12;
    reasons.push(`包含 ${counts.homework} 道作业/练习`);
  }
  if (counts.mistakes) {
    score += counts.mistakes * 12;
    reasons.push(`包含 ${counts.mistakes} 个易错提示`);
  }
  if (/重点|考试|必须|掌握|强度|危险截面|适用条件|例题|作业/.test(text)) {
    score += 18;
    reasons.push("资料中出现重点或考试型信号");
  }
  if (/[=≈≤≥∑Σ∫√]|\\(?:sigma|tau|varepsilon|epsilon|Delta)|F\s*N|F_N|F_\{N\}|EA|EI|GJ|σ|τ|ε/.test(text)) score += 12;
  const level = score >= 50 ? "high" : score >= 24 ? "medium" : "low";
  return { level, score, reasons: reasons.length ? uniqueStrings(reasons).slice(0, 4) : ["low_confidence"] };
}

function formulaCandidates(textValue) {
  return normalizeText(textValue)
    .split(/[\n。；;]+/)
    .map((line) => cleanFormulaCandidateText(line))
    .flatMap(extractFormulaFragments)
    .filter((line) => line.length >= 5 && line.length <= 180)
    .filter(isUsefulFormulaLine);
}

function extractFormulaFragments(line) {
  const text = cleanFormulaCandidateText(line)
    .replace(/\bF\s+N\b/g, "F_N")
    .replace(/\bFN\b/g, "F_N");
  const formulaChars = String.raw`\\A-Za-z0-9_{}\[\]\s+\-*/^().,，<>σσετγθφωΩμνπρΔδψ∇Φ`;
  const pattern = new RegExp(
    String.raw`((?:\\[A-Za-z]+|F_N|[A-Za-zσσετγθφωΩμνπρΔδψ∇Φ])(?:[${formulaChars}]{0,64}?)(?:=|≈|≤|≥|\\le|\\ge|\\approx)(?:[${formulaChars}]{1,84}))`,
    "gu",
  );
  const fragments = [];
  for (const match of text.matchAll(pattern)) {
    const fragment = trimFormulaFragment(match[1]);
    if (fragment) fragments.push(fragment);
  }
  for (const match of text.matchAll(/((?:sin|cos|tan)\s*\^?\s*\{?\d+\}?\s*[A-Za-z0-9_{}]*\s*(?:[+\-]\s*(?:sin|cos|tan)\s*\^?\s*\{?\d+\}?\s*[A-Za-z0-9_{}]*)+\s*=\s*[-+]?\d+(?:\.\d+)?)/giu)) {
    fragments.push(trimFormulaFragment(match[1]));
  }
  for (const match of text.matchAll(/(P\s*\(\s*X\s*=\s*k\s*\)\s*=\s*C_?n\^?k\s*p\^?k\s*\(?1-p\)?\^?\(?n-k\)?)/giu)) {
    fragments.push(trimFormulaFragment(match[1]));
  }
  for (const match of text.matchAll(/(dN\s*\/\s*dt\s*=\s*rN\s*\(?1\s*-\s*N\s*\/\s*K\)?)/giu)) {
    fragments.push(trimFormulaFragment(match[1]));
  }
  for (const match of text.matchAll(/(\\?tau|τ)\s*=\s*([-+]?\d+(?:\.\d+)?)/giu)) {
    fragments.push(`${match[1]} = ${match[2]}`);
  }
  return fragments;
}

function trimFormulaFragment(value) {
  return cleanFormulaCandidateText(value)
    .replace(/^[^\\A-Za-zσσετγθφωΩμνπρΔδψ∇Φ]+/u, "")
    .replace(/(\bA\s+F_N\s*=\s*(?:\\sigma|sigma|σ)).*$/iu, "$1")
    .replace(/((?:\\sigma|sigma|σ)\s*=\s*(?:F_N|F)\s*\/\s*A).*$/iu, "$1")
    .replace(/(F_N\s*=\s*F_N\s*\(?x\)?).*$/iu, "$1")
    .replace(/(=\s*[-+]?\d+(?:\.\d+)?)\s+(?=\\[A-Za-z]+|[A-Za-z])/u, "$1")
    .replace(/(F_N\d*\s*=\s*[-+]?\s*F)\s+.*$/iu, "$1")
    .replace(/(=\s*<[^>]+>).*/u, "$1")
    .replace(/[，。；;：:].*$/u, "")
    .replace(/\s+(?:轴力|应力|单位|根据|得到|正负号|适用|条件|注意|表示|说明|拉力|压力|材料力学|平衡方程).*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulFormulaLine(line) {
  const normalized = cleanFormulaCandidateText(line);
  if (/^##|TaoFM|第\s*\d+\s*页|^\d{4}\/\d{1,2}\/\d{1,2}/i.test(normalized)) return false;
  if (/一、|二、|三、|四、|五、|六、|七、|八、/.test(normalized) && normalized.length > 60) return false;
  const hasOperator = /[=≈≤≥∑Σ∫√]|\\(?:frac|sqrt|le|ge|approx)|->|→|×|·|\//.test(normalized);
  const hasPhysicsSymbol =
    /\\(?:sigma|tau|varepsilon|epsilon|Delta|rho|mu|omega|pi|sin|cos|log|nabla|Phi)|[σσετγθφωΩμνΔδψπρ∇Φ]|F\s*N|F_N|F_\{N\}|FN|EA|EI|GJ|Pcr|P_\{cr\}|Mmax|tau|sigma|epsilon|Delta|Δ|PV|nRT|pH|pKa|Ksp|H\+|sin|cos|log|sqrt|omega|rho|mu|pi|dPhi|dN|Hardy|Weinberg/i.test(
      normalized,
    );
  const hasScienceEquation =
    /\b(?:F|m|a|v|v_0|x|x_0|t|P|V|n|R|T|M|c|pH|k|p|A|I|J|E|G)\b/.test(normalized) &&
    /[=≈≤≥]|\//.test(normalized);
  const compactLength = normalized.replace(/\s+/g, "").length;
  if (!hasOperator || (!hasPhysicsSymbol && !hasScienceEquation) || compactLength > 90) return false;
  if (/\/\/|′|^\W*$/.test(normalized)) return false;
  if (/[=≈≤≥]\s*$/.test(normalized)) return false;
  const equation = normalized.match(/^(.*?)\s*(=|≈|≤|≥|\\le|\\ge|\\approx)\s*(.*?)$/);
  if (!equation || !equation[1].trim() || !equation[3].trim()) return false;
  const leftTokens = equation[1].trim().split(/\s+/).filter(Boolean);
  const rightTokens = equation[3].trim().split(/\s+/).filter(Boolean);
  if (leftTokens.length > 5 || rightTokens.length > 7) return false;
  if (/^(?:[A-Z]\s+){4,}/.test(equation[1].trim())) return false;
  if (leftTokens.filter((token) => /^[A-Z]$/.test(token)).length > 1) return false;
  if (rightTokens.filter((token) => /^[A-Z]$/.test(token)).length > 2) return false;
  return true;
}

function normalizeFormulaExpression(line) {
  return toLatexFormula(cleanText(line)) || cleanText(line);
}

function inferVariables(expression) {
  const variables = [];
  const map = [
    [/F_N|F_\{N\}|FN|轴力/, "F_N", "横截面轴力"],
    [/\bF\b|外力|载荷/, "F", "外力或载荷"],
    [/\bA\b|面积|截面/, "A", "横截面面积"],
    [/\bE\b|弹性模量/, "E", "弹性模量"],
    [/\bL\b|长度|\bl\b/, "L", "杆件长度"],
    [/\\sigma|σ|sigma|应力/, "σ", "正应力或应力"],
    [/\\varepsilon|\\epsilon|ε|epsilon|应变/, "ε", "线应变"],
    [/\\tau|τ|tau|剪应力/, "τ", "剪应力"],
    [/\bM\b|弯矩/, "M", "弯矩"],
    [/\bI\b|惯性矩/, "I", "截面惯性矩"],
    [/\bT\b|扭矩/, "T", "扭矩"],
    [/\bJ\b|极惯性矩/, "J", "极惯性矩"],
  ];
  for (const [pattern, symbol, meaning] of map) {
    if (pattern.test(expression)) variables.push({ symbol, meaning });
  }
  return uniqueBy(variables, (item) => item.symbol);
}

function nearbyCondition(textValue, formulaLine) {
  const sentences = splitSentences(textValue);
  const index = sentences.findIndex((sentence) => sentence.includes(formulaLine.slice(0, 12)) || formulaLine.includes(sentence.slice(0, 12)));
  const windowText = sentences.slice(Math.max(0, index - 2), index + 3).join(" ");
  const condition = splitSentences(windowText).find((sentence) => /适用|条件|必须|不适用|前提|假设|线弹性|小变形|均匀|集中力|轴线重合/.test(sentence));
  return condition ? clamp(condition, 110) : "unknown";
}

function inferCommonMisuse(textValue, expression) {
  const notes = [];
  const source = `${textValue}\n${expression}`;
  if (/轴力|F_N|F_\{N\}|FN|拉压|\\sigma|σ/.test(source)) notes.push("把外力、轴力和截面应力直接混为一谈。");
  if (/适用|不适用|集中力|圣维南|局部/.test(source)) notes.push("未检查公式适用范围，直接套用到集中力附近区域。");
  if (/正负号|拉为正|压为负|轴力图/.test(source)) notes.push("轴力正负号约定前后不一致。");
  if (/单位|N|kN|mm|m/.test(source)) notes.push("单位没有统一就代入计算。");
  return notes.length ? uniqueStrings(notes).slice(0, 3) : ["unknown"];
}

function detectConceptCandidatesForText(textValue, context = {}) {
  const candidates = detectConceptCandidates(textValue, context);
  if (candidates.length) return candidates;
  const text = cleanText(textValue);
  const names = [];
  for (const concept of MECHANICS_CONCEPTS) {
    if (text.includes(concept)) names.push(concept);
  }
  for (const [alias, canonical] of CONCEPT_ALIASES.entries()) {
    if (text.includes(alias)) names.push(canonical);
  }
  return uniqueStrings(names).map((name) => ({
    name,
    aliases: [name],
    group: "legacy",
    profile_id: context.profile?.id || "legacy",
    profile_label: context.profile?.label || "力学",
    syllabus_priority: 48,
    evidence_score: 0,
    score: 48,
    generic: false,
    reasons: ["基础词典命中"],
  }));
}

function detectConceptNames(textValue, context = {}) {
  return uniqueStrings(detectConceptCandidatesForText(textValue, context).map((candidate) => candidate.name));
}

function conceptDefinitionSentence(textValue, name) {
  const sentences = splitSentences(textValue);
  return (
    sentences.find((sentence) => sentence.includes(name) && /是|指|表示|定义|特点|作用|用/.test(sentence)) ||
    sentences.find((sentence) => sentence.includes(name)) ||
    ""
  );
}

function objectiveSentences(textValue) {
  return splitSentences(textValue).filter((sentence) => /掌握|理解|会|能够|要求|目标|复习|检查|求|计算|判断/.test(sentence));
}

function ruleSentences(textValue) {
  return splitSentences(textValue).filter((sentence) => /原理|定理|规律|规则|假设|方法|规定|条件|准则|平面截面|圣维南|胡克/.test(sentence));
}

function mistakeSentences(textValue) {
  return splitSentences(textValue).filter((sentence) => /注意|不能|不可|必须|易错|错误|不适用|正负号|单位|混淆|忽略|危险|检查/.test(sentence));
}

function scoreMistakeSentence(sentence) {
  const text = cleanText(sentence);
  if (!text || isContentsLikeText(text)) return -100;
  let score = 0;
  if (/常见错误|易错|错误|混淆|忽略/.test(text)) score += 28;
  if (/不能|不可|必须|不适用|危险|注意|检查/.test(text)) score += 22;
  if (/正负号|拉为正|压为负|单位|N|kN|mm|m/.test(text)) score += 20;
  if (/适用条件|前提|假设|局部|集中力|圣维南|线弹性|小变形/.test(text)) score += 18;
  if (/外力|内力|轴力|F_N|F\s*N|应力|应变|弯矩|剪力|扭矩|截面/.test(text)) score += 14;
  if (/[=≈≤≥∑Σ∫√]|\\(?:sigma|tau|varepsilon|epsilon|Delta)|σ|τ|ε|Δ|EA|EI|GJ/.test(text)) score += 10;
  if (/例题|作业题|思考题|计算|求|判断/.test(text)) score += 8;
  if (!/常见错误|易错|错误|混淆|不能|不可|必须|不适用|注意|检查|正负号|单位|适用条件/.test(text)) score -= 18;
  if (text.length < 8 || text.length > 180) score -= 12;
  return score;
}

function selectMistakeSentences(textValue, limit = 4) {
  return uniqueStrings(mistakeSentences(textValue))
    .map((sentence) => ({ sentence, score: scoreMistakeSentence(sentence) }))
    .filter((item) => item.score >= 24)
    .sort((a, b) => b.score - a.score || a.sentence.length - b.sentence.length)
    .slice(0, limit)
    .map((item) => item.sentence);
}

function isHighValueConceptSentence(sentence, name = "") {
  const text = cleanText(sentence);
  if (!text || isContentsLikeText(text)) return false;
  return /是|指|表示|定义|特点|作用|用于|用来|意义|条件|规定|假设|原理|公式|计算|求|判断|校核|作图|适用|不适用|注意|易错|必须/.test(
    text,
  );
}

function candidateReasonScore(reasons = []) {
  return uniqueStrings(reasons).reduce((sum, reason) => sum + (CONCEPT_REASON_WEIGHTS[reason] || 4), 0);
}

function countCandidateSignals(textValue, candidate = {}, context = {}) {
  const text = cleanText(textValue);
  const name = candidate.name || "";
  const aliases = uniqueStrings([name, ...(candidate.aliases || [])]).filter(Boolean);
  const aliasPattern = aliases.length ? new RegExp(aliases.map(escapeRegExp).join("|"), "u") : null;
  const windows = aliases.flatMap((alias) => contextWindowsForAlias(text, alias, 90));
  const evidenceText = windows.join(" ") || text;
  const sentences = splitSentences(text);
  const titleText = cleanText(context.chapterTitle || "");
  const counts = {
    alias_hits: aliases.reduce((sum, alias) => sum + countAliasHits(text, alias), 0),
    formula_lines: formulaCandidates(text).length,
    formulas_near: /[=≈≤≥∑Σ∫√]|\\(?:frac|sqrt|sigma|tau|Delta|varepsilon)|σ|τ|ε|Δ|F_N|EA|EI|GJ|Pcr|M\s*=/i.test(evidenceText) ? 1 : 0,
    problem_anchors: extractProblemAnchors(text).length,
    rules: ruleSentences(text).length,
    mistakes: mistakeSentences(text).length,
    objectives: objectiveSentences(text).length,
    definition_sentences: sentences.filter((sentence) => {
      if (aliasPattern && !aliasPattern.test(sentence)) return false;
      return isHighValueConceptSentence(sentence, name);
    }).length,
    title_hits: aliases.some((alias) => titleText.includes(alias)) ? 1 : 0,
    contents_like: isContentsLikeText(text) ? 1 : 0,
  };
  return counts;
}

function scoreConceptCandidateForUnit(candidate, textValue, context = {}) {
  const counts = countCandidateSignals(textValue, candidate, context);
  const reasons = uniqueStrings(candidate.reasons || []);
  const candidateScore = Number(candidate.score || 0);
  const evidenceScore = Number(candidate.evidence_score || 0);
  const syllabusPriority = Number(candidate.syllabus_priority || 0);
  let score =
    syllabusPriority * 0.9 +
    evidenceScore * 1.8 +
    candidateReasonScore(reasons) +
    Math.min(30, counts.alias_hits * 6) +
    counts.definition_sentences * 18 +
    counts.formulas_near * 18 +
    Math.min(24, counts.formula_lines * 8) +
    Math.min(24, counts.problem_anchors * 12) +
    Math.min(20, counts.rules * 8) +
    Math.min(22, counts.mistakes * 8) +
    Math.min(16, counts.objectives * 6) +
    counts.title_hits * 18 +
    candidateScore * 0.35;

  if (candidate.generic) score -= counts.formulas_near || counts.problem_anchors || counts.definition_sentences ? 12 : 34;
  if (counts.contents_like) score -= 90;
  if (!counts.definition_sentences && !counts.formulas_near && !counts.problem_anchors && !counts.rules && !counts.mistakes) score -= 22;

  const confidence =
    score >= 165 || (counts.title_hits && score >= 130)
      ? "high"
      : score >= 105 || counts.definition_sentences || counts.formulas_near || counts.problem_anchors
        ? "medium"
        : "low";
  return {
    ...candidate,
    concept_selection_score: Math.round(score),
    evidence_counts: counts,
    confidence,
    reasons: uniqueStrings([
      ...reasons,
      counts.title_hits ? "章节标题信号" : "",
      counts.definition_sentences ? "结构化句子信号" : "",
    ]),
  };
}

function selectConceptCandidatesForUnit(textValue, candidates, context = {}, limit = 6) {
  const scored = uniqueBy(
    (candidates || [])
      .map((candidate) => scoreConceptCandidateForUnit(candidate, textValue, context))
      .filter((candidate) => {
        if (candidate.evidence_counts?.contents_like) return false;
        if (candidate.confidence === "low" && candidate.concept_selection_score < 104) return false;
        if (candidate.generic && candidate.concept_selection_score < 134) return false;
        return candidate.concept_selection_score >= 82;
      })
      .sort((a, b) => b.concept_selection_score - a.concept_selection_score || b.syllabus_priority - a.syllabus_priority),
    (candidate) => candidate.name,
  );

  const selected = [];
  const groupCounts = new Map();
  for (const candidate of scored) {
    const group = candidate.group || "other";
    const groupCount = groupCounts.get(group) || 0;
    if (groupCount >= 3 && candidate.concept_selection_score < 150) continue;
    if (selected.length >= limit) {
      const hasNewStrongGroup = groupCount === 0 && candidate.concept_selection_score >= 132 && candidate.confidence !== "low";
      const hasVeryStrongEvidence = candidate.concept_selection_score >= 175 && candidate.confidence === "high";
      if (!hasNewStrongGroup && !hasVeryStrongEvidence) continue;
    }
    selected.push(candidate);
    groupCounts.set(group, groupCount + 1);
    if (selected.length >= Math.max(limit, 10)) break;
  }
  return selected;
}

function conceptEvidenceRefConfidence(candidate) {
  if (candidate.confidence === "high") return "high";
  if (candidate.confidence === "medium" || Number(candidate.concept_selection_score || 0) >= 120) return "medium";
  return "low";
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contextWindowsForAlias(textValue, alias, radius = 80) {
  const text = cleanText(textValue);
  const key = cleanText(alias);
  if (!text || !key) return [];
  const windows = [];
  let index = text.indexOf(key);
  while (index >= 0 && windows.length < 6) {
    windows.push(text.slice(Math.max(0, index - radius), Math.min(text.length, index + key.length + radius)));
    index = text.indexOf(key, index + key.length);
  }
  return windows;
}

function countAliasHits(textValue, alias) {
  const text = cleanText(textValue);
  const key = cleanText(alias);
  if (!text || !key) return 0;
  if (/^[A-Za-z_{}\\]+$/.test(key)) {
    const matches = text.match(new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(key)}([^A-Za-z0-9]|$)`, "gi"));
    return matches ? matches.length : 0;
  }
  return text.split(key).length - 1;
}

function problemMarkerRegex() {
  return new RegExp(`(${PROBLEM_MARKER_SOURCE})\\s*(${PROBLEM_NUMBER_SOURCE})?\\s*([：:、.．)）-])?`, "gu");
}

function normalizeProblemMarker(marker) {
  return String(marker || "").replace(/\s+/g, "");
}

function hasProblemMarkerBoundary(textValue, index) {
  if (index <= 0) return true;
  const previous = textValue[index - 1];
  return /[\s\n\r\t，,。；;：:！？!?、（）()[\]{}<>《》“”"'`-]/u.test(previous);
}

function hasProblemLeadText(textValue) {
  return /^(图示|如图|已知|设|试|求|问|证明|计算|判断|选择|下列|关于|根据|哪|为什么|如何|有|某|一|两|若|当)/u.test(
    String(textValue || "").trim(),
  );
}

function isGenericQuestionWordUse(textValue, matchStart, matchEnd, hasStrongMarker) {
  if (hasStrongMarker) return false;
  const before = textValue.slice(Math.max(0, matchStart - 18), matchStart).replace(/\s+/g, "");
  const after = textValue.slice(matchEnd, matchEnd + 18).replace(/\s+/g, "");
  return (
    /(?:静不定|超静定|一维|二维|三维|研究|方法|应力|变形|截面|材料|力学)$/.test(before) ||
    /^(?:化为|是|中|的|和|与|及|，|。|；|合力|关键|方法|研究)/.test(after)
  );
}

function sentenceBoundaryBefore(textValue, index) {
  const prefix = textValue.slice(0, index);
  const match = prefix.match(/[。；;!?！？]\s*[^。；;!?！？]*$/u);
  return match ? prefix.length - match[0].replace(/^[。；;!?！？]\s*/, "").length : Math.max(0, prefix.lastIndexOf("\n") + 1);
}

function problemContextStart(textValue, index) {
  const start = sentenceBoundaryBefore(textValue, index);
  const context = textValue.slice(start, index).trim();
  if (context.length >= 8 && context.length <= 130 && /图示|如图|已知|设|试|求|问|证明|计算|判断|选择|根据|关于/.test(context)) {
    return start;
  }
  return index;
}

function problemKind(marker) {
  const normalized = normalizeProblemMarker(marker);
  if (/^例题?$/.test(normalized)) return "example";
  if (/思考题|习题|练习|作业|题目|计算题|选择题|填空题|简答题|判断题|问题/.test(normalized)) return "homework";
  return "homework";
}

function problemAnchorTitle(anchor) {
  const label = [normalizeProblemMarker(anchor.marker), anchor.number].filter(Boolean).join(" ");
  const text = cleanText(anchor.text)
    .replace(/^材料力学\s*/u, "")
    .replace(/\s+\d{1,3}\s*$/u, "");
  if (label && text.startsWith(normalizeProblemMarker(anchor.marker))) return clamp(text, 90);
  return clamp(`${label || "题目"} ${text}`, 90);
}

function extractProblemAnchors(textValue) {
  const text = cleanText(textValue);
  if (!text) return [];
  const matches = [];
  const regex = problemMarkerRegex();
  for (const match of text.matchAll(regex)) {
    const marker = normalizeProblemMarker(match[1]);
    const number = match[2] || "";
    const delimiter = match[3] || "";
    const markerEnd = match.index + match[0].length;
    const after = text.slice(markerEnd).trimStart();
    const strongMarker = Boolean(number || delimiter);
    if (!hasProblemMarkerBoundary(text, match.index)) continue;
    if (marker === "问题" && !strongMarker && !hasProblemLeadText(after)) continue;
    if (!strongMarker && !hasProblemLeadText(after)) continue;
    if (isGenericQuestionWordUse(text, match.index, markerEnd, strongMarker)) continue;
    matches.push({
      marker,
      number,
      delimiter,
      start: problemContextStart(text, match.index),
      markerStart: match.index,
      markerEnd,
    });
  }

  return uniqueBy(
    matches.map((match, index) => {
      const nextStart = matches[index + 1]?.start ?? text.length;
      const rawText = text.slice(match.start, nextStart).trim();
      const anchorText = rawText || text.slice(match.markerStart, Math.min(text.length, match.markerStart + 260)).trim();
      const anchor = {
        index,
        kind: problemKind(match.marker),
        marker: match.marker,
        number: match.number || extractProblemNumber(anchorText),
        start: match.start,
        text: anchorText,
        confidence: match.number || match.delimiter ? "high" : "medium",
      };
      anchor.title = problemAnchorTitle(anchor);
      anchor.label = [match.marker, anchor.number && anchor.number !== "unknown" ? anchor.number : ""].filter(Boolean).join(" ");
      return anchor;
    }),
    (anchor) => `${anchor.marker}:${anchor.number}:${anchor.text.slice(0, 80)}`,
  ).filter((anchor) => anchor.text.length >= 6);
}

function problemLikeUnits(textValue) {
  return extractProblemAnchors(textValue).length > 0;
}

function buildDocumentKnowledgeModel(doc, options = {}) {
  const units = Array.isArray(doc?.units) && doc.units.length ? doc.units : doc?.text ? [{ label: "全文", text: doc.text }] : [];
  const profile = options.profile || detectCourseProfile({
    courseName: options.courseName,
    documentName: doc?.originalName,
    text: doc?.text,
  });
  const chapters = [];
  const learningObjectives = [];
  const concepts = [];
  const formulas = [];
  const rules = [];
  const examples = [];
  const homeworkProblems = [];
  const mistakePoints = [];
  const dependencyEdges = [];

  let currentChapter = null;
  for (const [unitIndex, unit] of units.entries()) {
    const textValue = normalizeText(unit.text || "");
    if (!textValue) continue;
    const title = detectChapterTitle(textValue, unit.label);
    if (title !== "unknown" || !currentChapter) {
      currentChapter = {
        chapter_id: hashId("chapter", [doc.id, title, unitIndex]),
        title,
        order: chapters.length + 1,
        difficulty: difficultyFromText(textValue),
        exam_focus: examFocusFromEvidence(textValue),
        source_refs: [sourceRef(doc, unit, unitIndex, textValue, { confidence: title === "unknown" ? "low" : "medium" })],
        concept_ids: [],
        formula_ids: [],
        example_ids: [],
        homework_problem_ids: [],
        mistake_point_ids: [],
      };
      chapters.push(currentChapter);
    }

    if (isContentsLikeText(textValue)) continue;

    for (const sentence of objectiveSentences(textValue).slice(0, 2)) {
      learningObjectives.push({
        objective_id: hashId("obj", [doc.id, unitIndex, sentence]),
        chapter_id: currentChapter?.chapter_id || "unknown",
        description: clamp(sentence, 140),
        confidence: /掌握|理解|要求|目标/.test(sentence) ? "medium" : "low",
        source_refs: [sourceRef(doc, unit, unitIndex, sentence, { confidence: /掌握|理解|要求|目标/.test(sentence) ? "medium" : "low" })],
      });
    }

    const conceptContext = {
      profile,
      courseName: options.courseName,
      documentName: doc?.originalName,
      chapterTitle: currentChapter?.title || title,
    };
    const conceptCandidates = selectConceptCandidatesForUnit(textValue, detectConceptCandidatesForText(textValue, conceptContext), conceptContext);
    for (const candidate of conceptCandidates) {
      const name = candidate.name;
      const definition = conceptDefinitionSentence(textValue, name);
      const concept = {
        concept_id: hashId("concept", [doc.id, currentChapter?.chapter_id, name]),
        chapter_id: currentChapter?.chapter_id || "unknown",
        name,
        description: definition ? clamp(definition, 150) : "unknown",
        difficulty: difficultyFromText(definition || textValue, "basic"),
        exam_focus: examFocusFromEvidence(`${name}\n${definition || textValue}`),
        profile_id: candidate.profile_id,
        profile_label: candidate.profile_label,
        concept_group: candidate.group,
        syllabus_priority: candidate.syllabus_priority,
        evidence_score: candidate.evidence_score,
        selection_score: candidate.concept_selection_score,
        evidence_counts: candidate.evidence_counts,
        candidate_confidence: candidate.confidence,
        importance_score: Math.max(Number(candidate.score || 0), Number(candidate.concept_selection_score || 0)),
        detection_reasons: candidate.reasons || [],
        source_refs: [
          sourceRef(doc, unit, unitIndex, definition || name, {
            confidence: definition ? conceptEvidenceRefConfidence(candidate) : "low",
          }),
        ],
      };
      concepts.push(concept);
      currentChapter?.concept_ids.push(concept.concept_id);
    }

    for (const line of formulaCandidates(textValue).slice(0, 10)) {
      const expression = normalizeFormulaExpression(line);
      const verification = verifyFormula(line, {
        courseName: options.courseName,
        documentName: doc?.originalName,
        chapterTitle: currentChapter?.title || title,
        unitText: textValue,
        nearbyText: nearbyTextForFormula(textValue, line),
      });
      if (!formulaIsUsable({ verification })) continue;
      const formulaExpression = verification.expression || expression;
      const referenceVariables = verification.variables || [];
      const referenceMisuses = verification.common_misuses || [];
      const formula = {
        formula_id: hashId("formula", [doc.id, currentChapter?.chapter_id, formulaExpression]),
        chapter_id: currentChapter?.chapter_id || "unknown",
        expression: formulaExpression,
        original_expression: verification.corrected ? verification.original_expression || expression : "",
        name: verification.reference_match?.name || inferFormulaName(formulaExpression),
        variables: referenceVariables.length ? referenceVariables : inferVariables(formulaExpression),
        applicable_conditions: verification.applicable_conditions || nearbyCondition(textValue, line),
        common_misuses: uniqueStrings([...referenceMisuses, ...inferCommonMisuse(textValue, formulaExpression)]).slice(0, 4),
        difficulty: difficultyFromText(`${textValue}\n${formulaExpression}`, "medium"),
        exam_focus: examFocusFromEvidence(`${textValue}\n${formulaExpression}`, { formulas: 1 }),
        verification,
        verification_status: verification.status,
        verification_confidence: verification.confidence,
        verification_warnings: verification.warnings || [],
        reference_match: verification.reference_match,
        source_refs: [
          sourceRef(doc, unit, unitIndex, line, {
            confidence: verification.confidence === "high" ? "high" : "medium",
          }),
        ],
        external_source_refs: externalSourceRefs(verification.reference_match),
      };
      formulas.push(formula);
      currentChapter?.formula_ids.push(formula.formula_id);
    }

    for (const sentence of ruleSentences(textValue).slice(0, 3)) {
      const rule = {
        rule_id: hashId("rule", [doc.id, currentChapter?.chapter_id, sentence]),
        chapter_id: currentChapter?.chapter_id || "unknown",
        name: inferRuleName(sentence),
        statement: clamp(sentence, 180),
        applicable_conditions: /条件|适用|前提|假设/.test(sentence) ? clamp(sentence, 150) : "unknown",
        common_misuses: inferCommonMisuse(sentence, sentence),
        difficulty: difficultyFromText(sentence, "medium"),
        exam_focus: examFocusFromEvidence(sentence),
        source_refs: [sourceRef(doc, unit, unitIndex, sentence, { confidence: "medium" })],
      };
      rules.push(rule);
    }

    for (const anchor of extractProblemAnchors(textValue)) {
      const isExample = anchor.kind === "example";
      const isHomework = anchor.kind !== "example";
      const problemNumber = anchor.number || "unknown";
      const object = {
        chapter_id: currentChapter?.chapter_id || "unknown",
        title: anchor.title,
        problem_text: clamp(anchor.text, 420),
        solution_outline: /解[:：]?/.test(anchor.text) ? clamp(anchor.text.split(/解[:：]?/).slice(1).join("解："), 220) : "unknown",
        related_concepts: detectConceptNames(anchor.text, { profile, courseName: options.courseName, documentName: doc?.originalName }),
        difficulty: difficultyFromText(anchor.text, isExample ? "medium" : "hard"),
        source_refs: [
          sourceRef(doc, unit, unitIndex, anchor.text, {
            problem_number: problemNumber,
            paragraph_index: anchor.index,
            locator_type: "problem_anchor",
            locator_confidence: anchor.confidence,
            anchor_label: anchor.label,
            anchor_text: anchor.text,
          }),
        ],
      };
      if (isExample) {
        const example = { example_id: hashId("example", [doc.id, unitIndex, anchor.text]), ...object };
        examples.push(example);
        currentChapter?.example_ids.push(example.example_id);
      }
      if (isHomework || !isExample) {
        const homework = {
          homework_problem_id: hashId("homework", [doc.id, unitIndex, anchor.text]),
          problem_number: problemNumber,
          ...object,
        };
        homeworkProblems.push(homework);
        currentChapter?.homework_problem_ids.push(homework.homework_problem_id);
      }
    }

    for (const sentence of selectMistakeSentences(textValue, 4)) {
      const mistake = {
        mistake_point_id: hashId("mistake", [doc.id, currentChapter?.chapter_id, sentence]),
        chapter_id: currentChapter?.chapter_id || "unknown",
        description: clamp(sentence, 160),
        related_concepts: detectConceptNames(sentence, { profile, courseName: options.courseName, documentName: doc?.originalName }),
        severity: /必须|不能|不适用|危险|错误/.test(sentence) ? "high" : "medium",
        selection_score: scoreMistakeSentence(sentence),
        evidence_counts: {
          formulas_near: formulaCandidates(sentence).length ? 1 : 0,
          problem_anchors: extractProblemAnchors(textValue).length,
          related_concepts: detectConceptNames(sentence, { profile, courseName: options.courseName, documentName: doc?.originalName }).length,
          conditions: /适用条件|前提|假设|局部|集中力|圣维南|线弹性|小变形/.test(sentence) ? 1 : 0,
          units_or_signs: /正负号|拉为正|压为负|单位|N|kN|mm|m/.test(sentence) ? 1 : 0,
        },
        source_refs: [sourceRef(doc, unit, unitIndex, sentence, { confidence: "medium" })],
      };
      mistakePoints.push(mistake);
      currentChapter?.mistake_point_ids.push(mistake.mistake_point_id);
    }
  }

  const deduped = {
    chapters: uniqueBy(chapters, (item) => `${item.title}:${firstSourceRef(item)?.document_id}:${firstSourceRef(item)?.unit_index}`),
    learningObjectives: uniqueBy(learningObjectives, (item) => item.description),
    concepts: mergeConcepts(concepts),
    formulas: rankAndFilterFormulas(formulas),
    rules: uniqueBy(rules, (item) => item.statement),
    examples: uniqueBy(examples, (item) => item.problem_text),
    homeworkProblems: uniqueBy(homeworkProblems, (item) => item.problem_text),
    mistakePoints: uniqueBy(mistakePoints, (item) => item.description),
  };

  for (const formula of deduped.formulas) {
    const related = deduped.concepts.filter((concept) => {
      const text = `${formula.name}\n${formula.expression}\n${formula.applicable_conditions}`;
      return text.includes(concept.name) || concept.name.includes("应力") && /\\sigma|σ|应力/.test(text);
    });
    for (const concept of related.slice(0, 3)) {
      dependencyEdges.push({
        edge_id: hashId("dep", [formula.formula_id, concept.concept_id]),
        from_id: formula.formula_id,
        to_id: concept.concept_id,
        relation: "depends_on",
        description: `${formula.name} 依赖 ${concept.name} 的定义和适用条件。`,
        source_refs: formula.source_refs,
        confidence: "low",
      });
    }
  }

  const parseQuality = documentParseQuality(doc, units, deduped);
  return {
    document_id: doc?.id || "unknown",
    file_name: doc?.originalName || "unknown",
    document_type: doc?.type || path.extname(doc?.originalName || "").replace(".", "").toLowerCase() || "unknown",
    focus_profile: {
      version: COURSE_FOCUS_VERSION,
      id: profile.id,
      label: profile.label,
    },
    unit_count: units.length,
    parse_quality: parseQuality,
    source_refs: units.map((unit, index) => sourceRef(doc, unit, index, unit.text || unit.label, { confidence: unit.text ? "medium" : "low" })),
    chapters: deduped.chapters,
    learning_objectives: deduped.learningObjectives,
    concepts: deduped.concepts,
    formulas: deduped.formulas,
    theorem_or_rules: deduped.rules,
    examples: deduped.examples,
    homework_problems: deduped.homeworkProblems,
    mistake_points: deduped.mistakePoints,
    dependency_edges: uniqueBy(dependencyEdges, (item) => `${item.from_id}:${item.to_id}:${item.relation}`),
  };
}

function inferFormulaName(expression) {
  if (/F_N|F_\{N\}|FN|轴力|\\sigma|σ/.test(expression) && /A/.test(expression)) return "轴向拉压正应力公式";
  if (/EA|E A|\\Delta|Δ|delta|伸长|变形/.test(expression)) return "轴向变形公式";
  if (/M|弯矩|I/.test(expression) && /\\sigma|σ|应力|y/.test(expression)) return "弯曲正应力公式";
  if (/T|扭矩|J|\\tau|τ/.test(expression)) return "圆轴扭转公式";
  if (/Pcr|P_\{cr\}|欧拉|l0|l_\{0\}|\\pi|π/.test(expression)) return "欧拉临界载荷公式";
  if (/ω|\\omega|sqrt|\\sqrt|k\/m|固有/.test(expression)) return "单自由度固有频率公式";
  return "公式";
}

function inferRuleName(sentence) {
  const text = cleanText(sentence);
  if (/圣维南/.test(text)) return "圣维南原理";
  if (/平面截面/.test(text)) return "平面截面假设";
  if (/轴力.*正负号|拉为正|压为负/.test(text)) return "轴力正负号规则";
  if (/胡克/.test(text)) return "胡克定律";
  const match = text.match(/[\p{L}\p{N}（）()、]{2,24}(?:原理|定理|假设|规则|规律|方法|条件|规定)/u);
  return match ? clamp(match[0], 32) : clamp(text, 32);
}

function mergeConcepts(concepts) {
  const byKey = new Map();
  for (const concept of concepts) {
    const key = `${concept.chapter_id}:${concept.name}`;
    if (!byKey.has(key)) {
      byKey.set(key, { ...concept, source_refs: [...concept.source_refs] });
      continue;
    }
    const existing = byKey.get(key);
    if (existing.description === "unknown" && concept.description !== "unknown") existing.description = concept.description;
    existing.source_refs = uniqueBy([...existing.source_refs, ...concept.source_refs], (ref) => `${ref.document_id}:${ref.unit_index}:${ref.excerpt}`);
    if (concept.exam_focus.score > existing.exam_focus.score) existing.exam_focus = concept.exam_focus;
    existing.syllabus_priority = Math.max(Number(existing.syllabus_priority || 0), Number(concept.syllabus_priority || 0));
    existing.evidence_score = Math.max(Number(existing.evidence_score || 0), Number(concept.evidence_score || 0));
    existing.selection_score = Math.max(Number(existing.selection_score || 0), Number(concept.selection_score || 0));
    existing.importance_score = Math.max(Number(existing.importance_score || 0), Number(concept.importance_score || 0));
    existing.evidence_counts = mergeEvidenceCounts(existing.evidence_counts, concept.evidence_counts);
    existing.candidate_confidence = strongerConfidence(existing.candidate_confidence, concept.candidate_confidence);
    existing.detection_reasons = uniqueStrings([...(existing.detection_reasons || []), ...(concept.detection_reasons || [])]).slice(0, 5);
    existing.concept_group = existing.concept_group || concept.concept_group;
    existing.profile_id = existing.profile_id || concept.profile_id;
    existing.profile_label = existing.profile_label || concept.profile_label;
  }
  return [...byKey.values()].map((concept) => ({
    ...concept,
    importance_score: scoreConceptImportance(concept),
  }));
}

function mergeEvidenceCounts(a = {}, b = {}) {
  const merged = { ...(a || {}) };
  for (const [key, value] of Object.entries(b || {})) {
    merged[key] = Number(merged[key] || 0) + Number(value || 0);
  }
  return merged;
}

function strongerConfidence(a = "low", b = "low") {
  const order = { low: 0, medium: 1, high: 2 };
  return order[b] > order[a] ? b : a;
}

function documentParseQuality(doc, units, parts) {
  const textLength = units.reduce((sum, unit) => sum + String(unit.text || "").length, 0);
  const counts = {
    chapters: parts.chapters.length,
    concepts: parts.concepts.length,
    formulas: parts.formulas.length,
    examples: parts.examples.length,
    homework_problems: parts.homeworkProblems.length,
    mistake_points: parts.mistakePoints.length,
  };
  let score = 0;
  if (textLength > 200) score += 20;
  if (units.length > 1) score += 10;
  score += Math.min(counts.chapters * 8, 20);
  score += Math.min(counts.concepts * 4, 20);
  score += Math.min(counts.formulas * 8, 20);
  score += Math.min((counts.examples + counts.homework_problems) * 5, 15);
  score += Math.min(counts.mistake_points * 3, 10);
  score = Math.min(100, score);
  const warnings = [];
  if (!textLength) warnings.push("没有可用文本");
  if (!counts.formulas) warnings.push("未识别到明确公式");
  if (!counts.examples && !counts.homework_problems) warnings.push("未识别到例题或作业题");
  return {
    score,
    level: score >= 75 ? "good" : score >= 45 ? "partial" : "weak",
    text_length: textLength,
    counts,
    warnings,
  };
}

function buildCourseKnowledgeModel(course, docs = [], options = {}) {
  const profile = detectCourseProfile({
    courseName: course?.name,
    text: docs.map((doc) => `${doc.originalName || ""}\n${doc.text || ""}`).join("\n").slice(0, 10000),
  });
  const documentModels = docs.map((doc) => buildDocumentKnowledgeModel(doc, { ...options, courseName: course?.name, profile }));
  const chapters = [];
  const learningObjectives = [];
  const concepts = [];
  const formulas = [];
  const rules = [];
  const examples = [];
  const homeworkProblems = [];
  const mistakePoints = [];
  const dependencyEdges = [];

  for (const documentModel of documentModels) {
    chapters.push(...documentModel.chapters);
    learningObjectives.push(...documentModel.learning_objectives);
    concepts.push(...documentModel.concepts);
    formulas.push(...documentModel.formulas);
    rules.push(...documentModel.theorem_or_rules);
    examples.push(...documentModel.examples);
    homeworkProblems.push(...documentModel.homework_problems);
    mistakePoints.push(...documentModel.mistake_points);
    dependencyEdges.push(...documentModel.dependency_edges);
  }

  const mergedChapters = mergeChapters(chapters, concepts, formulas, examples, homeworkProblems, mistakePoints);
  const mergedConcepts = mergeCourseConcepts(concepts, mergedChapters);
  const mergedFormulas = rankAndFilterFormulas(formulas, (item) => `${item.chapter_id}:${formulaSignature(item.expression)}`);
  const mergedRules = uniqueBy(rules, (item) => `${item.chapter_id}:${item.name}:${item.statement}`);
  const mergedExamples = uniqueBy(examples, (item) => item.problem_text);
  const mergedHomework = uniqueBy(homeworkProblems, (item) => item.problem_text);
  const mergedMistakes = uniqueBy(mistakePoints, (item) => item.description);
  const focus = courseExamFocus(mergedChapters, mergedFormulas, mergedExamples, mergedHomework, mergedMistakes);

  return {
    schema_version: 1,
    generated_at: options.generatedAt || new Date().toISOString(),
    course: {
      course_id: course?.id || "unknown",
      name: course?.name || "unknown",
      focus_profile: {
        version: COURSE_FOCUS_VERSION,
        id: profile.id,
        label: profile.label,
      },
    },
    documents: documentModels.map((doc) => ({
      document_id: doc.document_id,
      file_name: doc.file_name,
      document_type: doc.document_type,
      unit_count: doc.unit_count,
      parse_quality: doc.parse_quality,
      source_refs: doc.source_refs,
    })),
    chapters: mergedChapters,
    learning_objectives: uniqueBy(learningObjectives, (item) => item.description),
    concepts: mergedConcepts,
    formulas: mergedFormulas,
    theorem_or_rules: mergedRules,
    examples: mergedExamples,
    homework_problems: mergedHomework,
    mistake_points: mergedMistakes,
    dependency_edges: uniqueBy(
      [
        ...dependencyEdges,
        ...inferCourseDependencyEdges(mergedConcepts, mergedFormulas, mergedRules, mergedExamples, mergedHomework, mergedMistakes),
      ],
      (item) => `${item.from_id}:${item.to_id}:${item.relation}`,
    ),
    exam_focus: focus,
    stats: {
      documents: documentModels.length,
      chapters: mergedChapters.length,
      learning_objectives: uniqueBy(learningObjectives, (item) => item.description).length,
      concepts: mergedConcepts.length,
      formulas: mergedFormulas.length,
      theorem_or_rules: mergedRules.length,
      examples: mergedExamples.length,
      homework_problems: mergedHomework.length,
      mistake_points: mergedMistakes.length,
    },
    warnings: courseWarnings(documentModels, mergedFormulas, mergedExamples, mergedHomework),
  };
}

function mergeChapters(chapters, concepts, formulas, examples, homeworkProblems, mistakePoints) {
  const byTitle = new Map();
  for (const chapter of chapters) {
    const key = chapter.title === "unknown" ? chapter.chapter_id : chapter.title.replace(/\s+/g, "");
    if (!byTitle.has(key)) {
      byTitle.set(key, { ...chapter, source_refs: [...chapter.source_refs] });
      continue;
    }
    const existing = byTitle.get(key);
    existing.source_refs = sortSourceRefsByUsefulness(
      uniqueBy([...existing.source_refs, ...chapter.source_refs], (ref) => `${ref.document_id}:${ref.unit_index}`),
    );
    existing.difficulty = harderDifficulty(existing.difficulty, chapter.difficulty);
    if (chapter.exam_focus.score > existing.exam_focus.score) existing.exam_focus = chapter.exam_focus;
  }
  const list = [...byTitle.values()].sort((a, b) => a.order - b.order);
  for (const chapter of list) {
    chapter.source_refs = sortSourceRefsByUsefulness(chapter.source_refs);
    chapter.concept_ids = concepts.filter((item) => item.chapter_id === chapter.chapter_id).map((item) => item.concept_id);
    chapter.formula_ids = formulas.filter((item) => item.chapter_id === chapter.chapter_id).map((item) => item.formula_id);
    chapter.example_ids = examples.filter((item) => item.chapter_id === chapter.chapter_id).map((item) => item.example_id);
    chapter.homework_problem_ids = homeworkProblems
      .filter((item) => item.chapter_id === chapter.chapter_id)
      .map((item) => item.homework_problem_id);
    chapter.mistake_point_ids = mistakePoints.filter((item) => item.chapter_id === chapter.chapter_id).map((item) => item.mistake_point_id);
    chapter.exam_focus = examFocusFromEvidence(chapter.title, {
      formulas: chapter.formula_ids.length,
      examples: chapter.example_ids.length,
      homework: chapter.homework_problem_ids.length,
      mistakes: chapter.mistake_point_ids.length,
    });
  }
  return list;
}

function sortSourceRefsByUsefulness(refs = []) {
  return [...refs].sort((a, b) => sourceRefUsefulness(b) - sourceRefUsefulness(a));
}

function sourceRefUsefulness(ref = {}) {
  const text = cleanText(ref.excerpt || ref.anchor_text || "");
  let score = 0;
  if (text) score += 2;
  if (!isContentsLikeText(text)) score += 8;
  if (/特点|外力|轴线|变形|公式|条件|计算|截面|应力|应变|伸长|缩短/.test(text)) score += 6;
  if (/例题|问题|思考题/.test(text)) score += 3;
  if (String(ref.confidence || ref.locator_confidence) === "medium") score += 1;
  return score;
}

function mergeCourseConcepts(concepts, chapters) {
  const knownChapterIds = new Set(chapters.map((chapter) => chapter.chapter_id));
  return rankAndLimitConcepts(
    mergeConcepts(concepts).map((concept) => ({
      ...concept,
      chapter_id: knownChapterIds.has(concept.chapter_id) ? concept.chapter_id : chapters[0]?.chapter_id || "unknown",
      importance_score: scoreConceptImportance(concept),
    })),
  );
}

function rankAndLimitConcepts(concepts) {
  const ranked = uniqueBy(
    [...concepts].sort((a, b) => scoreConceptImportance(b) - scoreConceptImportance(a)),
    (concept) => concept.name,
  )
    .filter((concept) => hasStrongConceptEvidence(concept) || scoreConceptImportance(concept) >= 170 || concept.exam_focus?.level === "high")
    .sort((a, b) => scoreConceptImportance(b) - scoreConceptImportance(a));
  const groups = new Map();
  const selected = [];
  for (const concept of ranked) {
    const group = concept.concept_group || "other";
    const count = groups.get(group) || 0;
    if (count >= 4 && scoreConceptImportance(concept) < 112) continue;
    groups.set(group, count + 1);
    selected.push({ ...concept, importance_score: scoreConceptImportance(concept) });
    if (selected.length >= 36) break;
  }
  return selected.sort((a, b) => {
    if (a.chapter_id !== b.chapter_id) return String(a.chapter_id).localeCompare(String(b.chapter_id));
    return scoreConceptImportance(b) - scoreConceptImportance(a);
  });
}

function hasStrongConceptEvidence(concept = {}) {
  const counts = concept.evidence_counts || {};
  const anchoredSignals =
    Number(counts.definition_sentences || 0) +
    Number(counts.formulas_near || 0) +
    Number(counts.problem_anchors || 0) +
    Number(counts.rules || 0) +
    Number(counts.mistakes || 0) +
    Number(counts.title_hits || 0);
  if (concept.candidate_confidence === "high" && anchoredSignals >= 1) return true;
  if (concept.candidate_confidence === "medium" && anchoredSignals >= 2) return true;
  return Number(concept.selection_score || 0) >= 142 && anchoredSignals >= 1;
}

function harderDifficulty(a, b) {
  return DIFFICULTIES.indexOf(b) > DIFFICULTIES.indexOf(a) ? b : a;
}

function courseExamFocus(chapters, formulas, examples, homeworkProblems, mistakePoints) {
  return {
    level:
      formulas.length + homeworkProblems.length + mistakePoints.length >= 10
        ? "high"
        : formulas.length + examples.length + homeworkProblems.length >= 4
          ? "medium"
          : "low",
    score: Math.min(100, formulas.length * 10 + examples.length * 8 + homeworkProblems.length * 10 + mistakePoints.length * 8),
    reasons: uniqueStrings([
      formulas.length ? `${formulas.length} 条公式` : "",
      homeworkProblems.length ? `${homeworkProblems.length} 道作业/练习` : "",
      mistakePoints.length ? `${mistakePoints.length} 个易错点` : "",
      chapters.length ? `${chapters.length} 个章节/小节` : "",
    ]),
  };
}

function inferCourseDependencyEdges(concepts, formulas, rules, examples, homeworkProblems, mistakePoints) {
  const edges = [];
  for (const formula of formulas) {
    for (const concept of concepts.filter((item) => item.chapter_id === formula.chapter_id).slice(0, 3)) {
      edges.push({
        edge_id: hashId("edge", [formula.formula_id, concept.concept_id, "depends_on"]),
        from_id: formula.formula_id,
        to_id: concept.concept_id,
        relation: "depends_on",
        description: `${formula.name} 需要先理解 ${concept.name}。`,
        source_refs: formula.source_refs,
        confidence: "low",
      });
    }
  }
  for (const problem of [...examples, ...homeworkProblems]) {
    const problemId = problem.example_id || problem.homework_problem_id;
    const sourceText = `${problem.problem_text}\n${problem.title}`;
    for (const formula of formulas.filter((item) => item.chapter_id === problem.chapter_id)) {
      if (formula.variables.some((variable) => sourceText.includes(variable.symbol)) || detectConceptNames(sourceText).length) {
        edges.push({
          edge_id: hashId("edge", [problemId, formula.formula_id, "uses_formula"]),
          from_id: problemId,
          to_id: formula.formula_id,
          relation: "uses_formula",
          description: `${problem.title} 可用 ${formula.name} 检查。`,
          source_refs: problem.source_refs,
          confidence: "low",
        });
      }
    }
  }
  for (const mistake of mistakePoints) {
    for (const concept of concepts.filter((item) => item.chapter_id === mistake.chapter_id).slice(0, 2)) {
      edges.push({
        edge_id: hashId("edge", [concept.concept_id, mistake.mistake_point_id, "causes_mistake"]),
        from_id: concept.concept_id,
        to_id: mistake.mistake_point_id,
        relation: "causes_mistake",
        description: `${concept.name} 的条件或符号处理不当会导致该错误。`,
        source_refs: mistake.source_refs,
        confidence: "low",
      });
    }
  }
  for (const rule of rules) {
    for (const concept of concepts.filter((item) => item.chapter_id === rule.chapter_id).slice(0, 2)) {
      edges.push({
        edge_id: hashId("edge", [rule.rule_id, concept.concept_id, "depends_on"]),
        from_id: rule.rule_id,
        to_id: concept.concept_id,
        relation: "depends_on",
        description: `${rule.name} 与 ${concept.name} 相关。`,
        source_refs: rule.source_refs,
        confidence: "low",
      });
    }
  }
  return edges;
}

function courseWarnings(documentModels, formulas, examples, homeworkProblems) {
  const warnings = [];
  if (!documentModels.length) warnings.push("没有选中的资料。");
  if (!formulas.length) warnings.push("资料中没有识别出足够明确的公式，公式应用题会受限。");
  if (formulas.some((formula) => formula.verification_status === "unverified")) {
    warnings.push("存在无法和基础公式库匹配的公式，使用前需要回到来源页核对。");
  }
  if (!examples.length && !homeworkProblems.length) warnings.push("资料中没有识别出例题或作业题，变式题会以章节概念为主。");
  for (const doc of documentModels) {
    for (const warning of doc.parse_quality.warnings || []) warnings.push(`${doc.file_name}: ${warning}`);
  }
  return uniqueStrings(warnings);
}

function nearbyTextForFormula(textValue, formulaLine) {
  const sentences = splitSentences(textValue);
  const index = sentences.findIndex((sentence) => sentence.includes(formulaLine.slice(0, 12)) || formulaLine.includes(sentence.slice(0, 12)));
  if (index < 0) return sentences.slice(0, 4).join(" ");
  return sentences.slice(Math.max(0, index - 2), index + 3).join(" ");
}

function externalSourceRefs(referenceMatch = null) {
  return (referenceMatch?.sources || []).map((source) => ({
    source_id: source.id || "unknown",
    title: source.title || "unknown",
    url: source.url || "",
    type: "external_reference",
  }));
}

function rankAndFilterFormulas(formulas = [], keyFn = (item) => formulaSignature(item.expression)) {
  return uniqueBy(
    [...formulas]
      .filter((formula) => formulaIsUsable(formula))
      .sort((a, b) => verifiedFormulaScore(b) - verifiedFormulaScore(a) || Number(b.exam_focus?.score || 0) - Number(a.exam_focus?.score || 0)),
    keyFn,
  );
}

module.exports = {
  DIFFICULTIES,
  LOCATOR_VERSION,
  buildCourseKnowledgeModel,
  buildDocumentKnowledgeModel,
  sourceRef,
  sourceDocumentIds,
  normalizeText,
  cleanText,
  clamp,
  splitSentences,
  detectConceptNames,
  detectConceptCandidatesForText,
  difficultyFromText,
  examFocusFromEvidence,
  extractProblemAnchors,
  formulaCandidates,
  rankAndFilterFormulas,
  isContentsLikeText,
  normalizeFormulaExpression,
  hashId,
  uniqueStrings,
  uniqueBy,
};
