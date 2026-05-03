const GREEK_ALIASES = [
  ["varepsilon", "\\varepsilon"],
  ["epsilon", "\\varepsilon"],
  ["varphi", "\\varphi"],
  ["sigma", "\\sigma"],
  ["Delta", "\\Delta"],
  ["delta", "\\delta"],
  ["theta", "\\theta"],
  ["omega", "\\omega"],
  ["alpha", "\\alpha"],
  ["gamma", "\\gamma"],
  ["lambda", "\\lambda"],
  ["beta", "\\beta"],
  ["tau", "\\tau"],
  ["phi", "\\varphi"],
  ["psi", "\\psi"],
  ["rho", "\\rho"],
  ["mu", "\\mu"],
  ["nu", "\\nu"],
  ["pi", "\\pi"],
  ["Omega", "\\Omega"],
  ["Phi", "\\Phi"],
  ["sin", "\\sin"],
  ["cos", "\\cos"],
  ["tan", "\\tan"],
  ["log", "\\log"],
];

const UNICODE_SYMBOLS = new Map([
  ["σ", "\\sigma"],
  ["ε", "\\varepsilon"],
  ["τ", "\\tau"],
  ["γ", "\\gamma"],
  ["θ", "\\theta"],
  ["φ", "\\varphi"],
  ["ϕ", "\\varphi"],
  ["ρ", "\\rho"],
  ["ω", "\\omega"],
  ["Ω", "\\Omega"],
  ["μ", "\\mu"],
  ["ν", "\\nu"],
  ["π", "\\pi"],
  ["Δ", "\\Delta"],
  ["δ", "\\delta"],
  ["ψ", "\\psi"],
  ["Φ", "\\Phi"],
  ["∇", "\\nabla"],
  ["±", "\\pm"],
  ["∑", "\\sum"],
  ["Σ", "\\sum"],
  ["∫", "\\int"],
  ["∞", "\\infty"],
  ["≤", "\\le"],
  ["≥", "\\ge"],
  ["≈", "\\approx"],
  ["≠", "\\ne"],
  ["×", "\\times"],
  ["·", "\\cdot"],
]);

function toLatexFormula(value, options = {}) {
  let expression = cleanFormulaText(value);
  if (!expression) return "";
  if (options.extract !== false) expression = extractFormulaSegment(expression);
  expression = normalizeOperatorsAndAliases(expression);
  expression = normalizeSqrt(expression);
  expression = normalizeScripts(expression);
  expression = normalizeGroupedFractions(expression);
  expression = normalizeSimpleFractions(expression);
  return tidyLatexFormula(expression);
}

function wrapInlineFormula(value) {
  const expression = toLatexFormula(value);
  return expression ? `$${expression}$` : "";
}

function latexFraction(numerator, denominator) {
  const top = toLatexFormula(stripOuterDelimiters(numerator), { extract: false });
  const bottom = toLatexFormula(stripOuterDelimiters(denominator), { extract: false });
  if (!top || !bottom) return tidyLatexFormula(`${numerator} / ${denominator}`);
  return `\\frac{${top}}{${bottom}}`;
}

function cleanFormulaText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[：]/g, ":")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[，]/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFormulaSegment(value) {
  const text = cleanFormulaText(value);
  const chunks = text
    .split(/[。；;！？\n]/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  let candidate = chunks.find(hasFormulaOperator) || text;
  candidate = candidate
    .replace(/^.*?(?:公式|方程|关系式|关系|表达式|可得|得到|为|是|:)\s*/u, "")
    .replace(/[,，]?\s*(?:其中|需要|适用|条件|可用于|用于|注意|并).*/u, "")
    .trim();
  candidate = stripLeadingNonFormulaText(candidate);
  return candidate || text;
}

function hasFormulaOperator(value) {
  return /(?:=|≤|≥|≈|<|>|\\le|\\ge|\\approx|\/|√|\bsqrt\s*\()/i.test(value);
}

function stripLeadingNonFormulaText(value) {
  const index = value.search(/\\[A-Za-z]+|[A-Za-zΑ-ωσσετγθφωΩμνπΔδψ]/u);
  if (index > 0 && /[\p{Script=Han}]/u.test(value.slice(0, index))) return value.slice(index).trim();
  return value;
}

function normalizeOperatorsAndAliases(value) {
  let expression = value
    .replace(/∇\s*f/g, "\\nabla f")
    .replace(/\bF\s+N\b/g, "F_N")
    .replace(/\bFN\b/g, "F_N")
    .replace(/\bP\s*cr\b/gi, "P_{cr}")
    .replace(/\bKsp\b/gi, "K_{sp}")
    .replace(/\bpKa\b/g, "pK_a")
    .replace(/\bdPhi_?B\b/g, "d\\Phi_B")
    .replace(/\bM\s*max\b/gi, "M_{\\max}")
    .replace(/\bM([xy])\b/g, "M $1")
    .replace(/\bF([Ll])\b/g, "F $1")
    .replace(/\bl\s*0\b/g, "l_0")
    .replace(/<=/g, "\\le")
    .replace(/>=/g, "\\ge")
    .replace(/!=/g, "\\ne")
    .replace(/->/g, "\\to")
    .replace(/→/g, "\\to");

  for (const [char, replacement] of UNICODE_SYMBOLS.entries()) {
    expression = expression.split(char).join(replacement);
  }

  for (const [word, replacement] of GREEK_ALIASES) {
    expression = expression.replace(new RegExp(`(?<!\\\\)\\b${word}(?=\\b|_)`, "g"), replacement);
  }

  return normalizeMechanicsFormulaShape(spaceVariableProducts(expression));
}

function normalizeMechanicsFormulaShape(value) {
  let expression = String(value || "").trim();
  expression = expression
    .replace(/\bA\s+F_N\s*=\s*(?:\\sigma|sigma|σ)\b/gi, "\\sigma = F_N / A")
    .replace(/\bF_N\s+A\s*=\s*(?:\\sigma|sigma|σ)\b/gi, "\\sigma = F_N / A")
    .replace(/(?:\\sigma|sigma|σ)\s*=\s*F_N\s+A\b/gi, "\\sigma = F_N / A")
    .replace(/(?:\\sigma|sigma|σ)\s*=\s*\(?\s*F_N\s*\)?\s*\/\s*\(?\s*A\s*\)?/gi, "\\sigma = F_N / A")
    .replace(/(?:\\sigma|sigma|σ)\s*=\s*\(?\s*F\s*\)?\s*\/\s*\(?\s*A\s*\)?/gi, "\\sigma = F / A");
  return expression;
}

function spaceVariableProducts(value) {
  let expression = value;
  let previous = "";
  while (previous !== expression) {
    previous = expression;
    expression = expression.replace(/\b([A-Z])([A-Z])(?=(?:\\|[A-Z]|\b))/g, "$1 $2");
  }
  return expression;
}

function normalizeSqrt(value) {
  let expression = value;
  let searchIndex = 0;
  while (searchIndex < expression.length) {
    const match = /(?<!\\)\bsqrt\s*\(/i.exec(expression.slice(searchIndex));
    if (!match) break;
    const openIndex = searchIndex + match.index + match[0].lastIndexOf("(");
    const group = extractBalancedParen(expression, openIndex);
    if (!group) break;
    const inner = toLatexFormula(group.value, { extract: false });
    expression = `${expression.slice(0, searchIndex + match.index)}\\sqrt{${inner}}${expression.slice(group.endIndex + 1)}`;
    searchIndex = searchIndex + match.index + 7 + inner.length;
  }
  return expression;
}

function normalizeScripts(value) {
  return value
    .replace(/(\\[A-Za-z]+|[A-Za-z])_([A-Za-z0-9,]+|\\[A-Za-z]+)(?!\})/g, "$1_{$2}")
    .replace(/(\\[A-Za-z]+|[A-Za-z])\^([A-Za-z0-9]+|\\[A-Za-z]+)(?!\})/g, "$1^{$2}")
    .replace(/_\{max\}/gi, "_{\\max}")
    .replace(/_\{min\}/gi, "_{\\min}");
}

function normalizeSimpleFractions(value) {
  if (!value.includes("/")) return value;
  const parts = splitByComparisonOperator(value);
  return parts
    .map((part) => (part.operator ? ` ${part.value} ` : normalizeSegmentFraction(part.value)))
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeGroupedFractions(value) {
  return String(value || "").replace(/\(([^()]{1,80})\)\s*\/\s*([A-Za-z0-9\\{}_^]+|\([^()]{1,80}\))/g, (match, numerator, denominator) => {
    if (!numerator || /[=<>]/.test(numerator)) return match;
    const bottom = stripOuterDelimiters(denominator);
    if (!bottom || /[=<>]/.test(bottom)) return match;
    return latexFraction(numerator, bottom);
  });
}

function splitByComparisonOperator(value) {
  const parts = [];
  const pattern = /\\le|\\ge|\\ne|\\approx|=|<|>/g;
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    if (match.index > lastIndex) parts.push({ value: value.slice(lastIndex, match.index), operator: false });
    parts.push({ value: match[0], operator: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) parts.push({ value: value.slice(lastIndex), operator: false });
  return parts.length ? parts : [{ value, operator: false }];
}

function normalizeSegmentFraction(segment) {
  if (!segment.includes("/")) return segment;
  const slashIndex = findTopLevelSlash(segment);
  if (slashIndex === -1) return segment;
  if (findTopLevelSlash(segment, slashIndex + 1) !== -1) return segment;
  if (hasTopLevelAddSub(segment)) return segment;

  const numerator = stripOuterDelimiters(segment.slice(0, slashIndex).trim());
  const denominator = stripOuterDelimiters(segment.slice(slashIndex + 1).trim());
  if (!numerator || !denominator) return segment;
  return latexFraction(numerator, denominator);
}

function findTopLevelSlash(value, startIndex = 0) {
  let parenDepth = 0;
  let braceDepth = 0;
  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(" || char === "[") parenDepth += 1;
    else if (char === ")" || char === "]") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (char === "/" && parenDepth === 0 && braceDepth === 0) return index;
  }
  return -1;
}

function hasTopLevelAddSub(value) {
  let parenDepth = 0;
  let braceDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(" || char === "[") parenDepth += 1;
    else if (char === ")" || char === "]") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if ((char === "+" || char === "-" || value.startsWith("\\pm", index)) && index > 0 && parenDepth === 0 && braceDepth === 0) return true;
  }
  return false;
}

function stripOuterDelimiters(value) {
  let expression = String(value || "").trim();
  let changed = true;
  while (changed && expression.length >= 2) {
    changed = false;
    const first = expression[0];
    const last = expression.at(-1);
    if ((first === "(" && last === ")") || (first === "[" && last === "]")) {
      const closeIndex = matchingCloseIndex(expression, 0);
      if (closeIndex === expression.length - 1) {
        expression = expression.slice(1, -1).trim();
        changed = true;
      }
    }
  }
  return expression;
}

function matchingCloseIndex(value, openIndex) {
  const open = value[openIndex];
  const close = open === "[" ? "]" : ")";
  let depth = 0;
  for (let index = openIndex; index < value.length; index += 1) {
    if (value[index] === open) depth += 1;
    else if (value[index] === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function extractBalancedParen(value, openIndex) {
  if (value[openIndex] !== "(") return null;
  let depth = 0;
  for (let index = openIndex; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return { value: value.slice(openIndex + 1, index), endIndex: index };
      }
    }
  }
  return null;
}

function tidyLatexFormula(value) {
  return String(value || "")
    .replace(/\\nabla\s*f/g, "\\nabla f")
    .replace(/\\nablaf/g, "\\nabla f")
    .replace(/<\s*f_\{x,\}\s*f_\{y,\}\s*f_\{z\}\s*>/g, "\\langle f_x, f_y, f_z \\rangle")
    .replace(/\\langle\s*f_\{x,\}\s*f_\{y,\}\s*f_\{z\}\s*\\rangle/g, "\\langle f_x, f_y, f_z \\rangle")
    .replace(/<\s*f_\{?x\}?\s*,\s*f_\{?y\}?\s*,\s*f_\{?z\}?\s*>/g, "\\langle f_x, f_y, f_z \\rangle")
    .replace(/d\s*\\Phi_\{?B\}?\s*\/\s*d\s*t/g, "\\frac{d \\Phi_{B}}{d t}")
    .replace(/d\s*N\s*\/\s*d\s*t/g, "\\frac{d N}{d t}")
    .replace(/\[H A\]/g, "[HA]")
    .replace(/\s*([=<>])\s*/g, " $1 ")
    .replace(/\s*(\\le|\\ge|\\ne|\\approx|\\to|\\pm)\s*/g, " $1 ")
    .replace(/\{\s+/g, "{")
    .replace(/\s+\}/g, "}")
    .replace(/\}(?=[A-Za-z\\])/g, "} ")
    .replace(/\s+([,.;，。；])/g, "$1")
    .replace(/(?<=[A-Za-z0-9}])\\(alpha|beta|gamma|delta|varepsilon|theta|lambda|mu|nu|pi|rho|sigma|tau|varphi|omega|Omega|Delta|psi)/g, " \\$1")
    .replace(/(\\(?:alpha|beta|gamma|delta|varepsilon|theta|lambda|mu|nu|pi|rho|sigma|tau|varphi|omega|Omega|Delta|psi))(?=[A-Za-z])/g, "$1 ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

module.exports = {
  toLatexFormula,
  wrapInlineFormula,
  latexFraction,
};
