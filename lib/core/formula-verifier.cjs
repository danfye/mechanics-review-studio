const { toLatexFormula } = require("./formula-format.cjs");
const { REFERENCE_FORMULAS } = require("./reference-formulas.cjs");

const SUBJECT_HINTS = {
  engineering_mechanics: [
    "材料力学",
    "工程力学",
    "理论力学",
    "结构力学",
    "轴力",
    "拉压",
    "应力",
    "应变",
    "弯矩",
    "梁",
    "扭转",
    "压杆",
    "mechanics",
    "stress",
    "strain",
  ],
  physics: ["物理", "力学", "运动", "牛顿", "动量", "压强", "流体", "振动", "physics", "kinematics", "Newton"],
  chemistry: ["化学", "理想气体", "溶液", "摩尔", "pH", "酸碱", "chemistry", "molarity", "ideal gas"],
  mathematics: ["数学", "高数", "微积分", "导数", "积分", "三角", "calculus", "derivative", "trigonometric"],
  biology: ["生物", "遗传", "种群", "生态", "Hardy", "Weinberg", "biology", "genetics", "ecology"],
};

const SUSPICIOUS_PATTERNS = [
  {
    pattern: /(?:^|[^A-Za-z])A\s*F_\{?N\}?\s*=\s*(?:\\?sigma|σ)|(?:^|[^A-Za-z])F_\{?N\}?\s*A\s*=\s*(?:\\?sigma|σ)/i,
    message: "疑似 OCR 把分式顺序识别错，应核对是否为正应力公式。",
  },
  {
    pattern: /\\sigma\s*=\s*F_\{?N\}?\s*\+\s*A/i,
    message: "疑似把除号识别成加号，应核对是否为 sigma = F_N / A。",
  },
  {
    pattern: /\\tau\s*=\s*T\s*[rρ\\rho]*\s*\+\s*J/i,
    message: "疑似把除号识别成加号，应核对是否为 tau = T r / J。",
  },
  {
    pattern: /P_\{?cr\}?\s*=\s*\\pi\^?\{?2\}?\s*E\s*I\s*\+\s*l_\{?0\}?\^?\{?2\}?/i,
    message: "疑似把欧拉公式分母识别错，应核对计算长度平方是否在分母。",
  },
];

const KNOWN_FALSE_SHAPES = [
  /\\sigma\s*=\s*F_\{?N\}?\s*\+\s*A/i,
  /\\tau\s*=\s*T\s*(?:r|\\rho|ρ)?\s*\+\s*J/i,
  /P_\{?cr\}?\s*=\s*\\pi\^?\{?2\}?\s*E\s*I\s*\+\s*l_\{?0\}?\^?\{?2\}?/i,
];

const REFERENCE_INDEX = REFERENCE_FORMULAS.map((item) => {
  const expressions = [item.expression, ...(item.aliases || [])].filter(Boolean);
  return {
    ...item,
    normalized_expression: toLatexFormula(item.expression, { extract: false }),
    signatures: expressions.map((value) => formulaSignature(toLatexFormula(value, { extract: false }) || value)).filter(Boolean),
    token_sets: expressions.map((value) => symbolTokenSet(toLatexFormula(value, { extract: false }) || value)).filter((set) => set.size),
  };
});

function verifyFormula(expression, context = {}) {
  const normalized = toLatexFormula(expression) || String(expression || "").trim();
  const raw = String(expression || "");
  const warnings = suspiciousWarnings(`${raw}\n${normalized}`);
  const contextText = contextTextForScoring(context);
  const candidates = REFERENCE_INDEX.map((reference) => scoreReferenceMatch(reference, normalized, contextText))
    .filter((match) => match.score >= 58)
    .sort((a, b) => b.score - a.score);
  const best = candidates[0] || null;
  const status = classifyVerification(best, normalized, warnings);
  const canonical = best && status !== "rejected" ? best.reference.normalized_expression : normalized;
  const corrected = canonical !== normalized || Boolean(best && warnings.length && status !== "rejected");
  return {
    status,
    confidence: confidenceForStatus(status, best),
    expression: canonical,
    original_expression: corrected ? raw.trim() || normalized : normalized,
    raw_expression: raw.trim(),
    corrected,
    reference_match: best
      ? {
          formula_id: best.reference.id,
          name: best.reference.name,
          subject: best.reference.subject,
          topic: best.reference.topic,
          score: best.score,
          sources: best.reference.sources || [],
        }
      : null,
    variables: best?.reference.variables?.map(([symbol, meaning]) => ({ symbol, meaning })) || null,
    applicable_conditions: best?.reference.applicable_conditions || null,
    common_misuses: best?.reference.common_misuses || null,
    warnings,
  };
}

function verifiedFormulaScore(formula = {}) {
  const status = formula.verification?.status || formula.verification_status || "unverified";
  const confidence = formula.verification?.confidence || formula.confidence || "low";
  let score = 0;
  if (status === "verified") score += 80;
  else if (status === "corrected") score += 70;
  else if (status === "plausible") score += 28;
  else if (status === "rejected") score -= 80;
  if (confidence === "high") score += 18;
  if (confidence === "medium") score += 8;
  if (formula.reference_match || formula.verification?.reference_match) score += 16;
  if ((formula.verification_warnings || formula.verification?.warnings || []).length) score -= 10;
  return score;
}

function formulaIsUsable(formula = {}, options = {}) {
  const status = formula.verification?.status || formula.verification_status || "unverified";
  if (status === "rejected") return false;
  if (options.requireReference) return status === "verified" || status === "corrected";
  return status !== "unverified" || !formula.verification;
}

function suspiciousWarnings(value) {
  const text = String(value || "");
  return SUSPICIOUS_PATTERNS.filter((item) => item.pattern.test(text)).map((item) => item.message);
}

function classifyVerification(best, expression, warnings) {
  if (knownFalseShape(expression) && !best) return "rejected";
  if (!best) return warnings.length ? "rejected" : "unverified";
  if (warnings.length && best.score >= 82) return "corrected";
  if (best.score >= 112) return best.reference.normalized_expression === expression ? "verified" : "corrected";
  if (best.score >= 82 && best.hasContext) return best.reference.normalized_expression === expression ? "verified" : "corrected";
  if (best.score >= 72 && !warnings.length) return "plausible";
  return "rejected";
}

function confidenceForStatus(status, best) {
  if (status === "verified" || status === "corrected") return best?.score >= 112 ? "high" : "medium";
  if (status === "plausible") return "medium";
  if (status === "rejected") return "low";
  return "low";
}

function scoreReferenceMatch(reference, expression, contextText) {
  const signature = formulaSignature(expression);
  const tokens = symbolTokenSet(expression);
  const directSignature = reference.signatures.includes(signature);
  const tokenScore = Math.max(...reference.token_sets.map((set) => jaccard(tokens, set)), 0);
  const leftScore = leftSide(expression) && leftSide(expression) === leftSide(reference.normalized_expression) ? 18 : 0;
  const contextScore = contextMatchScore(reference, contextText);
  const subjectScore = subjectMatchScore(reference.subject, contextText);
  const denominatorScore = denominatorCompatibility(expression, reference.normalized_expression);
  const falsePenalty = knownFalseShape(expression) && tokenScore < 0.92 ? 35 : 0;
  const score = Math.round(
    (directSignature ? 82 : 0) +
      tokenScore * 66 +
      leftScore +
      contextScore +
      subjectScore +
      denominatorScore -
      falsePenalty,
  );
  return {
    reference,
    score,
    hasContext: contextScore + subjectScore >= 14,
    tokenScore,
  };
}

function contextMatchScore(reference, contextText) {
  if (!contextText) return 0;
  const hints = reference.concept_hints || [];
  const hits = hints.filter((hint) => normalizedText(contextText).includes(normalizedText(hint))).length;
  return Math.min(26, hits * 8);
}

function subjectMatchScore(subject, contextText) {
  if (!contextText || !subject) return 0;
  const hints = SUBJECT_HINTS[subject] || [];
  return hints.some((hint) => normalizedText(contextText).includes(normalizedText(hint))) ? 14 : 0;
}

function denominatorCompatibility(expression, referenceExpression) {
  const denominator = denominatorSymbols(referenceExpression);
  if (!denominator.size) return 0;
  const source = formulaSignature(expression);
  const matched = [...denominator].filter((symbol) => source.includes(symbol)).length;
  if (!matched) return 0;
  if (matched === denominator.size && /\\frac\{/.test(expression)) return 12;
  return 4;
}

function denominatorSymbols(expression) {
  const normalized = toLatexFormula(expression, { extract: false }) || expression;
  const matches = [...String(normalized).matchAll(/\\frac\{[^{}]*\}\{([^{}]*)\}/g)];
  const symbols = new Set();
  for (const match of matches) {
    for (const token of symbolTokenSet(match[1])) symbols.add(token);
  }
  return symbols;
}

function knownFalseShape(value) {
  return KNOWN_FALSE_SHAPES.some((pattern) => pattern.test(String(value || "")));
}

function contextTextForScoring(context = {}) {
  return [context.courseName, context.documentName, context.chapterTitle, context.unitText, context.nearbyText]
    .filter(Boolean)
    .join("\n")
    .slice(0, 5000);
}

function formulaSignature(value) {
  return String(value || "")
    .replace(/\\varepsilon/g, "epsilon")
    .replace(/\\varphi/g, "phi")
    .replace(/\\Delta/g, "delta")
    .replace(/\\sigma/g, "sigma")
    .replace(/\\tau/g, "tau")
    .replace(/\\rho/g, "rho")
    .replace(/\\omega/g, "omega")
    .replace(/\\pi/g, "pi")
    .replace(/\\mu/g, "mu")
    .replace(/\\le/g, "<=")
    .replace(/\\ge/g, ">=")
    .replace(/\\cdot|\\times/g, "")
    .replace(/_\{([^{}]+)\}/g, "_$1")
    .replace(/\^\{([^{}]+)\}/g, "^$1")
    .replace(/\{|\}/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function leftSide(value) {
  const signature = formulaSignature(value);
  const match = signature.match(/^([^=<>]+)(?:=|<=|>=|<|>)/);
  return match ? match[1] : "";
}

function symbolTokenSet(value) {
  const signature = formulaSignature(value)
    .replace(/frac/g, " ")
    .replace(/sqrt/g, " ")
    .replace(/log/g, " log ");
  const tokens = new Set();
  for (const match of signature.matchAll(/[a-z]+(?:_[a-z0-9]+)?|[a-z]|\d+(?:\.\d+)?/g)) {
    const token = match[0];
    if (!token || ["frac", "sqrt", "left", "right", "constant"].includes(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

function jaccard(a, b) {
  if (!a?.size || !b?.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function normalizedText(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

module.exports = {
  REFERENCE_FORMULAS,
  formulaIsUsable,
  formulaSignature,
  verifyFormula,
  verifiedFormulaScore,
};
