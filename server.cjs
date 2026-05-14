const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const {
  buildCourseKnowledgeModel,
  buildDocumentKnowledgeModel,
  extractProblemAnchors,
  learningPackContext,
  LOCATOR_VERSION,
} = require("./lib/core/knowledge-model.cjs");
const { generateQuestionSet } = require("./lib/core/question-generator.cjs");
const { evaluateQuestionSet } = require("./lib/core/quality.cjs");
const { generateMindMap } = require("./lib/core/mindmap-generator.cjs");
const { StudyPlanGenerator } = require("./lib/core/study-plan-generator.cjs");
const { generateCramPack } = require("./lib/core/cram-pack-generator.cjs");
const { toLatexFormula, wrapInlineFormula, latexFraction } = require("./lib/core/formula-format.cjs");
const { verifyFormula } = require("./lib/core/formula-verifier.cjs");
const {
  localSolveQuestion,
  normalizeApiQuestion,
  normalizeApiQuestionList,
  normalizeSolution,
} = require("./lib/core/solution-generator.cjs");
const serverHttp = require("./lib/server/http.cjs");
const { createRepository } = require("./lib/server/repository.cjs");
const { createWorkspaceService } = require("./lib/server/workspace-service.cjs");
const { createRuntimeRequire } = require("./lib/server/runtime-require.cjs");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const PUBLIC_DIR = path.join(ROOT, "public");
const DB_PATH = path.join(DATA_DIR, "db.json");
const runtimeRequire = createRuntimeRequire(ROOT);
const repository = createRepository({ dataDir: DATA_DIR, uploadDir: UPLOAD_DIR, dbPath: DB_PATH });
const workspaceService = createWorkspaceService({ buildDocumentKnowledgeModel });
const { json, text, readJson } = serverHttp;
const { ensureDataDirs, readDb, writeDb, storedUploadPath, deleteStoredDocumentFile } = repository;
const { publicState, refreshDocumentKnowledge } = workspaceService;

const API_CACHE_TTL_MS = 1000 * 60 * 10;
const API_TIMEOUT_MS = 1000 * 45;
const API_CACHE_LIMIT = 24;
const apiResponseCache = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const MECH_TERMS = [
  "静力学",
  "动力学",
  "材料力学",
  "理论力学",
  "弹性力学",
  "流体力学",
  "力",
  "力矩",
  "约束",
  "约束反力",
  "受力图",
  "平衡方程",
  "内力",
  "轴力",
  "剪力",
  "弯矩",
  "扭矩",
  "应力",
  "正应力",
  "剪应力",
  "应变",
  "胡克定律",
  "弹性模量",
  "泊松比",
  "截面",
  "惯性矩",
  "极惯性矩",
  "挠度",
  "转角",
  "强度条件",
  "刚度条件",
  "稳定性",
  "压杆",
  "欧拉公式",
  "屈曲",
  "能量法",
  "虚位移",
  "达朗贝尔",
  "动量",
  "动量矩",
  "功",
  "功率",
  "动能",
  "势能",
  "振动",
  "固有频率",
  "阻尼",
  "共振",
  "主应力",
  "莫尔圆",
  "屈服",
  "疲劳",
  "安全系数",
  "边界条件",
  "初始条件",
  "自由度",
  "刚体",
  "质点",
  "质心",
  "转动惯量",
];

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "you",
  "are",
  "can",
  "was",
  "were",
  "into",
  "where",
  "when",
  "which",
  "chapter",
  "slide",
  "taofm",
  "mm",
  "cm",
  "mpa",
  "gpa",
  "kn",
  "dx",
  "al",
  "ax",
  "fl",
  "fn",
  "max",
  "min",
  "sin",
  "cos",
  "tan",
  "tg",
  "ab",
  "ac",
  "ae",
  "bc",
  "bd",
  "cd",
  "ce",
  "oa",
  "ob",
]);

const GENERIC_KEYWORDS = new Set(["力", "功"]);

const LATIN_KEYWORD_ALLOW = new Set([
  "axial",
  "bending",
  "delta",
  "epsilon",
  "euler",
  "hooke",
  "mmax",
  "modulus",
  "moment",
  "omega",
  "pcr",
  "sigma",
  "strain",
  "stress",
  "tau",
  "torsion",
]);

const SYMBOL_FONT_MAP = {
  A: "Α",
  B: "Β",
  C: "Χ",
  D: "Δ",
  E: "Ε",
  F: "Φ",
  G: "Γ",
  H: "Η",
  I: "Ι",
  J: "ϑ",
  K: "Κ",
  L: "Λ",
  M: "Μ",
  N: "Ν",
  O: "Ο",
  P: "Π",
  Q: "Θ",
  R: "Ρ",
  S: "Σ",
  T: "Τ",
  U: "Υ",
  V: "ς",
  W: "Ω",
  X: "Ξ",
  Y: "Ψ",
  Z: "Ζ",
  a: "α",
  b: "β",
  c: "χ",
  d: "δ",
  e: "ε",
  f: "φ",
  g: "γ",
  h: "η",
  i: "ι",
  j: "ϕ",
  k: "κ",
  l: "λ",
  m: "μ",
  n: "ν",
  o: "ο",
  p: "π",
  q: "θ",
  r: "ρ",
  s: "σ",
  t: "τ",
  u: "υ",
  v: "ϖ",
  w: "ω",
  x: "ξ",
  y: "ψ",
  z: "ζ",
  "\u002B": "+",
  "\u002D": "-",
  "\u002F": "/",
  "\u003D": "=",
  "\u0040": "≅",
  "\u0060": "′",
  "\u007E": "∼",
  "\u00A2": "′",
  "\u00A3": "≤",
  "\u00A5": "∞",
  "\u00AC": "←",
  "\u00AE": "→",
  "\u00AF": "↔",
  "\u00B3": "≥",
  "\u00B4": "×",
  "\u00B6": "∂",
  "\u00B9": "≠",
  "\u00BB": "≈",
  "\u00C5": "⊕",
  "\u00C6": "∅",
  "\u00D6": "√",
  "\u00D7": "·",
  "\u00D8": "¬",
  "\u00E0": "⋄",
  "\u00E1": "〈",
  "\u00E2": "®",
  "\u00E3": "©",
  "\u00E4": "™",
  "\u00E5": "∑",
  "\u00E6": "⎛",
  "\u00E7": "⎜",
  "\u00E8": "⎝",
  "\u00E9": "⎡",
  "\u00EA": "⎢",
  "\u00EB": "⎣",
  "\u00EC": "⎧",
  "\u00ED": "⎨",
  "\u00EE": "⎩",
  "\u00EF": "⎪",
  "\u00F1": "〉",
  "\u00F2": "∫",
  "\u00F3": "⌠",
  "\u00F4": "⎮",
  "\u00F5": "⌡",
  "\u00F6": "⎞",
  "\u00F7": "⎟",
  "\u00F8": "⎠",
  "\u00F9": "⎤",
  "\u00FA": "⎥",
  "\u00FB": "⎦",
  "\u00FC": "⎫",
  "\u00FD": "⎬",
  "\u00FE": "⎭",
};

const TOPIC_DEFINITIONS = [
  {
    id: "axial",
    title: "轴向拉伸与压缩",
    icon: "arrow-up-down",
    tone: "teal",
    minScore: 2,
    pattern: /轴向|拉压|拉伸|压缩|轴力|正应力|胡克|伸长|变形|弹性模量|泊松比|横向变形/,
    concepts: ["轴力 F_N", "正应力 σ", "线应变 ε", "伸长量 Δl", "弹性模量 E", "泊松比 μ"],
    formulas: ["\\sigma = \\frac{F_N}{A}", "\\varepsilon = \\frac{\\Delta l}{l}", "\\sigma = E\\varepsilon", "\\Delta l = \\int \\frac{F_N(x)}{E(x)A(x)}\\,dx"],
    checks: ["分段杆按各段 F_N、E、A 分别计算", "变内力或变截面杆优先写积分式", "自重问题要先建立 F_N(x)"],
  },
  {
    id: "material",
    title: "材料力学性能",
    icon: "chart-line",
    tone: "rose",
    minScore: 2,
    pattern: /材料的力学性能|拉伸图|应力应变|σ\s*-\s*ε|比例极限|弹性极限|屈服|强化|颈缩|塑性|低碳钢|断面收缩率|伸长率|冷作硬化/,
    concepts: ["应力-应变曲线", "弹性阶段", "屈服阶段", "强化阶段", "颈缩阶段", "塑性指标"],
    formulas: ["\\sigma = \\frac{F}{A}", "\\varepsilon = \\frac{\\Delta l}{l}", "\\delta = \\frac{l_1-l}{l}\\times 100\\%", "\\psi = \\frac{A-A_1}{A}\\times 100\\%"],
    checks: ["区分比例极限、弹性极限、屈服极限和强度极限", "塑性材料常以屈服作为强度失效标志", "卸载后总应变要拆成弹性应变和塑性应变"],
  },
  {
    id: "bending",
    title: "梁弯曲与截面应力",
    icon: "waves",
    tone: "blue",
    minScore: 3,
    pattern: /梁|弯矩|剪力|弯曲|挠度|转角|惯性矩|中性轴|剪力图|弯矩图/,
    concepts: ["剪力 Q", "弯矩 M", "截面惯性矩 I", "中性轴", "弯曲正应力", "挠度与转角"],
    formulas: ["\\sigma = \\frac{M y}{I}", "\\tau = \\frac{Q S^*}{I b}", "\\frac{d^2 w}{dx^2} = \\frac{M(x)}{E I}", "M_{\\max} = \\frac{P L}{4}"],
    checks: ["先定支座反力，再画剪力图和弯矩图", "最大正应力出现在 |M| 最大且 |y| 最大处", "挠度题要写边界条件和连续条件"],
  },
  {
    id: "torsion",
    title: "圆轴扭转",
    icon: "rotate-3d",
    tone: "amber",
    minScore: 2,
    pattern: /扭矩|扭转|圆轴|极惯性矩|剪应力|扭转角|切应力|剪切模量/,
    concepts: ["扭矩 T", "极惯性矩 J", "剪应力 τ", "扭转角 φ", "剪切模量 G"],
    formulas: ["\\tau = \\frac{T r}{J}", "\\tau_{\\max} = \\frac{T R}{J}", "\\varphi = \\frac{T L}{G J}", "J_p = \\frac{\\pi d^4}{32}"],
    checks: ["最大剪应力在外表面", "阶梯轴要分段叠加扭转角", "强度条件和刚度条件要分别校核"],
  },
  {
    id: "stress",
    title: "应力状态与强度理论",
    icon: "circle-dot",
    tone: "violet",
    minScore: 2,
    pattern: /主应力|莫尔圆|平面应力|强度理论|第三强度|第四强度|应力状态|切应力|剪应力/,
    concepts: ["平面应力", "主应力 σ_1, σ_2", "最大剪应力", "莫尔圆", "强度理论"],
    formulas: ["\\sigma_{1,2} = \\frac{\\sigma_x+\\sigma_y}{2} \\pm \\sqrt{\\left(\\frac{\\sigma_x-\\sigma_y}{2}\\right)^2 + \\tau_{xy}^2}", "\\tau_{\\max} = \\sqrt{\\left(\\frac{\\sigma_x-\\sigma_y}{2}\\right)^2 + \\tau_{xy}^2}", "\\sigma_{eq} \\le [\\sigma]"],
    checks: ["先明确应力分量正负号", "主平面上剪应力为零", "强度理论要与材料类型和失效形式匹配"],
  },
  {
    id: "stability",
    title: "压杆稳定",
    icon: "columns-3",
    tone: "green",
    minScore: 2,
    pattern: /细长压杆|压杆稳定|稳定|屈曲|欧拉|临界载荷|柔度|长度系数|计算长度/,
    concepts: ["细长压杆", "临界载荷 P_cr", "计算长度 l_0", "柔度", "稳定安全系数"],
    formulas: ["P_{cr} = \\frac{\\pi^2 E I}{l_0^2}", "\\sigma_{cr} = \\frac{P_{cr}}{A}", "l_0 = \\mu l"],
    checks: ["先判断是否满足欧拉公式适用范围", "端部约束决定长度系数", "稳定问题不能只做强度校核"],
  },
  {
    id: "dynamics",
    title: "动力学与振动",
    icon: "activity",
    tone: "slate",
    minScore: 2,
    pattern: /动力学|动量|动能|达朗贝尔|振动|固有频率|阻尼|共振|弹簧|自由度/,
    concepts: ["动量定理", "动能定理", "达朗贝尔原理", "单自由度振动", "固有频率"],
    formulas: ["m\\ddot{x} + kx = 0", "\\omega_n = \\sqrt{\\frac{k}{m}}", "f_n = \\frac{\\omega_n}{2\\pi}", "T_1 + W = T_2"],
    checks: ["先选广义坐标和正方向", "区分圆频率 ω 与频率 f", "有阻尼时不要套无阻尼结论"],
  },
];

let pdfjsPromise;

class TextOnlyDOMMatrix {
  constructor(init) {
    const values = Array.isArray(init) && init.length >= 6 ? init : [1, 0, 0, 1, 0, 0];
    this.a = Number(values[0] ?? 1);
    this.b = Number(values[1] ?? 0);
    this.c = Number(values[2] ?? 0);
    this.d = Number(values[3] ?? 1);
    this.e = Number(values[4] ?? 0);
    this.f = Number(values[5] ?? 0);
    this.is2D = true;
    this.isIdentity = this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
  }

  multiply(other) {
    const matrix = other || new TextOnlyDOMMatrix();
    return new TextOnlyDOMMatrix([
      this.a * matrix.a + this.c * matrix.b,
      this.b * matrix.a + this.d * matrix.b,
      this.a * matrix.c + this.c * matrix.d,
      this.b * matrix.c + this.d * matrix.d,
      this.a * matrix.e + this.c * matrix.f + this.e,
      this.b * matrix.e + this.d * matrix.f + this.f,
    ]);
  }

  multiplySelf(other) {
    const result = this.multiply(other);
    Object.assign(this, result);
    return this;
  }

  preMultiplySelf(other) {
    const result = new TextOnlyDOMMatrix(other).multiply(this);
    Object.assign(this, result);
    return this;
  }

  translate(tx = 0, ty = 0) {
    return this.multiply(new TextOnlyDOMMatrix([1, 0, 0, 1, tx, ty]));
  }

  translateSelf(tx = 0, ty = 0) {
    return this.multiplySelf(new TextOnlyDOMMatrix([1, 0, 0, 1, tx, ty]));
  }

  scale(scaleX = 1, scaleY = scaleX) {
    return this.multiply(new TextOnlyDOMMatrix([scaleX, 0, 0, scaleY, 0, 0]));
  }

  scaleSelf(scaleX = 1, scaleY = scaleX) {
    return this.multiplySelf(new TextOnlyDOMMatrix([scaleX, 0, 0, scaleY, 0, 0]));
  }

  transformPoint(point = {}) {
    const x = Number(point.x || 0);
    const y = Number(point.y || 0);
    return {
      x: this.a * x + this.c * y + this.e,
      y: this.b * x + this.d * y + this.f,
      z: Number(point.z || 0),
      w: Number(point.w || 1),
    };
  }
}

class TextOnlyImageData {
  constructor(dataOrWidth, width, height) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth;
      this.height = Number(width || 0);
      this.data = new Uint8ClampedArray(Math.max(0, this.width * this.height * 4));
    } else {
      this.data = dataOrWidth || new Uint8ClampedArray(0);
      this.width = Number(width || 0);
      this.height = Number(height || 0);
    }
  }
}

class TextOnlyPath2D {}

const TEXT_ONLY_CANVAS_MODULE = {
  DOMMatrix: TextOnlyDOMMatrix,
  ImageData: TextOnlyImageData,
  Path2D: TextOnlyPath2D,
  createCanvas() {
    throw new Error("当前 PDF 解析只抽取文本，不启用原生 Canvas 渲染。");
  },
};

class TextOnlyCanvasFactory {
  create() {
    throw new Error("当前 PDF 解析只抽取文本，不启用原生 Canvas 渲染。");
  }

  reset() {}

  destroy() {}
}

function ensurePdfTextExtractionGlobals() {
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = TextOnlyDOMMatrix;
  if (!globalThis.ImageData) globalThis.ImageData = TextOnlyImageData;
  if (!globalThis.Path2D) globalThis.Path2D = TextOnlyPath2D;
  if (!globalThis.navigator?.language) {
    globalThis.navigator = {
      language: "zh-CN",
      platform: process.platform,
      userAgent: "mechanics-review-studio",
    };
  }
}

async function importPdfJsTextOnly(pdfPath) {
  ensurePdfTextExtractionGlobals();
  const originalGetBuiltinModule = process.getBuiltinModule;
  if (typeof originalGetBuiltinModule !== "function") {
    return import(pathToFileURL(pdfPath).href);
  }

  process.getBuiltinModule = function getBuiltinModuleWithoutNativeCanvas(moduleName) {
    const builtin = originalGetBuiltinModule.call(process, moduleName);
    if (moduleName !== "module" || !builtin?.createRequire) return builtin;
    return {
      ...builtin,
      createRequire(...args) {
        const realRequire = builtin.createRequire(...args);
        function guardedRequire(request) {
          if (request === "@napi-rs/canvas") {
            return TEXT_ONLY_CANVAS_MODULE;
          }
          return realRequire(request);
        }
        Object.defineProperty(guardedRequire, "resolve", {
          value: realRequire.resolve.bind(realRequire),
        });
        return guardedRequire;
      },
    };
  };

  try {
    return await import(pathToFileURL(pdfPath).href);
  } finally {
    process.getBuiltinModule = originalGetBuiltinModule;
  }
}

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function stableReviewId(parts) {
  return `review_${crypto.createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 12)}`;
}

function courseKnowledgeModel(course, docs) {
  return buildCourseKnowledgeModel(course, docs);
}

function localStructuredSummary(courseModel, mindMap) {
  const stats = courseModel.stats || {};
  const index = buildCourseModelIndex(courseModel);
  const coreConcepts = selectSummaryConcepts(courseModel, 12, index);
  const focusBlocks = buildSummaryFocusBlocks(courseModel, coreConcepts, index);
  const pptKnowledgeSummary = buildPptKnowledgeSummary(courseModel, coreConcepts, index);
  const chapters = (courseModel.chapters || [])
    .slice(0, 8)
    .map((chapter) => {
      const chapterId = chapter.chapter_id;
      const concepts = chapterItems(index.conceptsByChapter, chapterId)
        .map((concept) => concept.name)
        .slice(0, 5);
      const formulas = chapterItems(index.formulasByChapter, chapterId)
        .map((formula) => wrapInlineFormula(formula.expression) || formula.expression)
        .slice(0, 3);
      const mistakes = chapterItems(index.mistakesByChapter, chapterId)
        .map((mistake) => mistake.description)
        .slice(0, 2);
      const displayTitle = summaryChapterTitle(chapter, {
        concepts,
        formulas,
        problems: chapterItems(index.problemsByChapter, chapterId).map((problem) => problem.title),
      });
      return `- ${displayTitle}（${chapter.difficulty} / ${chapter.exam_focus?.level || "low"}）\n  - 概念：${concepts.join("、") || "unknown"}\n  - 公式：${formulas.join("；") || "unknown"}\n  - 易错：${mistakes.join("；") || "unknown"}`;
    })
    .join("\n");
  const formulas = (courseModel.formulas || [])
    .slice(0, 10)
    .map((formula) => `- ${formula.name}：${wrapInlineFormula(formula.expression) || formula.expression}；条件：${formula.applicable_conditions || "unknown"}`)
    .join("\n");
  const examples = index.problems
    .slice(0, 8)
    .map((item) => {
      const ref = item.source_refs?.[0] || {};
      return `- ${item.title}：${ref.file_name || "unknown"} / ${sourceRefDisplayLabel(ref)}`;
    })
    .join("\n");
  const mistakes = (courseModel.mistake_points || [])
    .slice(0, 8)
    .map((mistake) => `- ${mistake.description}`)
    .join("\n");

  return `# ${courseModel.course?.name || "当前科目"} 期末复习提纲

## 解析质量
- 资料：${stats.documents || 0} 份
- 章节：${stats.chapters || 0} 个
- 概念：${stats.concepts || 0} 个
- 公式：${stats.formulas || 0} 条
- 例题：${stats.examples || 0} 个
- 作业题：${stats.homework_problems || 0} 道
- 易错点：${stats.mistake_points || 0} 个
- 图谱：${mindMap?.stats?.nodes || 0} 个节点 / ${mindMap?.stats?.edges || 0} 条边

## 核心考点筛选
${coreConcepts.length ? coreConcepts.map(formatSummaryConcept).join("\n") : "- 暂未筛出有足够证据支撑的核心考点。"}

## PPT/资料总结
${focusBlocks || "- 当前资料更适合先按章节通读，再补充公式和题目证据。"}

## PPT知识点总结
${pptKnowledgeSummary || "- 暂未从 PPT 中识别出足够清晰的知识点，请检查课件是否包含可复制文本。"}

## 章节框架
${chapters || "- 暂未识别到清晰章节。"}

## 公式与适用条件
${formulas || "- 暂未识别到明确公式。"}

## 例题与作业来源
${examples || "- 暂未识别到例题或作业题。"}

## 高频易错点
${mistakes || "- 暂未识别到明确易错点。"}

## 使用建议
- 先按章节卡片复述概念和公式适用条件。
- 对每条公式至少完成一道计算题和一道适用条件判断题。
- 对每个易错点做一题错误诊断，并写出防错检查清单。`;
}

function buildCourseModelIndex(courseModel = {}) {
  const problems = [...(courseModel.examples || []), ...(courseModel.homework_problems || [])];
  return {
    concepts: courseModel.concepts || [],
    formulas: courseModel.formulas || [],
    problems,
    mistakes: courseModel.mistake_points || [],
    conceptsByChapter: groupByKey(courseModel.concepts || [], (item) => item.chapter_id),
    formulasByChapter: groupByKey(courseModel.formulas || [], (item) => item.chapter_id),
    problemsByChapter: groupByKey(problems, (item) => item.chapter_id),
    mistakesByChapter: groupByKey(courseModel.mistake_points || [], (item) => item.chapter_id),
  };
}

function groupByKey(items = [], keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function pushTopByScore(items, item, limit, scoreFn) {
  const score = Number(scoreFn(item) || 0);
  let index = 0;
  while (index < items.length && Number(scoreFn(items[index]) || 0) >= score) index += 1;
  if (index < limit) items.splice(index, 0, item);
  if (items.length > limit) items.length = limit;
}

function chapterItems(groups, chapterId) {
  return groups?.get(chapterId) || [];
}

function summaryScoredConcepts(courseModel, index = buildCourseModelIndex(courseModel)) {
  if (!index.scoredConcepts) {
    index.scoredConcepts = index.concepts.map((concept) => ({
      ...concept,
      summary_score: summaryConceptScore(concept, courseModel, index),
    }));
  }
  return index.scoredConcepts;
}

function summaryScoredConceptsByChapter(courseModel, index = buildCourseModelIndex(courseModel)) {
  if (!index.scoredConceptsByChapter) {
    index.scoredConceptsByChapter = groupByKey(summaryScoredConcepts(courseModel, index), (concept) => concept.chapter_id);
    for (const concepts of index.scoredConceptsByChapter.values()) {
      concepts.sort((a, b) => Number(b.summary_score || 0) - Number(a.summary_score || 0));
    }
  }
  return index.scoredConceptsByChapter;
}

function buildPptKnowledgeSummary(courseModel, coreConcepts = [], index = buildCourseModelIndex(courseModel)) {
  const coreNames = new Set(coreConcepts.map((concept) => concept.name));
  const conceptsByChapter = summaryScoredConceptsByChapter(courseModel, index);
  return (courseModel.chapters || [])
    .map((chapter) => {
      const chapterConcepts = chapterItems(conceptsByChapter, chapter.chapter_id);
      const selectedConcepts = chapterConcepts
        .filter((concept) => coreNames.has(concept.name) || concept.candidate_confidence === "high" || Number(concept.summary_score || 0) >= 150)
        .slice(0, 4);
      const formulas = chapterItems(index.formulasByChapter, chapter.chapter_id).slice(0, 3);
      const problems = chapterItems(index.problemsByChapter, chapter.chapter_id).slice(0, 2);
      const mistakes = chapterItems(index.mistakesByChapter, chapter.chapter_id)
        .slice()
        .sort((a, b) => Number(b.selection_score || 0) - Number(a.selection_score || 0))
        .slice(0, 2);
      if (!selectedConcepts.length && !formulas.length && !problems.length && !mistakes.length) return "";
      const title = summaryChapterTitle(chapter, {
        concepts: selectedConcepts.map((concept) => concept.name),
        formulas: formulas.map((formula) => formula.name || formula.expression),
        problems: problems.map((problem) => problem.title),
      });
      const conceptLine = selectedConcepts.length
        ? selectedConcepts.map((concept) => `${concept.name}：${markdownInlineFormulas(clampText(concept.description || concept.source_refs?.[0]?.excerpt || "复述定义、适用条件和典型题入口。", 72))}`).join("；")
        : "先按公式/题型反推本节知识点";
      const formulaLine = formulas.length
        ? formulas.map((formula) => `${formula.name} ${wrapInlineFormula(formula.expression) || formula.expression}`).join("；")
        : "暂无明确公式";
      const problemLine = problems.length ? problems.map((problem) => problem.title).join("；") : "用概念判断题型入口";
      const mistakeLine = mistakes.length ? mistakes.map((mistake) => mistake.description).join("；") : "检查适用条件、正负号和单位";
      return `- ${title}\n  - 知识点：${conceptLine}\n  - 公式/方法：${formulaLine}\n  - 题型入口：${problemLine}\n  - 防错检查：${mistakeLine}`;
    })
    .filter(Boolean)
    .slice(0, 10)
    .join("\n");
}

function selectSummaryConcepts(courseModel, limit = 12, index = buildCourseModelIndex(courseModel)) {
  return summaryScoredConcepts(courseModel, index)
    .filter((concept) => concept.summary_score >= 120 || concept.candidate_confidence === "high")
    .sort((a, b) => b.summary_score - a.summary_score || String(a.name).localeCompare(String(b.name), "zh-Hans-CN"))
    .slice(0, limit);
}

function summaryConceptScore(concept, courseModel, index = buildCourseModelIndex(courseModel)) {
  const chapterId = concept.chapter_id;
  const relatedFormulaCount = chapterItems(index.formulasByChapter, chapterId).filter((formula) => relatedTextMatch(concept.name, formula.name, formula.expression)).length;
  const relatedProblemCount = chapterItems(index.problemsByChapter, chapterId).filter(
    (problem) => (problem.related_concepts || []).includes(concept.name) || relatedTextMatch(concept.name, problem.title, problem.problem_text),
  ).length;
  const relatedMistakeCount = chapterItems(index.mistakesByChapter, chapterId).filter(
    (mistake) => (mistake.related_concepts || []).includes(concept.name) || relatedTextMatch(concept.name, mistake.description),
  ).length;
  return (
    Number(concept.importance_score || 0) +
    Number(concept.selection_score || 0) * 0.8 +
    relatedFormulaCount * 28 +
    relatedProblemCount * 30 +
    relatedMistakeCount * 24 +
    (concept.description && concept.description !== "unknown" ? 12 : 0)
  );
}

function relatedTextMatch(term, ...values) {
  const name = cleanStudyText(term);
  const source = values.map(cleanStudyText).join("\n");
  if (!name || !source) return false;
  if (source.includes(name)) return true;
  if (name.includes("应力") && /\\sigma|σ|应力/.test(source)) return true;
  if (name.includes("轴力") && /F_N|F_\{N\}|轴力/.test(source)) return true;
  if (name.includes("扭转") && /扭矩|\\tau|τ|GJ|极惯性矩/.test(source)) return true;
  if (name.includes("弯曲") && /弯矩|剪力|\\frac\{M y\}\{I\}|My\/I/.test(source)) return true;
  return false;
}

function formatSummaryConcept(concept) {
  const reasons = summarySelectionReasons(concept);
  const evidence = cleanStudyText(concept.source_refs?.[0]?.excerpt || concept.description || "");
  return `- ${concept.name}（${concept.profile_label || "课程考点"}，评分 ${Number(concept.summary_score || concept.importance_score || 0)}）\n  - 筛选依据：${reasons.join("；") || "资料中有明确概念证据"}\n  - 复习入口：${markdownInlineFormulas(clampText(evidence || concept.description || "复述定义、适用条件和典型题入口。", 120))}`;
}

function summarySelectionReasons(concept) {
  const counts = concept.evidence_counts || {};
  return uniqueStrings([
    counts.title_hits ? "章节标题命中" : "",
    counts.definition_sentences ? "有定义/条件句" : "",
    counts.formulas_near || counts.formula_lines ? "邻近公式" : "",
    counts.problem_anchors ? "关联例题/作业" : "",
    counts.mistakes ? "关联易错提示" : "",
    ...(concept.detection_reasons || []).slice(0, 2),
  ]).slice(0, 4);
}

function buildSummaryFocusBlocks(courseModel, coreConcepts, index = buildCourseModelIndex(courseModel)) {
  const conceptNames = new Set(coreConcepts.map((concept) => concept.name));
  const conceptsByChapter = summaryScoredConceptsByChapter(courseModel, index);
  return (courseModel.chapters || [])
    .map((chapter) => {
      const concepts = chapterItems(conceptsByChapter, chapter.chapter_id).filter((concept) => conceptNames.has(concept.name));
      const formulas = chapterItems(index.formulasByChapter, chapter.chapter_id).slice(0, 3);
      const problems = chapterItems(index.problemsByChapter, chapter.chapter_id).slice(0, 2);
      const mistakes = chapterItems(index.mistakesByChapter, chapter.chapter_id).slice(0, 2);
      const signalCount = concepts.length + formulas.length + problems.length + mistakes.length;
      if (!signalCount) return "";
      const displayTitle = summaryChapterTitle(chapter, {
        concepts: concepts.map((item) => item.name),
        formulas: formulas.map((item) => item.name || item.expression),
        problems: problems.map((item) => item.title),
      });
      return `- ${displayTitle}\n  - 本节抓手：${concepts.map((item) => item.name).join("、") || "先按公式/题型定位"}\n  - 公式/方法：${formulas.map((item) => wrapInlineFormula(item.expression) || item.expression).join("；") || "暂无明确公式"}\n  - 题型入口：${problems.map((item) => item.title).join("；") || "按概念判断题型"}\n  - 防错检查：${mistakes.map((item) => item.description).join("；") || "检查适用条件、正负号和单位"}`;
    })
    .filter(Boolean)
    .slice(0, 8)
    .join("\n");
}

function summaryChapterTitle(chapter = {}, related = {}) {
  const title = cleanStudyText(chapter.title || "");
  if (title && !isWeakChapterTitle(title)) return title;
  const conceptTitle = uniqueStrings(related.concepts || []).slice(0, 2).join(" / ");
  if (conceptTitle) return `考点：${conceptTitle}`;
  const formulaTitle = uniqueStrings(related.formulas || []).slice(0, 1)[0];
  if (formulaTitle) return `公式：${formulaTitle}`;
  const problemTitle = uniqueStrings(related.problems || []).slice(0, 1)[0];
  if (problemTitle) return `题型：${problemTitle}`;
  return "资料片段";
}

function isWeakChapterTitle(title) {
  return (
    !title ||
    /^unknown$/i.test(title) ||
    /^第\s*\d+\s*页$/u.test(title) ||
    /^(?:page|slide)\s*\d+$/iu.test(title) ||
    /^全文$/u.test(title) ||
    /^(?:作业题|思考题|例题|题目|问题|练习|计算题|选择题|填空题|简答题|判断题)(?:\s*\d+)?$/u.test(title)
  );
}

async function readBody(req, maxBytes = 120 * 1024 * 1024) {
  try {
    return await serverHttp.readBody(req, maxBytes);
  } catch (error) {
    if (error.message === "请求体过大。") {
      throw new Error("上传内容过大，当前基础版单次最多约 120MB。");
    }
    throw error;
  }
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!match) throw new Error("缺少 multipart boundary。");
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const parts = [];
  let cursor = buffer.indexOf(boundary);

  while (cursor !== -1) {
    cursor += boundary.length;
    if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) break;
    if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) cursor += 2;

    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) break;
    const rawHeaders = buffer.slice(cursor, headerEnd).toString("utf8");
    const nextBoundary = buffer.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) break;
    let dataEnd = nextBoundary;
    if (buffer[dataEnd - 2] === 13 && buffer[dataEnd - 1] === 10) dataEnd -= 2;
    const data = buffer.slice(headerEnd + 4, dataEnd);

    const disposition = /content-disposition:\s*([^\r\n]+)/i.exec(rawHeaders)?.[1] || "";
    const name = /name="([^"]+)"/i.exec(disposition)?.[1] || "";
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] || "";
    const type = /content-type:\s*([^\r\n]+)/i.exec(rawHeaders)?.[1] || "application/octet-stream";
    if (name) parts.push({ name, filename, type, data });
    cursor = nextBoundary;
  }

  const fields = {};
  const files = [];
  for (const part of parts) {
    if (part.filename) files.push(part);
    else fields[part.name] = part.data.toString("utf8");
  }
  return { fields, files };
}

function safeFileName(name) {
  const ext = path.extname(name || "").toLowerCase();
  const base = path.basename(name || "upload", ext);
  const cleaned = base
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${cleaned || "upload"}${ext}`;
}

function decodeXml(value) {
  return value
    .replace(/_x000D_/g, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeExtractedSymbols(value) {
  return String(value || "").replace(/[\uF000-\uF0FF]/g, (char) => {
    const symbolChar = String.fromCharCode(char.charCodeAt(0) - 0xf000);
    return SYMBOL_FONT_MAP[symbolChar] || char;
  });
}

function decodeSymbolFontText(value) {
  return [...String(value || "")].map((char) => SYMBOL_FONT_MAP[char] || char).join("");
}

function normalizeText(value) {
  return normalizeExtractedSymbols(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactInlineText(value) {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

function isPlainTextUnitHeading(line) {
  const text = compactInlineText(line).replace(/^#{1,6}\s*/, "");
  if (!text) return false;
  if (
    /^(?:例\s*题|题\s*目|习\s*题|练\s*习|作\s*业|思\s*考\s*题|问题)\s*(?:[一二三四五六七八九十百]+|\d+)?(?:\s*[：:、.．)）-]\s*.*)?$/u.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /^(?:计算题|选择题|填空题|简答题|判断题)\s*(?:[一二三四五六七八九十百]+|\d+)?(?:\s*[：:、.．)）-]\s*.*)?$/u.test(text)
  ) {
    return true;
  }
  return /^(?:\d{1,2}|[一二三四五六七八九十]{1,3})[、.．)）]\s*(?:已知|求|试|证明|计算|选择|判断|图示|如图|设|问)/u.test(
    text,
  );
}

function plainTextUnitLabel(firstLine, index) {
  const text = compactInlineText(firstLine).replace(/^#{1,6}\s*/, "");
  const marker = text.match(
    /^(例\s*题|题\s*目|习\s*题|练\s*习|作\s*业|思\s*考\s*题|问题|计算题|选择题|填空题|简答题|判断题)\s*([一二三四五六七八九十百]+|\d+)?/u,
  );
  if (marker) {
    return `${marker[1].replace(/\s+/g, "")} ${marker[2] || index + 1}`;
  }
  const numbered = text.match(/^(\d{1,2}|[一二三四五六七八九十]{1,3})[、.．)）]/u);
  if (numbered) return `题目 ${numbered[1]}`;
  return `题目 ${index + 1}`;
}

function looksLikeExerciseText(value) {
  const text = compactInlineText(value);
  return (
    /例\s*题|题\s*目|习\s*题|练\s*习|作\s*业|思\s*考\s*题|问题|计算题|选择题|填空题|简答题|判断题/u.test(text) ||
    /已知|求|证明|计算|选择|判断|图示|如图|试求|问|答案|解析/u.test(text)
  );
}

function splitPlainTextIntoUnits(textValue, fallbackLabel = "全文") {
  const text = normalizeText(textValue);
  if (!text) return [];

  const chunks = [];
  let current = [];
  let sawHeading = false;
  for (const line of text.split(/\n/)) {
    const startsUnit = isPlainTextUnitHeading(line);
    if (startsUnit) sawHeading = true;
    if (startsUnit && current.some((item) => item.trim())) {
      chunks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.some((item) => item.trim())) chunks.push(current);

  if (sawHeading && chunks.length) {
    return chunks.map((chunk, index) => {
      const textBlock = normalizeText(chunk.join("\n"));
      const firstLine = chunk.find((line) => line.trim()) || "";
      return { label: plainTextUnitLabel(firstLine, index), text: textBlock };
    });
  }

  const paragraphs = text.split(/\n\s*\n/).map(normalizeText).filter(Boolean);
  const exerciseParagraphCount = paragraphs.filter(looksLikeExerciseText).length;
  if (paragraphs.length > 1 && exerciseParagraphCount >= Math.ceil(paragraphs.length / 2)) {
    return paragraphs.map((paragraph, index) => ({
      label: plainTextUnitLabel(paragraph.split(/\n/)[0] || paragraph, index),
      text: paragraph,
    }));
  }

  return [{ label: fallbackLabel, text }];
}

function normalizeTextDocumentName(name) {
  const originalName = String(name || "").trim() || "纯文字例题.txt";
  return path.extname(originalName) ? originalName : `${originalName}.txt`;
}

function isPlainTextDocument(doc) {
  const type = String(doc?.type || "").toLowerCase();
  const mimeType = String(doc?.mimeType || "").toLowerCase();
  return doc?.importKind === "text-example" || type === "txt" || type === "md" || mimeType.startsWith("text/");
}

function xmlLocalName(name = "") {
  return name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
}

function xmlPrefix(name = "") {
  return name.includes(":") ? name.slice(0, name.indexOf(":")) : "";
}

function xmlChildren(node, localName) {
  const children = Array.isArray(node?.elements) ? node.elements : [];
  return localName ? children.filter((child) => child.type === "element" && xmlLocalName(child.name) === localName) : children;
}

function firstXmlChild(node, localName) {
  return xmlChildren(node, localName)[0];
}

function xmlAttribute(node, localName) {
  const attributes = node?.attributes || {};
  return attributes[localName] ?? attributes[`m:${localName}`] ?? attributes[`a:${localName}`] ?? attributes[`w:${localName}`];
}

function xmlTextContent(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "cdata") return node.cdata || "";
  return xmlChildren(node).map(xmlTextContent).join("");
}

function directTextContent(node) {
  return xmlChildren(node)
    .filter((child) => child.type === "text" || child.type === "cdata")
    .map(xmlTextContent)
    .join("");
}

function joinTextParts(parts) {
  return parts
    .map((part) => normalizeExtractedSymbols(part))
    .map((part) => part.replace(/[ \t\r\n]+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;:!?，。；：！？、])/g, "$1")
    .replace(/([([{（【])\s+/g, "$1")
    .replace(/\s+([)\]}）】])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function findXmlElements(node, predicate, found = []) {
  if (!node) return found;
  if (node.type === "element" && predicate(node)) found.push(node);
  for (const child of xmlChildren(node)) findXmlElements(child, predicate, found);
  return found;
}

function containsMath(node) {
  return findXmlElements(
    node,
    (item) => xmlPrefix(item.name) === "m" || xmlLocalName(item.name) === "oMath" || xmlLocalName(item.name) === "oMathPara",
    [],
  ).length > 0;
}

function parseXmlDocument(xml) {
  const xmljs = runtimeRequire("xml-js");
  return xmljs.xml2js(xml, {
    compact: false,
    ignoreComment: true,
    ignoreDeclaration: true,
    ignoreInstruction: true,
    trim: false,
  });
}

function isPropertyNode(node) {
  const localName = xmlLocalName(node?.name);
  return localName === "rPr" || localName === "ctrlPr" || localName.endsWith("Pr");
}

function runUsesSymbolFont(runNode) {
  const rPr = firstXmlChild(runNode, "rPr");
  if (!rPr) return false;
  const fontNodes = findXmlElements(
    rPr,
    (node) => ["latin", "cs", "ea", "sym"].includes(xmlLocalName(node.name)),
    [],
  );
  return fontNodes.some((node) => /(^|[\s_-])symbol($|[\s_-])/i.test(String(xmlAttribute(node, "typeface") || xmlAttribute(node, "font") || "")));
}

function extractDrawingRun(runNode) {
  const useSymbolFont = runUsesSymbolFont(runNode);
  const parts = [];
  for (const child of xmlChildren(runNode)) {
    const localName = xmlLocalName(child.name);
    if (localName === "t") {
      const textValue = directTextContent(child);
      parts.push(useSymbolFont ? decodeSymbolFontText(textValue) : normalizeExtractedSymbols(textValue));
    } else if (localName === "sym") {
      parts.push(extractSymbolElement(child));
    } else if (localName === "br") {
      parts.push("\n");
    } else if (xmlPrefix(child.name) === "m" || localName === "oMath" || localName === "oMathPara" || containsMath(child)) {
      parts.push(linearizeMath(child));
    }
  }
  return joinTextParts(parts);
}

function extractSymbolElement(node) {
  const raw = String(xmlAttribute(node, "char") || xmlAttribute(node, "fontChar") || "");
  if (!raw) return "";
  const code = Number.parseInt(raw.replace(/^U\+/i, ""), 16);
  if (!Number.isNaN(code)) {
    const char = String.fromCodePoint(code > 0xf000 && code <= 0xf0ff ? code - 0xf000 : code);
    return SYMBOL_FONT_MAP[char] || normalizeExtractedSymbols(String.fromCodePoint(code));
  }
  return normalizeExtractedSymbols(raw);
}

function extractSlideXmlText(xml) {
  let parsed;
  try {
    parsed = parseXmlDocument(xml);
  } catch {
    return extractSlideXmlTextFallback(xml);
  }

  const paragraphs = findXmlElements(
    parsed,
    (node) => xmlLocalName(node.name) === "p" && xmlPrefix(node.name) !== "m",
    [],
  );
  const lines = [];
  for (const paragraph of paragraphs) {
    const parts = [];
    for (const child of xmlChildren(paragraph)) {
      const localName = xmlLocalName(child.name);
      if (localName === "r" || localName === "fld") parts.push(extractDrawingRun(child));
      else if (localName === "br") parts.push("\n");
      else if (xmlPrefix(child.name) === "m" || localName === "oMath" || localName === "oMathPara" || containsMath(child)) {
        parts.push(linearizeMath(child));
      }
    }
    const line = joinTextParts(parts);
    if (line) lines.push(line);
  }

  if (lines.length) return normalizeText(lines.join("\n"));
  const mathParagraphs = findXmlElements(parsed, (node) => xmlLocalName(node.name) === "oMathPara", []);
  const standaloneMath = mathParagraphs.length
    ? mathParagraphs
    : findXmlElements(parsed, (node) => xmlLocalName(node.name) === "oMath", []);
  const formulas = standaloneMath.map(linearizeMath).filter(Boolean);
  if (formulas.length) return normalizeText(formulas.join("\n"));
  return extractSlideXmlTextFallback(xml);
}

function extractSlideXmlTextFallback(xml) {
  const texts = [];
  for (const match of xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)) {
    const decoded = decodeXml(match[1]);
    if (decoded) texts.push(decoded);
  }
  return normalizeText(texts.join("\n"));
}

function mathSlot(node, localName) {
  const child = firstXmlChild(node, localName);
  return child ? linearizeMath(child) : "";
}

function mathChr(node, fallback = "") {
  const directValue = node ? String(xmlAttribute(node, "val") || "") : "";
  const chr = directValue ? node : findXmlElements(node, (item) => xmlLocalName(item.name) === "chr", [])[0];
  const value = directValue || (chr ? String(xmlAttribute(chr, "val") || "") : "");
  if (!value) return fallback;
  const code = Number.parseInt(value.replace(/^U\+/i, ""), 16);
  if (!Number.isNaN(code) && value.length > 2) return normalizeExtractedSymbols(String.fromCodePoint(code));
  return normalizeExtractedSymbols(value);
}

function withSubSup(base, sub, sup) {
  const head = base || "";
  return `${head}${sub ? `_{${sub}}` : ""}${sup ? `^{${sup}}` : ""}`;
}

function linearizeMath(node) {
  if (!node) return "";
  if (node.type === "text" || node.type === "cdata") return normalizeExtractedSymbols(xmlTextContent(node));
  if (node.type !== "element") return "";

  const localName = xmlLocalName(node.name);
  if (isPropertyNode(node)) return "";

  switch (localName) {
    case "oMath":
    case "oMathPara":
      return toLatexFormula(joinTextParts(xmlChildren(node).map(linearizeMath)), { extract: false });
    case "e":
    case "num":
    case "den":
    case "sub":
    case "sup":
    case "deg":
    case "lim":
    case "fName":
      return joinTextParts(xmlChildren(node).map(linearizeMath));
    case "r":
      return joinTextParts(
        xmlChildren(node)
          .filter((child) => !isPropertyNode(child))
          .map(linearizeMath),
      );
    case "t":
      return normalizeExtractedSymbols(directTextContent(node));
    case "sym":
      return extractSymbolElement(node);
    case "sSub":
      return withSubSup(mathSlot(node, "e"), mathSlot(node, "sub"), "");
    case "sSup":
      return withSubSup(mathSlot(node, "e"), "", mathSlot(node, "sup"));
    case "sSubSup":
      return withSubSup(mathSlot(node, "e"), mathSlot(node, "sub"), mathSlot(node, "sup"));
    case "f": {
      const num = mathSlot(node, "num");
      const den = mathSlot(node, "den");
      return num && den ? latexFraction(num, den) : joinTextParts([num, den]);
    }
    case "rad": {
      const degree = mathSlot(node, "deg");
      const expression = mathSlot(node, "e");
      return degree ? `\\sqrt[${toLatexFormula(degree, { extract: false })}]{${toLatexFormula(expression, { extract: false })}}` : `\\sqrt{${toLatexFormula(expression, { extract: false })}}`;
    }
    case "nary": {
      const op = toLatexFormula(mathChr(firstXmlChild(node, "naryPr"), "∑"), { extract: false });
      return joinTextParts([withSubSup(op, mathSlot(node, "sub"), mathSlot(node, "sup")), mathSlot(node, "e")]);
    }
    case "limLow":
      return withSubSup(mathSlot(node, "e"), mathSlot(node, "lim"), "");
    case "limUpp":
      return withSubSup(mathSlot(node, "e"), "", mathSlot(node, "lim"));
    case "func":
      return joinTextParts([mathSlot(node, "fName"), `(${mathSlot(node, "e")})`]);
    case "acc": {
      const accent = mathChr(firstXmlChild(node, "accPr"), "");
      const expression = mathSlot(node, "e");
      if (accent === "¨") return `\\ddot{${toLatexFormula(expression, { extract: false })}}`;
      if (accent === "˙" || accent === ".") return `\\dot{${toLatexFormula(expression, { extract: false })}}`;
      return accent ? `${toLatexFormula(accent, { extract: false })}(${expression})` : expression;
    }
    case "bar":
      return `\\overline{${toLatexFormula(mathSlot(node, "e"), { extract: false })}}`;
    case "groupChr":
      return mathSlot(node, "e");
    case "d": {
      const properties = firstXmlChild(node, "dPr");
      const begin = mathChr(firstXmlChild(properties, "begChr"), "(");
      const end = mathChr(firstXmlChild(properties, "endChr"), ")");
      return `\\left${begin}${mathSlot(node, "e")}\\right${end}`;
    }
    case "eqArr":
      return xmlChildren(node, "e").map(linearizeMath).filter(Boolean).join("; ");
    case "m":
      if (xmlPrefix(node.name) !== "m") {
        return joinTextParts(
          xmlChildren(node)
            .filter((child) => !isPropertyNode(child))
            .map(linearizeMath),
        );
      }
      return `[${xmlChildren(node, "mr").map(linearizeMath).filter(Boolean).join("; ")}]`;
    case "mr":
      return xmlChildren(node, "e").map(linearizeMath).filter(Boolean).join(", ");
    default:
      return joinTextParts(
        xmlChildren(node)
          .filter((child) => !isPropertyNode(child))
          .map(linearizeMath),
      );
  }
}

async function extractPptx(buffer) {
  const JSZip = runtimeRequire("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = zip
    .file(/^ppt\/slides\/slide\d+\.xml$/)
    .sort((a, b) => slideNumber(a.name) - slideNumber(b.name));
  const notesBySlide = await extractPptxNotesBySlide(zip);
  const units = [];

  for (const file of slideFiles) {
    const xml = await file.async("text");
    const number = slideNumber(file.name);
    const altText = extractPptxAltText(xml);
    const notesText = notesBySlide.get(number) || "";
    const unitText = normalizeText(uniqueStrings([extractSlideXmlText(xml), altText, notesText]).join("\n"));
    if (unitText) {
      units.push({
        label: `第 ${number} 页`,
        text: unitText,
        lines: unitText.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 80),
        mathCount: (unitText.match(/\\(?:frac|sqrt|sigma|tau|Delta|int|sum)|[=≈≤≥∑Σ∫√σσετγθφωΩμνΔ]/g) || []).length,
        symbolCount: (unitText.match(/[σσετγθφωΩμνΔδψπρ∇Φ]/g) || []).length,
        hasNotes: Boolean(notesText),
        hasAltText: Boolean(altText),
      });
    }
  }

  return {
    text: normalizeText(units.map((unit) => `## ${unit.label}\n${unit.text}`).join("\n\n")),
    units,
    warning: units.length ? "" : "没有从 PPTX 中抽取到可读文本，可能主要是图片或扫描内容。",
  };
}

function slideNumber(name) {
  return Number(/slide(\d+)\.xml$/i.exec(name)?.[1] || 0);
}

async function extractPptxNotesBySlide(zip) {
  const notesByNumber = new Map();
  const noteFiles = zip.file(/^ppt\/notesSlides\/notesSlide\d+\.xml$/);
  await Promise.all(
    noteFiles.map(async (file) => {
      const number = Number(/notesSlide(\d+)\.xml$/i.exec(file.name)?.[1] || 0);
      const textValue = extractSlideXmlText(await file.async("text"));
      if (number && textValue) notesByNumber.set(number, textValue);
    }),
  );
  const relFiles = zip.file(/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/);
  const result = new Map();
  await Promise.all(
    relFiles.map(async (file) => {
      const number = slideNumber(file.name.replace(".rels", ""));
      const relXml = await file.async("text");
      const target = /Target="([^"]*notesSlide(\d+)\.xml)"/i.exec(relXml);
      const noteNumber = Number(target?.[2] || 0);
      const textValue = noteNumber ? notesByNumber.get(noteNumber) || "" : "";
      if (number && textValue) result.set(number, textValue);
    }),
  );
  return result;
}

function extractPptxAltText(xml) {
  const values = [];
  for (const match of xml.matchAll(/\b(?:descr|title)="([^"]+)"/g)) {
    const textValue = normalizeText(decodeXml(match[1]));
    if (textValue && !/^Picture\s+\d+$/i.test(textValue)) values.push(textValue);
  }
  return normalizeText(uniqueStrings(values).join("\n"));
}

async function getPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfPath = runtimeRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs");
      return importPdfJsTextOnly(pdfPath);
    })();
  }
  return pdfjsPromise;
}

async function extractPdf(buffer) {
  const pdfjs = await getPdfJs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    disableFontFace: true,
    isEvalSupported: false,
    isImageDecoderSupported: false,
    isOffscreenCanvasSupported: false,
    useSystemFonts: false,
    verbosity: pdfjs.VerbosityLevel?.ERRORS ?? 0,
    CanvasFactory: TextOnlyCanvasFactory,
  }).promise;
  const units = [];

  for (let index = 1; index <= doc.numPages; index += 1) {
    const page = await doc.getPage(index);
    const content = await page.getTextContent();
    const pageText = normalizeText(content.items.map((item) => item.str || "").join(" "));
    if (pageText) {
      units.push({
        label: `第 ${index} 页`,
        text: pageText,
      });
    }
  }

  const warning = units.length
    ? ""
    : "没有从 PDF 中抽取到可读文本，可能是扫描版 PDF。建议后续接入图像识别 API 或 OCR。";
  return {
    text: normalizeText(units.map((unit) => `## ${unit.label}\n${unit.text}`).join("\n\n")),
    units,
    warning,
  };
}

async function extractImage() {
  return {
    text: "",
    units: [],
    warning:
      "图片已保存。当前基础版暂不默认进行本地 OCR，后续可接入图像识别 API 来解析手写或扫描作业。",
  };
}

async function extractTextFromFile(buffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === ".pptx") return extractPptx(buffer);
  if (ext === ".pdf") return extractPdf(buffer);
  if ([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"].includes(ext)) {
    return extractImage(buffer);
  }
  if (ext === ".txt" || ext === ".md") {
    const textValue = normalizeText(buffer.toString("utf8"));
    return { text: textValue, units: splitPlainTextIntoUnits(textValue), warning: "" };
  }
  return {
    text: "",
    units: [],
    warning: "当前基础版支持 PPTX、PDF、TXT/MD 和常见图片文件。",
  };
}

function extractKeywords(textValue, limit = 24) {
  if (!String(textValue || "").trim()) return [];
  try {
    const model = courseKnowledgeModel({ id: "keyword_course", name: "材料力学" }, [
      {
        id: "keyword_doc",
        originalName: "文本片段.txt",
        type: "txt",
        text: textValue,
        units: [{ label: "全文", text: textValue }],
      },
    ]);
    const concepts = selectSummaryConcepts(model, limit).map((concept) => concept.name);
    if (concepts.length) return concepts;
  } catch {
    // Fall back to lexical extraction below.
  }
  const counts = new Map();
  for (const term of MECH_TERMS) {
    if (GENERIC_KEYWORDS.has(term)) continue;
    const matches = textValue.match(new RegExp(escapeRegExp(term), "g"));
    if (matches?.length) counts.set(term, matches.length * 4 + Math.min(term.length, 8));
  }
  const latinMatches = textValue.match(/\b[A-Za-z][A-Za-z0-9_/-]{1,}\b/g) || [];
  for (const raw of latinMatches) {
    const word = raw.toLowerCase();
    if (STOPWORDS.has(word) || word.length > 24) continue;
    const isFormulaToken = /^[A-Z][A-Z0-9_]{0,3}$/.test(raw) || /^[a-z]{1,3}$/.test(raw);
    const mixedCaseFormula = /[A-Z]/.test(raw) && /[a-z]/.test(raw) && !LATIN_KEYWORD_ALLOW.has(word);
    if (mixedCaseFormula) continue;
    if (isFormulaToken && !LATIN_KEYWORD_ALLOW.has(word)) continue;
    counts.set(raw, (counts.get(raw) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
    .slice(0, limit)
    .map(([term]) => term);
}

function clampText(value, maxLength = 92) {
  const textValue = cleanStudyText(value);
  return textValue.length > maxLength ? `${textValue.slice(0, maxLength - 1)}…` : textValue;
}

function sanitizeSourceRefs(sourceRefs = [], validDocumentIds = null) {
  const validIds = validDocumentIds ? new Set(validDocumentIds) : null;
  return (Array.isArray(sourceRefs) ? sourceRefs : [])
    .map((ref) => {
      const documentId = String(ref?.document_id || ref?.documentId || "").trim();
      if (!documentId || (validIds && !validIds.has(documentId))) return null;
      const rawUnitIndex = ref?.unit_index ?? ref?.unitIndex;
      const unitIndex =
        rawUnitIndex !== undefined && rawUnitIndex !== null && rawUnitIndex !== "" && Number.isInteger(Number(rawUnitIndex))
          ? Number(rawUnitIndex)
          : undefined;
      return {
        document_id: documentId,
        file_name: clampText(ref?.file_name || ref?.fileName || ref?.docName || "", 120),
        unit_index: unitIndex,
        unit_label: clampText(ref?.unit_label || ref?.unitLabel || ref?.label || "", 80),
        locator_label: clampText(ref?.locator_label || ref?.locatorLabel || ref?.anchor_label || ref?.label || "", 80),
        anchor_label: clampText(ref?.anchor_label || ref?.anchorLabel || "", 80),
        locator_type: clampText(ref?.locator_type || ref?.locatorType || "", 40),
        locator_confidence: clampText(ref?.locator_confidence || ref?.locatorConfidence || ref?.confidence || "", 24),
        confidence: clampText(ref?.confidence || ref?.locator_confidence || "", 24),
        excerpt: clampText(ref?.excerpt || ref?.anchor_text || ref?.anchorText || "", 260),
        anchor_text: clampText(ref?.anchor_text || ref?.anchorText || ref?.excerpt || "", 260),
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function uniqueSourceRefs(sourceRefs = []) {
  const seen = new Set();
  return (Array.isArray(sourceRefs) ? sourceRefs : [])
    .filter((ref) => ref?.document_id || ref?.documentId)
    .filter((ref) => {
      const key = `${ref.document_id || ref.documentId}:${ref.unit_index ?? ref.unitIndex ?? ""}:${ref.anchor_label || ref.locator_label || ref.unit_label || ref.label || ""}:${String(ref.excerpt || ref.anchor_text || "").slice(0, 48)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function cleanStudyText(value) {
  return String(value || "")
    .replace(/TaoFM-\s*/gi, "")
    .replace(/\b\d{4}\/\d{1,2}\/\d{1,2}\b/g, "")
    .replace(/\s+第\s*\d+\s*页\s*/g, " ")
    .replace(/\s+\d{1,3}\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitSentences(textValue) {
  return normalizeText(textValue)
    .split(/[\n。；;!?！？]+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 6 && line.length <= 180);
}

function scoreSentence(sentence, keywords) {
  let score = 0;
  for (const term of MECH_TERMS) if (sentence.includes(term)) score += 5;
  for (const term of keywords) if (sentence.includes(term)) score += 2;
  if (/[=≈≤≥∑Σ∫√σσετγθφωΩμνEIAGJMPFTNQVkxcy]/.test(sentence)) score += 4;
  if (/公式|条件|步骤|定理|方法|求|解|计算|证明|例题/.test(sentence)) score += 3;
  if (sentence.length > 18 && sentence.length < 100) score += 1;
  return score;
}

function getImportantSentences(textValue, keywords, limit = 14) {
  const seen = new Set();
  const ranked = [];
  for (const sentence of splitSentences(textValue)) {
    const key = sentence.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    const score = scoreSentence(sentence, keywords);
    if (score > 0) pushTopByScore(ranked, { sentence, score }, limit, (item) => item.score);
  }
  return ranked.map((item) => item.sentence);
}

function getFormulaLines(textValue, limit = 12) {
  const lines = normalizeText(textValue)
    .split(/[\n。；;]+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 5 && line.length <= 180);
  const seen = new Set();
  return lines
    .filter((line) => /[=≈≤≥∑Σ∫√σσετγθφωΩμνEIAGJMPFTNQVkxcy]|\\(?:frac|sqrt|le|ge|approx|sigma|tau|Delta)/.test(line))
    .filter(isUsefulFormulaLine)
    .map((line) => verifyFormula(toLatexFormula(line), { unitText: textValue }).expression)
    .filter((line) => {
      const key = line.replace(/\s+/g, "");
      if (!line || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function isUsefulFormulaLine(line) {
  const normalized = line.replace(/\s+/g, " ").trim();
  if (/^##|TaoFM|第\s*\d+\s*页|^\d{4}\/\d{1,2}\/\d{1,2}/i.test(normalized)) return false;
  if (/一、|二、|三、|四、|五、|六、|七、|八、/.test(normalized) && normalized.length > 60) return false;
  const hasOperator = /[=≈≤≥∑Σ∫√]|\\(?:frac|sqrt|le|ge|approx)|->|→|×|·|\//.test(normalized);
  const hasPhysicsSymbol = /\\(?:sigma|tau|varepsilon|epsilon|Delta)|[σσετγθφωΩμνΔδψ]|F_N|F_\{N\}|FN|EA|EI|GJ|Pcr|P_\{cr\}|Mmax|tau|sigma|epsilon|Delta/i.test(normalized);
  const compactLength = normalized.replace(/\s+/g, "").length;
  return hasOperator && hasPhysicsSymbol && compactLength <= 140;
}

function sourceRefDisplayLabel(ref = {}) {
  return ref.anchor_label || ref.locator_label || ref.unit_label || ref.label || "全文";
}

function makeUnitSourceRef(doc, unit, unitIndex, excerpt, confidence = "medium") {
  const label = unit?.label || "全文";
  const pageMatch = String(label).match(/第\s*(\d+)\s*页/);
  const pageNumber = pageMatch ? Number(pageMatch[1]) : null;
  const type = String(doc?.type || "").toLowerCase();
  return {
    document_id: doc?.id || "unknown",
    file_name: doc?.originalName || "unknown",
    document_type: type || path.extname(doc?.originalName || "").replace(".", "").toLowerCase() || "unknown",
    unit_index: Number.isInteger(unitIndex) ? unitIndex : 0,
    unit_label: label,
    page_number: pageNumber,
    slide_number: type === "pptx" ? pageNumber : null,
    problem_number: "unknown",
    paragraph_index: 0,
    locator_version: LOCATOR_VERSION,
    locator_type: "unit",
    locator_label: label,
    locator_confidence: confidence,
    anchor_label: "",
    anchor_text: "",
    excerpt: clampText(excerpt || unit?.text || label, 180),
    confidence,
  };
}

function getUnitMatches(docs, pattern, limit = 3) {
  const matches = [];
  for (const doc of docs) {
    const units = doc.units?.length ? doc.units : [{ label: "全文", text: doc.text }];
    for (const [unitIndex, unit] of units.entries()) {
      if (!pattern.test(unit.text || "")) continue;
      const sentences = splitSentences(unit.text || "");
      const best = sentences
        .filter((sentence) => pattern.test(sentence))
        .sort((a, b) => scoreSentence(b, []) - scoreSentence(a, []))[0];
      matches.push({
        docName: doc.originalName,
        documentId: doc.id,
        label: unit.label,
        excerpt: clampText(best || unit.text, 110),
        source_ref: makeUnitSourceRef(doc, unit, unitIndex, best || unit.text, best ? "medium" : "low"),
      });
      if (matches.length >= limit) return matches;
    }
  }
  return matches;
}

function topicScore(sourceText, topic) {
  const matches = sourceText.match(new RegExp(topic.pattern.source, "g")) || [];
  const count = matches.length;
  if (count < (topic.minScore || 1)) return 0;
  return count;
}

function topicFormulaLines(sourceText, topic, limit = 4, formulaLines = getFormulaLines(sourceText, 30)) {
  const topicWords = topic.concepts
    .join(" ")
    .match(/[\p{L}\p{N}_]+|[σσετγθφωΩμνΔδψ]/gu) || [];
  const selected = formulaLines.filter((line) => topic.pattern.test(line) || topicWords.some((word) => line.includes(word)));
  const merged = [...topic.formulas, ...selected.filter((line) => line.length <= 70)];
  const seen = new Set();
  return merged
    .map((line) => clampText(line, 96))
    .filter((line) => {
      const key = line.replace(/\s+/g, "");
      if (!line || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function markdownFormula(formula) {
  return wrapInlineFormula(formula);
}

function markdownInlineFormulas(value) {
  const text = String(value || "");
  if (!text || text.includes("$")) return text;
  const segments = [];
  let rest = text;
  const formulaPattern =
    /(\\frac\{[^{}]+\}\{[^{}]+\}|(?:\\[A-Za-z]+|[σσετγθφωΩμνΔδψA-Za-z])(?:[\s_{}^A-Za-z0-9\\+\-*/=<>≈≤≥().，,;；·×]){1,80}(?:=|≤|≥|≈|<|>|\/)(?:[\s_{}^A-Za-z0-9\\+\-*/=<>≈≤≥().，,;；·×σσετγθφωΩμνΔδψ]){1,100})/u;
  while (rest) {
    const match = rest.match(formulaPattern);
    if (!match || match.index === undefined) {
      segments.push(rest);
      break;
    }
    const before = rest.slice(0, match.index);
    const matched = match[0];
    const raw = matched.replace(/[，,;；。]+$/u, "");
    const trailing = matched.slice(raw.length);
    if (before) segments.push(before);
    segments.push(wrapInlineFormula(raw) || raw);
    if (trailing) segments.push(trailing);
    rest = rest.slice(match.index + matched.length);
  }
  return segments.join("");
}

function buildKnowledgeMap(course, docs) {
  const sourceText = docs.map((doc) => doc.text).join("\n\n");
  const title = course?.name || "当前科目";
  const sourceFormulaLines = getFormulaLines(sourceText, 30);
  let courseModel = null;
  let modelIndex = null;
  try {
    courseModel = courseKnowledgeModel(course, docs);
    modelIndex = buildCourseModelIndex(courseModel);
  } catch {
    courseModel = null;
  }
  const selectedConcepts = courseModel ? selectSummaryConcepts(courseModel, 18, modelIndex) : [];
  const keywords = selectedConcepts.length ? selectedConcepts.map((concept) => concept.name) : extractKeywords(sourceText, 32);
  const structuredTopics = courseModel ? structuredMapTopics(courseModel, selectedConcepts, modelIndex) : [];
  const activeTopics = TOPIC_DEFINITIONS
    .map((topic) => ({
      ...topic,
      score: topicScore(sourceText, topic),
      evidence: getUnitMatches(docs, topic.pattern, 3),
    }))
    .filter((topic) => topic.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "zh-Hans-CN"));

  const fallbackTopics = activeTopics.length
    ? []
    : [
        {
          ...TOPIC_DEFINITIONS[0],
          score: 1,
          evidence: [],
        },
      ];
  const topics = structuredTopics.length
    ? structuredTopics
    : (activeTopics.length ? activeTopics : fallbackTopics).slice(0, 6).map((topic) => ({
    id: topic.id,
    title: topic.title,
    icon: topic.icon,
    tone: topic.tone,
    score: topic.score,
    concepts: topic.concepts.filter((concept) => sourceText.includes(concept.replace(/\s.*$/, "")) || topic.pattern.test(sourceText)).slice(0, 6),
    formulas: topicFormulaLines(sourceText, topic, 4, sourceFormulaLines),
    checks: topic.checks.slice(0, 3),
    evidence: topic.evidence,
  }));

  const relationships = [];
  const activeTopicIds = new Set(activeTopics.map((topic) => topic.id));
  const topicText = topics
    .map((topic) => [topic.id, topic.title, ...(topic.concepts || []), ...(topic.formulas || [])].join(" "))
    .join("\n");
  const signalText = `${sourceText}\n${topicText}`;
  const hasTopic = (idValue) => activeTopicIds.has(idValue) || topics.some((topic) => topic.id === idValue);
  const hasSignal = (idValue, pattern) => hasTopic(idValue) || pattern.test(signalText);
  if (hasSignal("axial", /轴向|轴力|拉压|拉伸|压缩|F_N/i) && hasSignal("material", /材料|许用应力|屈服|强度|弹性模量|\\sigma_\{s\}|σ_s/i)) {
    relationships.push("材料性能给出 E、σ_s、σ_b 等参数，轴向拉压用这些参数做变形和强度校核。");
  }
  if (hasSignal("bending", /梁|弯曲|弯矩|剪力|惯性矩|My\/I|M\s*y\s*\/\s*I|\\frac\{M y\}\{I\}/i) && hasSignal("material", /材料|许用应力|屈服|强度|\\sigma_\{s\}|σ_s/i)) {
    relationships.push("梁弯曲中的 σ = My/I 仍要回到材料许用应力或屈服指标判断是否安全。");
  }
  if (hasSignal("stress", /应力|主应力|等效应力|莫尔圆|\\sigma|σ/i) && hasSignal("material", /材料|屈服|强度|失效|许用应力/i)) {
    relationships.push("复杂应力状态需要先求主应力或等效应力，再结合材料失效准则判断强度。");
  }
  if (hasSignal("torsion", /扭转|扭矩|剪应力|\\tau|τ/i) && hasSignal("stress", /应力|主应力|组合载荷|\\sigma|σ/i)) {
    relationships.push("扭转产生剪应力，组合载荷时要放入平面/空间应力状态统一分析。");
  }
  if (hasSignal("stability", /压杆|稳定|屈曲|临界载荷|P_\{cr\}|Pcr/i) && hasSignal("axial", /轴向|轴力|拉压|压应力|F_N/i)) {
    relationships.push("压杆既有轴向压应力校核，也要单独做稳定临界载荷校核。");
  }

  const important = getImportantSentences(sourceText, keywords, 12).map((sentence) => markdownInlineFormulas(clampText(sentence, 116)));
  return {
    title,
    keywords: keywords.slice(0, 18),
    selectionMode: selectedConcepts.length ? "evidence_scored_concepts" : "topic_definition_fallback",
    topics,
    relationships: relationships.slice(0, 5).map(markdownInlineFormulas),
    important,
    workflow: [
      "明确研究对象、载荷和约束，先画受力图或变形协调图。",
      "列平衡方程、几何方程和本构方程，确认未知量数量闭合。",
      "按题型选择强度、刚度、稳定或动力学条件，并检查适用假设。",
      "计算后做单位、正负号、极限情况和物理意义检查。",
    ],
    pitfalls: inferPitfalls(sourceText),
  };
}

function structuredMapTopics(courseModel, selectedConcepts = [], modelIndex = buildCourseModelIndex(courseModel)) {
  const scoredByChapter = summaryScoredConceptsByChapter(courseModel, modelIndex);
  const selectedNames = new Set(selectedConcepts.map((concept) => concept.name));
  return (courseModel.chapters || [])
    .map((chapter, chapterIndex) => {
      const concepts = chapterItems(scoredByChapter, chapter.chapter_id);
      const selected = concepts.filter((concept) => selectedNames.has(concept.name));
      const formulas = chapterItems(modelIndex.formulasByChapter, chapter.chapter_id);
      const problems = chapterItems(modelIndex.problemsByChapter, chapter.chapter_id);
      const mistakes = chapterItems(modelIndex.mistakesByChapter, chapter.chapter_id);
      const signalCount = selected.length + formulas.length + problems.length + mistakes.length;
      if (!signalCount) return null;
      const title = summaryChapterTitle(chapter, {
        concepts: (selected.length ? selected : concepts).map((concept) => concept.name),
        formulas: formulas.map((formula) => formula.name || formula.expression),
        problems: problems.map((problem) => problem.title),
      });
      return {
        id: chapter.chapter_id || `chapter_${chapterIndex}`,
        title,
        icon: chapter.exam_focus?.level === "high" ? "target" : "book-open-check",
        tone: ["teal", "blue", "amber", "green", "rose", "violet"][chapterIndex % 6],
        score: Math.round(
          Number(chapter.exam_focus?.score || 0) +
            selected.reduce((sum, concept) => sum + Number(concept.summary_score || concept.importance_score || 0), 0) / 20 +
            formulas.length * 8 +
            problems.length * 9 +
            mistakes.length * 8,
        ),
        concepts: (selected.length ? selected : concepts).map((concept) => concept.name).slice(0, 6),
        formulas: formulas.map((formula) => formula.expression).slice(0, 4),
        checks: structuredTopicChecks(selected, formulas, problems, mistakes),
        evidence: structuredTopicEvidence([chapter, ...selected, ...formulas, ...problems, ...mistakes], 3),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

function structuredTopicChecks(concepts, formulas, problems, mistakes) {
  return uniqueStrings([
    concepts.length ? `先复述：${concepts.slice(0, 3).map((concept) => concept.name).join("、")}` : "",
    formulas.length ? `默写并说明适用条件：${formulas.slice(0, 2).map((formula) => formula.name).join("、")}` : "",
    problems.length ? "用一道例题/作业验证解题入口。" : "",
    mistakes.length ? "最后按易错提示检查正负号、单位和适用范围。" : "",
  ]).slice(0, 4);
}

function structuredTopicEvidence(items, limit = 3) {
  return (items || [])
    .flatMap((item) => item?.source_refs || [])
    .map((ref) => ({
      docName: ref.file_name,
      documentId: ref.document_id,
      label: sourceRefDisplayLabel(ref),
      excerpt: clampText(ref.excerpt || ref.anchor_text || "", 116),
      source_ref: ref,
    }))
    .filter((item) => item.excerpt)
    .slice(0, limit);
}

function inferPitfalls(sourceText) {
  const pitfalls = [
    "公式套用前没有检查边界条件、载荷形式和小变形/线弹性等假设。",
    "计算题只给数值结果，没有写单位、正负号和结果解释。",
  ];
  if (/轴力|拉压|伸长|胡克|自重/.test(sourceText)) {
    pitfalls.unshift("轴向拉压题容易把外力、截面内力 F_N 和应力 σ 混在一起。");
  }
  if (/屈服|强化|颈缩|比例极限|弹性极限/.test(sourceText)) {
    pitfalls.unshift("材料性能题容易混淆比例极限、弹性极限、屈服极限和强度极限。");
  }
  if (/弯矩|剪力|梁/.test(sourceText)) {
    pitfalls.unshift("梁题常见错误是剪力、弯矩正负号约定前后不一致。");
  }
  if (/压杆|稳定|屈曲/.test(sourceText)) {
    pitfalls.unshift("压杆题不能只做强度校核，还要检查稳定临界载荷。");
  }
  return [...new Set(pitfalls)].slice(0, 6);
}

function localKnowledgeMap(course, docs) {
  return buildKnowledgeMap(course, docs);
}

function extractSectionCandidates(textValue) {
  const normalized = cleanStudyText(textValue)
    .replace(/\s*[-－–—]\s*/g, "-")
    .replace(/\s*[、,.，．:：]\s*/g, "、")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  const candidates = [];
  const sectionPattern = /(^|[^\d/])(\d+-\d+)\s*、\s*([\s\S]*?)(?=\s+\d+-\d+\s*、|第\s*[一二三四五六七八九十\d]+\s*章|$)/gu;
  for (const match of normalized.matchAll(sectionPattern)) {
    const titleText = cleanSectionTitle(match[3]);
    if (!titleText) continue;
    candidates.push({
      type: "section",
      number: match[2],
      title: `${match[2]}、${titleText}`,
      key: `${match[2]}:${titleText}`.replace(/\s+/g, ""),
    });
  }

  if (!candidates.length) {
    const chapter = /第\s*[一二三四五六七八九十\d]+\s*章\s*([^。；;!?！？]{0,42})/u.exec(normalized);
    if (chapter) {
      const titleText = cleanSectionTitle(chapter[1]);
      const chapterLabel = chapter[0].replace(/\s+/g, "");
      candidates.push({
        type: "chapter",
        number: chapterLabel.replace(titleText.replace(/\s+/g, ""), ""),
        title: clampText(chapterLabel, 44),
        key: chapterLabel,
      });
    }
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate.title || seen.has(candidate.key)) return false;
    seen.add(candidate.key);
    return true;
  });
}

function cleanSectionTitle(value) {
  return cleanStudyText(value)
    .replace(/\s+\d+\s*、[\s\S]*$/u, "")
    .replace(/\s+[①②③④⑤⑥⑦⑧⑨].*$/u, "")
    .replace(/\s+\d{1,3}\s*$/g, "")
    .replace(/\s*(?:例题|思考题|问题)\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\d+\s*/, "")
    .slice(0, 34)
    .trim();
}

function isContentsLikeUnit(textValue, candidates) {
  const text = cleanStudyText(textValue);
  return candidates.length >= 3 || (/第\s*[一二三四五六七八九十\d]+\s*章/.test(text) && candidates.length >= 2);
}

function docUnits(doc) {
  if (Array.isArray(doc?.units) && doc.units.length) return doc.units;
  if (doc?.text) return [{ label: "全文", text: doc.text }];
  return [];
}

function buildMaterialReviewBuckets(docs) {
  const buckets = new Map();

  for (const [docIndex, doc] of docs.entries()) {
    let currentBucket = null;
    const units = docUnits(doc);
    for (const [unitIndex, unit] of units.entries()) {
      const unitText = unit.text || "";
      if (!cleanStudyText(unitText)) continue;
      const candidates = extractSectionCandidates(unitText);
      if (isContentsLikeUnit(unitText, candidates)) continue;

      const candidate = candidates[0];
      if (candidate) {
        const bucketId = stableReviewId([doc.id, candidate.key]);
        if (!buckets.has(bucketId)) {
          buckets.set(bucketId, {
            id: bucketId,
            title: candidate.title,
            sectionKey: candidate.key,
            sectionOrder: docIndex * 1000 + unitIndex,
            icon: "book-open-check",
            tone: "teal",
            score: 0,
            concepts: [],
            formulas: [],
            checks: [],
            evidence: [],
            mistakes: [],
            units: [],
            sourceDocumentIds: new Set([doc.id]),
            sourceText: "",
            docName: doc.originalName,
          });
        }
        currentBucket = buckets.get(bucketId);
      }

      if (!currentBucket && units.length <= 3) {
        const title = clampText(doc.originalName || "资料复盘", 42);
        const bucketId = stableReviewId([doc.id, "document-review"]);
        if (!buckets.has(bucketId)) {
          buckets.set(bucketId, {
            id: bucketId,
            title,
            sectionKey: title,
            sectionOrder: docIndex * 1000 + unitIndex,
            icon: "book-open-check",
            tone: "teal",
            score: 0,
            concepts: [],
            formulas: [],
            checks: [],
            evidence: [],
            mistakes: [],
            units: [],
            sourceDocumentIds: new Set([doc.id]),
            sourceText: "",
            docName: doc.originalName,
          });
        }
        currentBucket = buckets.get(bucketId);
      }

      if (!currentBucket) continue;
      currentBucket.units.push({
        docId: doc.id,
        docName: doc.originalName,
        label: unit.label || "全文",
        text: unitText,
        unitIndex,
      });
      currentBucket.sourceDocumentIds.add(doc.id);
      currentBucket.sourceText = `${currentBucket.sourceText}\n\n${unitText}`.trim();
    }
  }

  return [...buckets.values()].map(finalizeMaterialBucket).filter((bucket) => bucket.sourceText);
}

function finalizeMaterialBucket(bucket) {
  const sourceText = bucket.sourceText || "";
  const definitions = matchingTopicDefinitions(`${bucket.title}\n${sourceText}`);
  const primary = definitions[0];
  const keywords = extractKeywords(`${bucket.title}\n${sourceText}`, 10);
  const formulas = uniqueStrings(
    definitions.flatMap((definition) => topicFormulaLines(sourceText, definition, 3)).concat(getFormulaLines(sourceText, 3)),
  ).slice(0, 4);
  const checks = uniqueStrings(definitions.flatMap((definition) => definition.checks)).slice(0, 4);

  return {
    ...bucket,
    icon: primary?.icon || bucket.icon,
    tone: primary?.tone || bucket.tone,
    score: Math.max(1, sectionMaterialScore(sourceText, definitions)),
    concepts: definitions.length ? uniqueStrings(definitions.flatMap((definition) => definition.concepts)).slice(0, 6) : keywords.slice(0, 6),
    formulas,
    checks: checks.length
      ? checks
      : ["按“定义、公式、例题、错题”四格复盘", "写出公式适用条件", "用一道题检查完整解题流程"],
    chapterTitle: primary ? `专题：${primary.title}` : "资料章节",
    chapterLocation: `${bucket.docName || "资料"} / ${formatUnitRange(bucket.units)}`,
    evidence: materialEvidence(bucket.units, sourceText),
    sourceDocumentIds: [...bucket.sourceDocumentIds],
    sourceText,
  };
}

function matchingTopicDefinitions(textValue) {
  return TOPIC_DEFINITIONS.map((definition) => ({
    definition,
    score: topicScore(textValue, definition) + (definition.pattern.test(textValue) ? 1 : 0),
  }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.definition)
    .slice(0, 3);
}

function sectionMaterialScore(sourceText, definitions) {
  const keywordScore = extractKeywords(sourceText, 12).length;
  const formulaScore = getFormulaLines(sourceText, 8).length * 2;
  const topicScoreValue = definitions.reduce((sum, definition) => sum + topicScore(sourceText, definition), 0);
  return keywordScore + formulaScore + topicScoreValue;
}

function uniqueStrings(values) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function formatUnitRange(units) {
  if (!units?.length) return "全文";
  const first = units[0].label || "全文";
  const last = units.at(-1).label || first;
  return first === last ? first : `${first}-${last}`;
}

function materialEvidence(units, sourceText) {
  const keywords = extractKeywords(sourceText, 12);
  return units
    .map((unit) => {
      const sentence =
        getImportantSentences(unit.text || "", keywords, 1)[0] ||
        splitSentences(unit.text || "")[0] ||
        unit.text ||
        "";
      return {
        docName: unit.docName,
        documentId: unit.docId,
        label: unit.label,
        excerpt: clampText(sentence, 116),
        source_ref: makeUnitSourceRef(
          { id: unit.docId, originalName: unit.docName },
          { label: unit.label, text: unit.text },
          unit.unitIndex,
          sentence,
          "medium",
        ),
      };
    })
    .filter((item) => item.excerpt)
    .slice(0, 3);
}

function mergeReviewBucket(target, incoming) {
  target.score = Math.max(Number(target.score || 0), Number(incoming.score || 0));
  target.concepts = uniqueStrings([...(target.concepts || []), ...(incoming.concepts || [])]);
  target.formulas = uniqueStrings([...(target.formulas || []), ...(incoming.formulas || [])]);
  target.checks = uniqueStrings([...(target.checks || []), ...(incoming.checks || [])]);
  target.evidence = [...(target.evidence || []), ...(incoming.evidence || [])].slice(0, 4);
  target.sourceRefs = [...(target.sourceRefs || []), ...(incoming.sourceRefs || [])].slice(0, 6);
  target.sourceDocumentIds = uniqueStrings([...(target.sourceDocumentIds || []), ...(incoming.sourceDocumentIds || [])]);
  target.sourceText = `${target.sourceText || ""}\n\n${incoming.sourceText || ""}`.trim();
  return target;
}

function localReviewPlan(course, docs, mistakes = [], sessions = [], options = {}) {
  const selectedDocumentIds = new Set(docs.map((doc) => doc.id));
  const courseMistakes = mistakes.filter((mistake) => mistake.courseId === course?.id);
  const relevantMistakes = courseMistakes.filter((mistake) => {
    if (!selectedDocumentIds.size) return true;
    if (!Array.isArray(mistake.sourceDocumentIds) || !mistake.sourceDocumentIds.length) return true;
    return mistake.sourceDocumentIds.some((docId) => selectedDocumentIds.has(docId));
  });
  const courseSessions = sessions.filter((session) => session.courseId === course?.id);
  const map = buildKnowledgeMap(course, docs);
  const buckets = new Map();
  const sourceText = docs.map((doc) => doc.text).join("\n\n");

  for (const bucket of buildMaterialReviewBuckets(docs)) {
    buckets.set(bucket.id, bucket);
  }

  const ensureBucket = (topic) => {
    if (!buckets.has(topic.id)) {
      const definition = TOPIC_DEFINITIONS.find((item) => item.id === topic.id);
      buckets.set(topic.id, {
        id: topic.id,
        title: topic.title,
        icon: topic.icon || definition?.icon || "circle-dot",
        tone: topic.tone || definition?.tone || "teal",
        score: Number(topic.score || 0),
        concepts: topic.concepts || definition?.concepts || [],
        formulas: topic.formulas || definition?.formulas || [],
        checks: topic.checks || definition?.checks || [],
        evidence: topic.evidence || [],
        sourceRefs: topic.sourceRefs || topic.source_refs || [],
        mistakes: [],
        sourceDocumentIds: topic.sourceDocumentIds || [],
        sourceText: topic.sourceText || "",
      });
    } else {
      mergeReviewBucket(buckets.get(topic.id), topic);
    }
    return buckets.get(topic.id);
  };

  if (!buckets.size) {
    for (const topic of map.topics || []) {
      const definition = TOPIC_DEFINITIONS.find((item) => item.id === topic.id);
      const sourceDocumentIds = definition
        ? docs.filter((doc) => definition.pattern.test(doc.text || "")).map((doc) => doc.id)
        : docs.map((doc) => doc.id);
      ensureBucket({ ...topic, sourceDocumentIds, sourceText });
    }

    for (const definition of TOPIC_DEFINITIONS) {
      if (!definition.pattern.test(sourceText)) continue;
      const bucket = ensureBucket({
        id: definition.id,
        title: definition.title,
        icon: definition.icon,
        tone: definition.tone,
        score: topicScore(sourceText, definition),
        concepts: definition.concepts,
        formulas: topicFormulaLines(sourceText, definition, 4),
        checks: definition.checks,
        evidence: getUnitMatches(docs, definition.pattern, 2),
        sourceDocumentIds: docs.filter((doc) => definition.pattern.test(doc.text || "")).map((doc) => doc.id),
        sourceText,
      });
      bucket.score = Math.max(bucket.score, topicScore(sourceText, definition));
    }
  }

  for (const mistake of relevantMistakes) {
    const matchedBuckets = matchReviewBucketsForMistake(mistake, [...buckets.values()], docs);
    if (matchedBuckets.length) {
      for (const bucket of matchedBuckets) attachMistakeToBucket(bucket, mistake, selectedDocumentIds);
      continue;
    }

    const matchedIds = matchTopicIdsForMistake(mistake, docs);
    const targets = matchedIds.length ? matchedIds : ["mistake-review"];
    for (const topicId of targets) {
      const definition = TOPIC_DEFINITIONS.find((item) => item.id === topicId);
      const bucket = ensureBucket(
        definition
          ? {
              id: definition.id,
              title: definition.title,
              icon: definition.icon,
              tone: definition.tone,
              score: 1,
              concepts: definition.concepts,
              formulas: topicFormulaLines(sourceText, definition, 3),
              checks: definition.checks,
              evidence: getUnitMatches(docs, definition.pattern, 2),
              sourceDocumentIds: mistake.sourceDocumentIds || [],
              sourceText,
            }
          : {
              id: "mistake-review",
              title: "错题回炉与解题流程",
              icon: "bookmark-x",
              tone: "rose",
              score: 1,
              concepts: ["错因定位", "解题步骤", "单位与符号检查"],
              formulas: [],
              checks: ["先复述错因，再重做同类题", "把参考答案拆成可执行步骤", "最后检查单位、正负号和适用条件"],
              evidence: [],
              sourceDocumentIds: mistake.sourceDocumentIds || [],
              sourceText: "",
            },
      );
      attachMistakeToBucket(bucket, mistake, selectedDocumentIds);
    }
  }

  const today = new Date();
  const limit = Math.max(3, Math.min(Number(options.limit || 6), 10));
  let planItems = [...buckets.values()]
    .map((bucket) => decorateReviewPlanItem(bucket, docs, courseSessions, today))
    .filter((item) => item.materialSignals || item.totalMistakes || item.sourceDocumentIds.length)
    .sort((a, b) => b.priorityScore - a.priorityScore || b.unmasteredMistakes - a.unmasteredMistakes || a.order - b.order || a.title.localeCompare(b.title, "zh-Hans-CN"));

  if (!planItems.length && docs.length) {
    const keywords = extractKeywords(sourceText, 8);
    planItems.push(
      decorateReviewPlanItem(
        {
          id: "general-review",
          title: `${course?.name || "当前科目"}总复盘`,
          icon: "list-checks",
          tone: "teal",
          score: 1,
          concepts: keywords.slice(0, 5),
          formulas: getFormulaLines(sourceText, 3),
          checks: ["按章节整理定义、公式、例题和错题", "每个公式写出适用条件", "用一题检查完整解题流程"],
          evidence: [],
          mistakes: relevantMistakes,
          sourceDocumentIds: docs.map((doc) => doc.id),
          sourceText,
        },
        docs,
        courseSessions,
        today,
      ),
    );
  }

  planItems = planItems.slice(0, limit);
  const totalCompleted = courseSessions.length;
  const nextReview = planItems.find((item) => !item.completedRecently) || planItems[0] || null;
  return {
    courseId: course?.id,
    title: `${course?.name || "当前科目"}期末复习计划`,
    generatedAt: now(),
    summary: {
      documentCount: docs.length,
      topicCount: planItems.length,
      mistakeCount: relevantMistakes.length,
      unmasteredMistakeCount: relevantMistakes.filter((mistake) => !mistake.mastered).length,
      completedSessionCount: totalCompleted,
      selectedDocumentCount: selectedDocumentIds.size,
    },
    nextReview,
    items: planItems,
  };
}

function attachMistakeToBucket(bucket, mistake, selectedDocumentIds) {
  bucket.mistakes.push(mistake);
  bucket.sourceDocumentIds = uniqueStrings([
    ...(bucket.sourceDocumentIds || []),
    ...(mistake.sourceDocumentIds || []).filter((docId) => selectedDocumentIds.has(docId)),
  ]);
  bucket.sourceRefs = [...(bucket.sourceRefs || []), ...(mistake.sourceRefs || mistake.source_refs || [])].slice(0, 6);
  bucket.sourceMistakeIds = uniqueStrings([...(bucket.sourceMistakeIds || []), mistake.id]);
}

function matchReviewBucketsForMistake(mistake, buckets, docs) {
  if (!buckets.length) return [];
  const mistakeText = normalizeText([mistake.question, mistake.answer, mistake.explanation, mistake.userAnswer].filter(Boolean).join("\n"));
  const sourceIds = new Set(mistake.sourceDocumentIds || []);
  const directTopicIds = new Set(matchTopicIdsForMistake(mistake, docs));
  const keywords = extractKeywords(mistakeText, 8);
  const scored = buckets
    .map((bucket) => {
      let score = 0;
      if (sourceIds.size && (bucket.sourceDocumentIds || []).some((docId) => sourceIds.has(docId))) score += 8;
      const bucketText = `${bucket.title || ""}\n${bucket.chapterTitle || ""}\n${bucket.sourceText || ""}`;
      for (const topicId of directTopicIds) {
        const definition = TOPIC_DEFINITIONS.find((item) => item.id === topicId);
        if (definition?.pattern.test(bucketText)) score += 5;
      }
      for (const keyword of keywords) {
        if (bucketText.includes(keyword)) score += 2;
      }
      return { bucket, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.bucket.sectionOrder || 0) - Number(b.bucket.sectionOrder || 0));

  return scored.slice(0, 2).map((item) => item.bucket);
}

function matchTopicIdsForMistake(mistake, docs) {
  const textValue = normalizeText([mistake.question, mistake.answer, mistake.explanation, mistake.userAnswer].filter(Boolean).join("\n"));
  const direct = TOPIC_DEFINITIONS.filter((topic) => topic.pattern.test(textValue)).map((topic) => topic.id);
  if (direct.length) return direct.slice(0, 3);
  const sourceIds = new Set(mistake.sourceDocumentIds || []);
  if (!sourceIds.size) return [];
  const sourceText = docs
    .filter((doc) => sourceIds.has(doc.id))
    .map((doc) => doc.text)
    .join("\n\n");
  return TOPIC_DEFINITIONS.filter((topic) => topic.pattern.test(sourceText))
    .map((topic) => topic.id)
    .slice(0, 3);
}

function decorateReviewPlanItem(bucket, docs, sessions, today) {
  const topicSessions = sessions.filter(
    (session) => session.topicId === bucket.id || (!session.topicId && session.topicTitle === bucket.title),
  );
  const completedCount = topicSessions.length;
  const lastCompletedAt = topicSessions
    .map((session) => session.completedAt || session.createdAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const daysSinceReview = lastCompletedAt ? Math.floor((today - new Date(lastCompletedAt)) / 86400000) : null;
  const unmasteredMistakes = bucket.mistakes.filter((mistake) => !mistake.mastered);
  const materialSignals = Number(bucket.score || 0) + (bucket.evidence?.length || 0);
  const recentPenalty = daysSinceReview === null ? 0 : daysSinceReview <= 1 ? 14 : daysSinceReview <= 3 ? 9 : daysSinceReview <= 7 ? 5 : 0;
  const priorityScore = Math.max(
    1,
    materialSignals * 3 + unmasteredMistakes.length * 12 + bucket.mistakes.length * 5 - completedCount * 4 - recentPenalty,
  );
  const chapter = inferChapterForTopic(bucket, docs);
  const sourceDocumentIds = bucket.sourceDocumentIds?.length ? bucket.sourceDocumentIds : docs.map((doc) => doc.id);
  const focusSteps = buildFocusSteps(bucket, unmasteredMistakes);
  const evidence = (bucket.evidence || []).slice(0, 2);
  const sourceRefs = uniqueSourceRefs([
    ...(bucket.sourceRefs || []),
    ...evidence.map((item) => item.source_ref).filter(Boolean),
    ...bucket.mistakes.flatMap((mistake) => mistake.sourceRefs || mistake.source_refs || []),
  ]);
  return {
    id: bucket.id,
    title: bucket.title,
    order: Number(bucket.sectionOrder ?? 999),
    chapterTitle: bucket.chapterTitle || chapter.title,
    chapterLocation: bucket.chapterLocation || chapter.location,
    icon: bucket.icon,
    tone: bucket.tone,
    priorityScore,
    priorityLabel: priorityScore >= 30 ? "高优先级" : priorityScore >= 16 ? "中优先级" : "巩固",
    durationMinutes: priorityScore >= 30 ? 35 : priorityScore >= 16 ? 25 : 18,
    materialSignals,
    totalMistakes: bucket.mistakes.length,
    unmasteredMistakes: unmasteredMistakes.length,
    completedCount,
    lastCompletedAt,
    completedRecently: daysSinceReview !== null && daysSinceReview <= 1,
    reason: reviewReason(bucket, unmasteredMistakes.length, completedCount, daysSinceReview),
    concepts: (bucket.concepts || []).slice(0, 5),
    formulas: (bucket.formulas || []).slice(0, 3),
    checks: (bucket.checks || []).slice(0, 3),
    focusSteps,
    nextAction: focusSteps[0] || "用一题完整复盘定义、公式、适用条件和检查点。",
    evidence,
    sourceRefs,
    sourceDocumentIds: [...new Set(sourceDocumentIds)],
    sourceMistakeIds: [...new Set([...(bucket.sourceMistakeIds || []), ...bucket.mistakes.map((mistake) => mistake.id)])],
  };
}

function inferChapterForTopic(bucket, docs) {
  const definition = TOPIC_DEFINITIONS.find((topic) => topic.id === bucket.id);
  const pattern = definition?.pattern;
  for (const doc of docs) {
    const units = doc.units?.length ? doc.units : [{ label: "全文", text: doc.text }];
    for (const unit of units) {
      if (pattern && !pattern.test(unit.text || "")) continue;
      return {
        title: extractChapterTitle(unit.text) || bucket.title,
        location: `${doc.originalName} / ${unit.label || "全文"}`,
      };
    }
  }
  return {
    title: bucket.title,
    location: docs[0] ? `${docs[0].originalName} / 全文` : "暂无资料定位",
  };
}

function extractChapterTitle(textValue) {
  const text = cleanStudyText(textValue);
  const numbered = text.match(/\d+\s*[-－–—]\s*\d+\s*[、,.，．]\s*[\p{L}\s（）()、]{2,34}/u);
  if (numbered) {
    return clampText(numbered[0].replace(/\s*[-－–—]\s*/g, "-").replace(/\s*[、,.，．]\s*/g, "、"), 38);
  }
  const chapter = text.match(/第\s*[一二三四五六七八九十\d]+\s*章[\p{L}\s（）()、]{0,24}/u);
  if (chapter) return clampText(chapter[0], 38);
  return "";
}

function buildFocusSteps(bucket, unmasteredMistakes) {
  const steps = [];
  if (bucket.concepts?.length) steps.push(`先用 5 分钟复述：${bucket.concepts.slice(0, 3).join("、")}。`);
  if (bucket.formulas?.length) steps.push(`整理公式适用条件：${wrapInlineFormula(bucket.formulas[0]) || bucket.formulas[0]}。`);
  if (unmasteredMistakes.length) steps.push(`重做 ${unmasteredMistakes.length} 道未掌握错题，写出错因和正确入口。`);
  for (const check of bucket.checks || []) {
    if (steps.length >= 4) break;
    steps.push(check);
  }
  if (!steps.length) steps.push("按“定义、公式、例题、错题”四格完成一页复盘。");
  return steps.slice(0, 4);
}

function reviewReason(bucket, unmasteredCount, completedCount, daysSinceReview) {
  const reasons = [];
  if (unmasteredCount) reasons.push(`${unmasteredCount} 道未掌握错题`);
  if (bucket.score) reasons.push(`资料中命中 ${bucket.score} 处线索`);
  if (!completedCount) reasons.push("还没有完成过复盘");
  else if (daysSinceReview !== null && daysSinceReview > 3) reasons.push(`上次复盘在 ${daysSinceReview} 天前`);
  else if (daysSinceReview !== null) reasons.push("最近已复盘，可轻量巩固");
  return reasons.slice(0, 3);
}

function localSummary(course, docs) {
  const sourceText = docs.map((doc) => doc.text).join("\n\n");
  const title = course?.name || "当前科目";

  if (!sourceText.trim()) {
    return `# ${title} 复习提纲\n\n当前资料还没有可用文本。若资料是扫描图片，建议接入图像识别 API 后再生成更准确的总结。`;
  }

  try {
    const courseModel = courseKnowledgeModel(course, docs);
    const mindMap = generateMindMap(courseModel);
    return localStructuredSummary(courseModel, mindMap);
  } catch {
    // Keep the older topic-summary path as a fallback for partially parsed materials.
  }

  const map = buildKnowledgeMap(course, docs);
  const topicBlock = map.topics
    .map((topic) => {
      const conceptLine = topic.concepts.length ? `  - 关键概念：${topic.concepts.join("、")}` : "";
      const formulaLine = topic.formulas.length ? `  - 常用公式：${topic.formulas.map(markdownFormula).join("；")}` : "";
      const checkLine = topic.checks.length ? `  - 复习检查：${topic.checks.join("；")}` : "";
      return `- ${topic.title}\n${[conceptLine, formulaLine, checkLine].filter(Boolean).join("\n")}`;
    })
    .join("\n");
  const relationshipBlock = map.relationships.length
    ? map.relationships.map((item) => `- ${markdownInlineFormulas(item)}`).join("\n")
    : "- 先把概念、公式、适用条件和题型串起来，避免只背孤立结论。";
  const importantBlock = map.important.length
    ? map.important.map((line) => `- ${markdownInlineFormulas(line)}`).join("\n")
    : "- 暂未识别到足够清晰的知识句，建议补充更完整的课件文本。";

  return `# ${title} 期末复习提纲

## 核心考点
${map.keywords.map((word) => `- ${word}`).join("\n") || "- 暂未筛出有足够证据支撑的核心考点。"}

## 知识框架
${topicBlock || "- 先按课件章节整理定义、公式、例题和作业错题。"}

## 概念关系
${relationshipBlock}

## 资料中的高价值片段
${importantBlock}

## 力学题通用解题流程
- ${map.workflow.join("\n- ")}

## 按当前资料推测的重点题型
${detectTopics(sourceText).map((item) => `- ${item}`).join("\n") || "- 受力分析、方程建立、边界条件、单位检查、结果合理性判断。"}

## 易错点
- ${map.pitfalls.join("\n- ")}

## 自测问题
- 这一章最核心的三个定义是什么？各自在哪类题里出现？
- 哪些公式只能在线弹性、小变形或特定支承条件下使用？
- 给一份新题时，你会先画哪张图、列哪几个方程？`;
}

function detectTopics(textValue) {
  const topics = [];
  const add = (condition, label) => {
    if (condition) topics.push(label);
  };
  add(/弯矩|剪力|梁|挠度|惯性矩/.test(textValue), "梁的剪力图/弯矩图、弯曲正应力、挠度与转角计算。");
  add(/轴力|拉压|伸长|胡克|弹性模量/.test(textValue), "轴向拉压杆的应力、应变、变形和强度校核。");
  add(/扭矩|扭转|极惯性矩|剪应力/.test(textValue), "圆轴扭转的剪应力分布、扭转角和刚度条件。");
  add(/主应力|莫尔圆|平面应力|强度理论/.test(textValue), "平面应力状态、主应力、莫尔圆和强度理论判别。");
  add(/压杆|稳定|屈曲|欧拉/.test(textValue), "压杆稳定、临界载荷、长度系数和适用范围。");
  add(/动量|动能|达朗贝尔|振动|固有频率/.test(textValue), "动力学方程、动能定理、达朗贝尔原理和单自由度振动。");
  return topics.slice(0, 8);
}

function localQuiz(course, docs, options = {}) {
  const count = Math.max(3, Math.min(Number(options.count || 8), 30));
  try {
    const structured = generateQuestionSet(courseKnowledgeModel(course, docs), { ...options, count });
    if (structured.questions.length >= count) return structured.questions.slice(0, count);
  } catch {
    // Fall back to the legacy template generator below.
  }
  const selectedTypes = new Set(options.types?.length ? options.types : ["choice", "blank", "short", "calculation"]);
  const sourceText = docs.map((doc) => doc.text).join("\n\n");
  const keywords = extractKeywords(sourceText, 30);
  const important = getImportantSentences(sourceText, keywords, 18);
  const formulas = getFormulaLines(sourceText, 12);
  const sourceDocumentIds = docs.map((doc) => doc.id);
  const buckets = {
    choice: [],
    blank: [],
    short: [],
    calculation: [],
  };

  if (selectedTypes.has("choice")) {
    for (const term of keywords.slice(0, 5)) {
      buckets.choice.push({
        id: id("q"),
        type: "choice",
        difficulty: "基础",
        stem: `关于“${term}”，下面哪一项最适合作为期末复习时的检查点？`,
        options: [
          `能说清它的定义、适用条件，并能和相关公式或受力图联系起来。`,
          "只需要记住这个词出现过，不必理解它在题目中的作用。",
          "所有题目中它的符号、方向和边界条件都可以默认相同。",
          "计算时可以忽略单位和正负号，只要数值看起来合理即可。",
        ],
        answer: "A",
        explanation: "力学复习不能只背名词，要把概念、适用条件、方程和题型连接起来。",
        sourceDocumentIds,
      });
    }
  }

  if (selectedTypes.has("blank")) {
    for (const formula of formulas.slice(0, 5)) {
      const blank = makeBlank(formula);
      buckets.blank.push({
        id: id("q"),
        type: "blank",
        difficulty: "基础",
        stem: blank.stem,
        answer: blank.answer,
        explanation: `原资料中的相关表达是：${formula}`,
        sourceDocumentIds,
      });
    }
  }

  if (selectedTypes.has("short")) {
    for (const sentence of important.slice(0, 6)) {
      const term = keywords.find((word) => sentence.includes(word)) || "该知识点";
      buckets.short.push({
        id: id("q"),
        type: "short",
        difficulty: "中等",
        stem: `简答：结合课件内容，说明“${term}”在解题中的作用，并写出使用时需要检查的条件。`,
        answer: sentence,
        explanation: "答题时建议按“定义/公式、适用条件、典型题型、易错点”的顺序组织。",
        sourceDocumentIds,
      });
    }
  }

  if (selectedTypes.has("calculation")) {
    buckets.calculation.push(...mechanicsTemplates(sourceText, sourceDocumentIds));
  }

  const order = ["calculation", "choice", "blank", "short"].filter((type) => selectedTypes.has(type));
  const questions = [];
  while (questions.length < count && order.some((type) => buckets[type].length)) {
    for (const type of order) {
      const next = buckets[type].shift();
      if (next) questions.push(next);
      if (questions.length >= count) break;
    }
  }

  while (questions.length < count) {
    questions.push({
      id: id("q"),
      type: "short",
      difficulty: "中等",
      stem: `综合复习：从“${keywords[questions.length % Math.max(keywords.length, 1)] || course?.name || "本章"}”出发，整理一道典型题的解题步骤。`,
      answer: "建议包括：研究对象、受力/变形关系、基本方程、边界条件、计算与校核。",
      explanation: "这是通用复盘题，适合在资料文本不足时训练解题流程。",
      sourceDocumentIds,
    });
  }

  return questions.slice(0, count);
}

function makeBlank(line) {
  const equalIndex = line.indexOf("=");
  if (equalIndex > 0 && equalIndex < line.length - 1) {
    const left = wrapInlineFormula(line.slice(0, equalIndex + 1)) || line.slice(0, equalIndex + 1);
    const right = wrapInlineFormula(line.slice(equalIndex + 1).trim()) || line.slice(equalIndex + 1).trim();
    return {
      stem: `填空：补全关系式：${left} ____`,
      answer: right,
    };
  }
  for (const term of MECH_TERMS) {
    if (line.includes(term)) {
      return {
        stem: `填空：${line.replace(term, "____")}`,
        answer: term,
      };
    }
  }
  return {
    stem: `填空：写出下列表达式中的关键物理量或条件：${line}`,
    answer: line,
  };
}

function mechanicsTemplates(textValue, sourceDocumentIds) {
  const templates = [];
  const push = (condition, question) => {
    if (condition) templates.push({ id: id("q"), ...question, sourceDocumentIds });
  };
  push(/弯矩|剪力|梁|挠度|惯性矩/.test(textValue), {
    type: "calculation",
    difficulty: "中等",
    stem: "计算题：简支梁跨度为 L，跨中作用集中力 P。写出最大弯矩，并说明若截面惯性矩为 I、最外缘到中性轴距离为 y，最大弯曲正应力如何表示。",
    answer: `最大弯矩 ${wrapInlineFormula("Mmax = P L / 4")}；最大弯曲正应力 ${wrapInlineFormula("sigma_max = Mmax y / I")}。`,
    explanation: "先由支反力和平衡方程得到弯矩分布，再用弯曲正应力公式。注意该结果对应跨中集中力和简支边界。",
  });
  push(/轴力|拉压|伸长|胡克|弹性模量/.test(textValue), {
    type: "calculation",
    difficulty: "基础",
    stem: "计算题：等截面直杆长度 L、面积 A、弹性模量 E，受轴向拉力 F。求正应力、应变和轴向伸长量。",
    answer: `${wrapInlineFormula("sigma = F / A")}；${wrapInlineFormula("epsilon = sigma / E")}；${wrapInlineFormula("Delta L = F L / (E A)")}。`,
    explanation: "这是轴向拉压的基本链条：内力到应力，应力到应变，再由几何关系得到变形。",
  });
  push(/扭矩|扭转|极惯性矩|剪应力/.test(textValue), {
    type: "calculation",
    difficulty: "中等",
    stem: "计算题：圆轴承受扭矩 T，极惯性矩 J，半径 r 处的剪应力如何表示？若长度为 L、剪切模量为 G，扭转角如何表示？",
    answer: `${wrapInlineFormula("tau = T r / J")}；扭转角 ${wrapInlineFormula("phi = T L / (G J)")}。`,
    explanation: "适用于圆轴线弹性扭转。最大剪应力出现在外表面 r = R。",
  });
  push(/主应力|莫尔圆|平面应力|强度理论/.test(textValue), {
    type: "calculation",
    difficulty: "提高",
    stem: "计算题：平面应力状态已知 sigma_x、sigma_y、tau_xy。写出两个主应力的表达式。",
    answer: `${wrapInlineFormula("sigma_1,2 = (sigma_x + sigma_y)/2 ± sqrt(((sigma_x - sigma_y)/2)^2 + tau_xy^2)")}。`,
    explanation: "这是平面应力变换的标准结果，也可由莫尔圆的圆心和半径得到。",
  });
  push(/压杆|稳定|屈曲|欧拉/.test(textValue), {
    type: "calculation",
    difficulty: "中等",
    stem: "计算题：细长压杆弹性模量 E、截面惯性矩 I、计算长度 l0。写出欧拉临界载荷，并说明适用前提。",
    answer: `${wrapInlineFormula("Pcr = pi^2 E I / l0^2")}。适用于细长压杆、线弹性、小挠度、理想中心受压等条件。`,
    explanation: "计算长度 l0 与端部约束有关，不能直接把实际长度当成计算长度。",
  });
  push(/振动|固有频率|阻尼|弹簧/.test(textValue), {
    type: "calculation",
    difficulty: "基础",
    stem: "计算题：单自由度无阻尼系统质量 m、刚度 k。写出固有圆频率和固有频率。",
    answer: `${wrapInlineFormula("omega_n = sqrt(k/m)")}；${wrapInlineFormula("f_n = omega_n / (2 pi)")}。`,
    explanation: "先建立 m x'' + k x = 0，再由特征方程得到固有圆频率。",
  });

  if (!templates.length) {
    templates.push({
      id: id("q"),
      type: "calculation",
      difficulty: "中等",
      stem: "计算题：选取一道课件或作业中的典型力学题，按“研究对象、受力图、方程、边界条件、校核”五步写出完整解法框架。",
      answer: "完整答案应包含清晰研究对象、必要图示说明、独立方程、边界/初始条件、单位和结果合理性检查。",
      explanation: "当资料还不够结构化时，先训练稳定的解题流程比强行套公式更有效。",
      sourceDocumentIds,
    });
  }
  return templates;
}

function localSimilarQuestions(mistake, docs, count = 4) {
  const mistakeText = [
    mistake.question,
    mistake.answer,
    mistake.explanation,
  ].join("\n\n");
  const baseDocs = [
    {
      id: "mistake_context",
      originalName: "错题上下文",
      text: mistakeText,
      units: [{ label: "错题", text: mistakeText }],
    },
    ...docs,
  ];
  const candidates = localQuiz(
    { name: "错题变式" },
    baseDocs,
    {
      count: Math.max(count + 3, 8),
      types: ["calculation", "short", "blank"],
    },
  );
  const normalizedQuestion = normalizeText(mistake.question).slice(0, 80);
  return candidates
    .filter((question) => !normalizeText(question.stem).includes(normalizedQuestion))
    .slice(0, count)
    .map((question) => ({
      ...question,
      stem: `同类题：${question.stem.replace(/^同类题：/, "")}`,
      sourceDocumentIds: docs.map((doc) => doc.id),
      sourceMistakeId: mistake.id,
    }));
}

function apiRoleLabel(courseModel = {}, course = {}) {
  const profileLabel = courseModel?.course?.focus_profile?.label || "";
  const courseName = course?.name || courseModel?.course?.name || "理工科课程";
  return `${courseName}${profileLabel ? `（${profileLabel}）` : ""}`;
}

function apiCourseLabel(course = {}) {
  return `${course?.name || "当前科目"} STEM 期末复习`;
}

function compactSourceRef(ref = {}) {
  const label = sourceRefDisplayLabel(ref);
  const parts = [ref.file_name, label, ref.excerpt || ref.anchor_text].filter(Boolean);
  return clampText(parts.join(" / "), 150);
}

function cleanKnownText(value, fallback = "") {
  const textValue = cleanStudyText(value);
  return textValue && textValue !== "unknown" ? textValue : fallback;
}

function cleanApiSourceRefs(sourceRefs = [], limit = 3) {
  return (sourceRefs || []).slice(0, limit).map((ref) => ({
    document_id: ref.document_id || ref.documentId || "",
    file_name: ref.file_name || ref.fileName || "",
    unit_index: Number.isInteger(ref.unit_index) ? ref.unit_index : Number.isInteger(ref.unitIndex) ? ref.unitIndex : 0,
    unit_label: ref.unit_label || ref.unitLabel || "",
    slide_number: ref.slide_number || ref.slideNumber || null,
    page_number: ref.page_number || ref.pageNumber || null,
    locator_type: ref.locator_type || ref.locatorType || "unit",
    anchor_label: ref.anchor_label || ref.anchorLabel || "",
    excerpt: clampText(ref.excerpt || ref.anchor_text || "", 120),
  }));
}

function uniqueBySourceRef(refs = []) {
  const seen = new Set();
  return refs.filter((ref) => {
    const key = `${ref.document_id || ""}:${ref.unit_index ?? ""}:${ref.excerpt || ref.anchor_text || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectApiEvidence(courseModel = {}, docs = [], limit = 10) {
  const refs = [
    ...(courseModel.chapters || []).flatMap((item) => item.source_refs || []),
    ...(courseModel.formulas || []).flatMap((item) => item.source_refs || []),
    ...(courseModel.examples || []).flatMap((item) => item.source_refs || []),
    ...(courseModel.homework_problems || []).flatMap((item) => item.source_refs || []),
    ...(courseModel.mistake_points || []).flatMap((item) => item.source_refs || []),
    ...(courseModel.learning_pack?.source_refs || []),
  ];
  const fromRefs = uniqueBySourceRef(refs).slice(0, limit).map((ref) => ({
    label: `${ref.file_name || "资料"} / ${sourceRefDisplayLabel(ref)}`,
    source_refs: cleanApiSourceRefs([ref], 1),
    excerpt: clampText(ref.excerpt || ref.anchor_text || "", 180),
  }));
  if (fromRefs.length >= Math.min(4, limit)) return fromRefs;
  return docs
    .flatMap((doc) => (doc.units?.length ? doc.units : [{ label: "全文", text: doc.text }]).map((unit, index) => ({ doc, unit, index })))
    .map(({ doc, unit, index }) => ({
      label: `${doc.originalName || "资料"} / ${unit.label || "全文"}`,
      source_refs: cleanApiSourceRefs([makeUnitSourceRef(doc, unit, index, unit.text || "", "medium")], 1),
      excerpt: clampText(getImportantSentences(unit.text || "", extractKeywords(unit.text || "", 8), 1)[0] || unit.text || "", 180),
    }))
    .filter((item) => item.excerpt)
    .slice(0, limit);
}

function apiLearningPackSummary(learningPack = {}, options = {}) {
  if (!learningPack || !Object.keys(learningPack).length) return null;
  return {
    summary_text: learningPackContext(learningPack, {
      conceptLimit: Math.min(10, options.concepts ?? options.conceptLimit ?? 10),
      formulaLimit: Math.min(8, options.formulas ?? options.formulaLimit ?? 8),
      problemLimit: Math.min(8, options.problems ?? options.problemLimit ?? 8),
      pitfallLimit: Math.min(8, options.mistakes ?? options.mistakeLimit ?? 8),
      drillLimit: 8,
    }),
    concepts: (learningPack.concepts || []).slice(0, 10).map((item) => ({
      name: item.name,
      priority: item.priority || item.score || 0,
      source_refs: cleanApiSourceRefs(item.source_refs || [], 2),
    })),
    formulas: (learningPack.formulas || []).slice(0, 8).map((item) => ({
      name: item.name || "公式",
      expression: wrapInlineFormula(item.expression) || item.expression || "",
      conditions: cleanKnownText(item.applicable_conditions || item.conditions, "回到来源页核对适用条件"),
      source_refs: cleanApiSourceRefs(item.source_refs || [], 2),
    })),
    problem_templates: (learningPack.problem_templates || []).slice(0, 8),
    pitfalls: (learningPack.pitfalls || []).slice(0, 8),
    drill_templates: (learningPack.drill_templates || []).slice(0, 8),
  };
}

function buildApiStudyContext(courseModel = {}, docs = [], options = {}) {
  const limit = {
    chapters: options.chapters ?? options.chapterLimit ?? 8,
    concepts: options.concepts ?? options.conceptLimit ?? 14,
    formulas: options.formulas ?? options.formulaLimit ?? 10,
    problems: options.problems ?? options.problemLimit ?? 8,
    mistakes: options.mistakes ?? options.mistakeLimit ?? 8,
    evidence: options.evidence ?? 10,
  };
  const chapters = [...(courseModel.chapters || [])]
    .sort((a, b) => Number(b.exam_focus?.score || 0) - Number(a.exam_focus?.score || 0))
    .slice(0, limit.chapters)
    .map((chapter) => ({
      id: chapter.chapter_id,
      title: summaryChapterTitle(chapter),
      difficulty: chapter.difficulty || "medium",
      exam_focus: chapter.exam_focus || {},
      source_refs: cleanApiSourceRefs(chapter.source_refs || [], 2),
    }));
  const concepts = [...(courseModel.concepts || [])]
    .map((concept) => ({ ...concept, summary_score: summaryConceptScore(concept, courseModel) }))
    .sort((a, b) => Number(b.summary_score || 0) - Number(a.summary_score || 0))
    .slice(0, limit.concepts)
    .map((concept) => ({
      name: concept.name,
      chapter_id: concept.chapter_id,
      description: clampText(concept.description || concept.source_refs?.[0]?.excerpt || "", 120),
      score: Number(concept.summary_score || concept.importance_score || 0),
      evidence: summarySelectionReasons(concept),
      source_refs: cleanApiSourceRefs(concept.source_refs || [], 2),
    }));
  const formulas = [...(courseModel.formulas || [])]
    .sort((a, b) => Number(b.exam_focus?.score || 0) - Number(a.exam_focus?.score || 0))
    .slice(0, limit.formulas)
    .map((formula) => ({
      name: formula.name || "公式",
      expression: wrapInlineFormula(formula.expression) || formula.expression,
      chapter_id: formula.chapter_id,
      conditions: cleanKnownText(formula.applicable_conditions, "回到来源页核对适用条件"),
      common_misuses: (formula.common_misuses || []).filter((item) => item && item !== "unknown").slice(0, 3),
      verification_status: formula.verification_status || formula.verification?.status || "unverified",
      source_refs: cleanApiSourceRefs(formula.source_refs || [], 2),
    }));
  const problems = [...(courseModel.examples || []), ...(courseModel.homework_problems || [])]
    .slice(0, limit.problems)
    .map((problem) => ({
      title: problem.title || problem.problem_number || "题目",
      type: problem.example_id ? "example" : "homework",
      text: clampText(problem.problem_text || "", 180),
      related_concepts: (problem.related_concepts || []).slice(0, 5),
      source_refs: cleanApiSourceRefs(problem.source_refs || [], 2),
    }));
  const mistakes = [...(courseModel.mistake_points || [])]
    .sort((a, b) => Number(b.selection_score || 0) - Number(a.selection_score || 0))
    .slice(0, limit.mistakes)
    .map((mistake) => ({
      description: mistake.description,
      severity: mistake.severity || "medium",
      related_concepts: (mistake.related_concepts || []).slice(0, 5),
      source_refs: cleanApiSourceRefs(mistake.source_refs || [], 2),
    }));
  const parseQuality = {
    documents: (courseModel.documents || []).map((doc) => ({
      file_name: doc.file_name,
      type: doc.document_type,
      unit_count: doc.unit_count,
      quality: doc.parse_quality?.level || "",
      score: doc.parse_quality?.score || 0,
      counts: doc.parse_quality?.counts || {},
      warnings: doc.parse_quality?.warnings || [],
    })),
    warnings: courseModel.warnings || [],
  };
  const context = {
    course: courseModel.course || {},
    course_label: apiCourseLabel(courseModel.course || {}),
    stats: courseModel.stats || {},
    exam_focus: courseModel.exam_focus || {},
    parse_quality: parseQuality,
    learning_pack: apiLearningPackSummary(courseModel.learning_pack, limit),
    chapters,
    concepts,
    formulas,
    problems,
    mistakes,
    evidence: collectApiEvidence(courseModel, docs, limit.evidence),
  };
  return truncateForModel(JSON.stringify(context, null, 2), options.maxChars || 42000);
}

function buildApiQuestionSeedContext(courseModel = {}, localQuestions = [], options = {}) {
  const seeds = localQuestions.slice(0, options.limit || 12).map((question, indexValue) => {
    const refs = (question.sourceRefs || question.source_refs || [])
      .concat((question.sourceDocumentIds || []).map((documentId) => ({ document_id: documentId })))
      .slice(0, 2)
      .map(compactSourceRef)
      .filter(Boolean);
    return [
      `${indexValue + 1}. type=${question.type || "short"} difficulty=${question.difficulty || "中等"}`,
      `题干：${clampText(question.stem || question.question_text || "", 180)}`,
      `答案：${clampText(question.answer || "", 120)}`,
      question.explanation ? `解析要点：${clampText(question.explanation, 140)}` : "",
      refs.length ? `来源：${refs.join("；")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  const formulaHints = (courseModel.formulas || [])
    .slice(0, 8)
    .map((formula) => `${formula.name || "公式"} ${wrapInlineFormula(formula.expression) || formula.expression}`)
    .join("；");
  return [`## 本地候选题骨架\n${seeds.join("\n\n") || "暂无"}`, formulaHints ? `## 优先覆盖公式\n${formulaHints}` : ""].filter(Boolean).join("\n\n");
}

function buildApiMistakeContext(courseModel = {}, mistake = {}, docs = []) {
  const relatedUnits = retrieveContext(docs, [mistake.question, mistake.answer, mistake.explanation].filter(Boolean).join("\n"), 6)
    .filter((item) => item.score > 0)
    .map((item) => `- ${item.doc.originalName} / ${item.label}：${clampText(item.text, 180)}`);
  const concepts = selectSummaryConcepts(courseModel, 8).map((concept) => concept.name).join("、");
  return [
    `错题：${clampText(mistake.question, 420)}`,
    `参考答案：${clampText(mistake.answer, 260)}`,
    `解析/错因：${clampText(mistake.explanation || "无", 260)}`,
    concepts ? `相关考点：${concepts}` : "",
    relatedUnits.length ? `相关资料片段：\n${relatedUnits.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function apiSimilarQuestions(db, course, mistake, docs, count) {
  const courseModel = courseKnowledgeModel(course || { name: "错题变式" }, docs);
  const localSeeds = localSimilarQuestions(mistake, docs, Math.max(count + 2, 6));
  const context = buildApiStudyContext(courseModel, docs, { maxChars: 26000, concepts: 8, formulas: 8, problems: 6, mistakes: 6, evidence: 6 });
  const mistakeContext = buildApiMistakeContext(courseModel, mistake, docs);
  const seedContext = buildApiQuestionSeedContext(courseModel, localSeeds, { limit: 8 });
  const content = await callChatApi(
    db.settings,
    [
      {
        role: "system",
        content:
          '你是 STEM 期末命题助教。根据错题和结构化课件资料生成同类型变式题。只输出 JSON 对象，格式为 {"questions": [...]}，不要输出 Markdown。题目必须服务于考前复习，避免空泛概念题。',
      },
      {
        role: "user",
        content: `科目：${course?.name || "未命名科目"}
题目数量：${count}

错题：
- 问题：${mistake.question}
- 参考答案：${mistake.answer}
- 解析：${mistake.explanation || "无"}

每道题字段：type, difficulty, stem, options, answer, explanation。options 没有则用空数组。
要求：
- 保留同类题的解题入口，但更换数字、条件或问法。
- 至少生成 1 道与原错因相反或更深一层的变式题。
- 解析必须说明第一步入口、公式适用条件或常见扣分点。

结构化资料与本地题目种子：
${context}

错题近邻上下文：
${mistakeContext}

本地候选题骨架：
${seedContext}`,
      },
    ],
    { type: "json_object" },
  );
  const parsed = parseJsonFromModel(content);
  const list = Array.isArray(parsed) ? parsed : parsed.questions;
  if (!Array.isArray(list)) throw new Error("API 返回的同类题 JSON 格式不符合预期。");
  return normalizeApiQuestionList(list, localSeeds, { count }).map((question) => ({
    ...question,
    id: question.id || id("q"),
    question_id: question.question_id || question.id || id("q"),
    sourceDocumentIds: question.sourceDocumentIds?.length ? question.sourceDocumentIds : docs.map((doc) => doc.id),
    sourceMistakeId: mistake.id,
  }));
}

function selectDocs(db, body) {
  const byCourse = db.documents.filter((doc) => doc.courseId === body.courseId);
  const wanted = new Set(body.documentIds || []);
  return wanted.size ? byCourse.filter((doc) => wanted.has(doc.id)) : byCourse;
}

function truncateForModel(textValue, maxChars = 70000) {
  if (textValue.length <= maxChars) return textValue;
  return `${textValue.slice(0, Math.floor(maxChars * 0.7))}\n\n[中间内容已截断]\n\n${textValue.slice(-Math.floor(maxChars * 0.3))}`;
}

function normalizeApiBaseUrl(apiBaseUrl) {
  const value = String(apiBaseUrl || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  return value.replace(/\/chat\/completions$/, "");
}

function apiRequestUrl(settings, endpoint) {
  const base = normalizeApiBaseUrl(settings.apiBaseUrl);
  if (!base) throw new Error("请先填写 API Base URL。");
  return `${base}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

function resolveApiSettings(currentSettings = {}, body = {}) {
  const clearApiKey = Boolean(body.clearApiKey);
  const apiKey =
    clearApiKey
      ? ""
      : typeof body.apiKey === "string" && body.apiKey.trim()
        ? body.apiKey.trim()
        : currentSettings.apiKey || "";
  const hasApiBaseUrl = Object.prototype.hasOwnProperty.call(body, "apiBaseUrl");
  const hasModel = Object.prototype.hasOwnProperty.call(body, "model");
  return {
    provider: body.provider === "api" ? "api" : currentSettings.provider || "local",
    apiBaseUrl: hasApiBaseUrl ? normalizeApiBaseUrl(body.apiBaseUrl) : normalizeApiBaseUrl(currentSettings.apiBaseUrl),
    apiKey,
    model: hasModel ? String(body.model || "").trim() : String(currentSettings.model || "").trim(),
  };
}

async function fetchJsonFromApi(settings, endpoint, options = {}) {
  if (!settings.apiKey) throw new Error("请先填写 API Key。");
  const url = apiRequestUrl(settings, endpoint);
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.apiKey}`,
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    throw new Error(`API 连接失败：${error.cause?.message || error.message || "无法连接到服务"}`);
  }
  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || raw.slice(0, 300) || response.statusText;
    throw new Error(`API 请求失败：${response.status} ${detail}`);
  }
  return data || {};
}

function normalizeModelList(data) {
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return list
    .map((item) => (typeof item === "string" ? { id: item } : item))
    .filter((item) => item && typeof item.id === "string" && item.id.trim())
    .map((item) => ({
      id: item.id.trim(),
      ownedBy: item.owned_by || item.owner || "",
      created: item.created || null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function listApiModels(settings) {
  return normalizeModelList(await fetchJsonFromApi(settings, "/models", { method: "GET" }));
}

async function testApiConnection(settings) {
  if (!settings.model) throw new Error("请先选择模型。");
  await callChatApi(
    settings,
    [
      { role: "system", content: "You are an API connectivity tester. Reply with OK only." },
      { role: "user", content: "ping" },
    ],
    null,
    { maxTokens: 8, temperature: 0 },
  );
  return true;
}

function apiCacheKey(settings, messages, responseFormat) {
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        base: settings.apiBaseUrl,
        model: settings.model,
        messages,
        responseFormat,
      }),
    )
    .digest("hex");
}

function cachedApiResponse(key) {
  const hit = apiResponseCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.createdAt > API_CACHE_TTL_MS) {
    apiResponseCache.delete(key);
    return null;
  }
  return hit.content;
}

function storeApiResponse(key, content) {
  apiResponseCache.set(key, { content, createdAt: Date.now() });
  while (apiResponseCache.size > API_CACHE_LIMIT) {
    const oldestKey = apiResponseCache.keys().next().value;
    apiResponseCache.delete(oldestKey);
  }
}

async function callChatApi(settings, messages, responseFormat, options = {}) {
  if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
    throw new Error("请先在设置中填写 API Base URL、模型名和 API Key。");
  }
  const url = apiRequestUrl(settings, "/chat/completions");
  const key = options.cache !== false ? apiCacheKey(settings, messages, responseFormat) : "";
  if (key) {
    const cached = cachedApiResponse(key);
    if (cached !== null) return cached;
  }
  const body = {
    model: settings.model,
    messages,
    temperature: options.temperature ?? 0.2,
  };
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  if (responseFormat) body.response_format = responseFormat;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || API_TIMEOUT_MS));
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`API 请求失败：${response.status} ${raw.slice(0, 300)}`);
    }
    const data = JSON.parse(raw);
    const content = data.choices?.[0]?.message?.content || "";
    if (key && content) storeApiResponse(key, content);
    return content;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("API 请求超时，已切回本地结果。");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function apiSummary(db, courseModel, docs, mindMap) {
  const compactContext = truncateForModel(
    buildApiStudyContext(courseModel, docs, { conceptLimit: 16, formulaLimit: 14, problemLimit: 12, mistakeLimit: 10 }),
    22000,
  );
  const localOutline = truncateForModel(localStructuredSummary(courseModel, mindMap), 9000);
  return callChatApi(db.settings, [
    {
      role: "system",
      content:
        "你是 STEM 期末复习助教。请用中文输出严谨、可考试复习的 Markdown，强调定义、公式适用条件、典型题型、易错点。公式统一使用 `$...$` 包裹的类 LaTeX 形式。不要堆砌原文，优先输出高价值复习决策。",
    },
    {
      role: "user",
      content: `科目：${courseModel.course?.name || "未命名科目"}
本地图谱规模：${mindMap?.stats?.nodes || 0} 个节点 / ${mindMap?.stats?.edges || 0} 条关系。

请生成一份能帮助我理解 PPT 的复习总结，固定包含：
1. 核心考点清单：按考试价值排序，每点说明为什么重要、来源页/页码线索。
2. 重难点拆解：说明难在哪里、先理解什么、容易和什么混淆。
3. 公式与适用条件：不要只列公式，必须写变量含义、适用前提、常见误用。
4. 典型题型入口：把 PPT 中的例题/作业抽象成题型和第一步解题动作。
5. 易错/扣分点：转化成考场检查清单。
6. 考前自测：给 6-8 个短问题，覆盖概念、公式条件、计算入口和错因诊断。
7. 资料不足提醒：如果资料显示公式/例题不足，明确提示可能是图片型 PPT 或解析不足。

结构化证据：
${compactContext}

本地提纲草稿（可优化但不要丢失证据）：
${localOutline}`,
    },
  ]);
}

async function apiQuiz(db, courseModel, docs, body, localResult) {
  const count = Math.max(3, Math.min(Number(body.count || 8), 20));
  const compactContext = truncateForModel(
    buildApiStudyContext(courseModel, docs, { conceptLimit: 12, formulaLimit: 10, problemLimit: 8, mistakeLimit: 8 }),
    16000,
  );
  const seedContext = truncateForModel(buildApiQuestionSeedContext(courseModel, localResult.questions, { limit: 12 }), 9000);
  const content = await callChatApi(
    db.settings,
    [
      {
        role: "system",
        content:
          '你是 STEM 期末命题助教。只输出 JSON 对象，格式为 {"questions": [...]}，不要输出 Markdown。题目必须围绕给定考点、公式适用条件、例题/作业题型和易错点生成。',
      },
      {
        role: "user",
        content: `科目：${courseModel.course?.name || "未命名科目"}
题目数量：${count}
题型偏好：${(body.types || []).join(", ") || "choice, blank, short, calculation"}
难度：${body.difficulty || "混合"}

每道题字段：type, difficulty, stem, options, answer, explanation。options 没有则用空数组。
要求：
- 至少包含 1 道公式适用条件题、1 道计算题、1 道错因诊断题；资料足够时包含综合题。
- 题目要像课件/作业同类型题，不要生成泛泛背诵题。
- 解析要说明第一步为什么这样做，以及常见扣分点。
- 如果某题基于公式，必须写公式适用条件，不要只给代入结果。

结构化证据：
${compactContext}

本地候选题骨架（可参考题型，不要逐字照抄）：
${seedContext}`,
      },
    ],
    { type: "json_object" },
  );
  const parsed = parseJsonFromModel(content);
  const list = Array.isArray(parsed) ? parsed : parsed.questions;
  if (!Array.isArray(list)) throw new Error("API 返回的题目 JSON 格式不符合预期。");
  const sourceDocumentIds = docs.map((doc) => doc.id);
  return normalizeApiQuestionList(list, localResult.questions, { count }).map((question, indexValue) => ({
    ...question,
    id: question.id || id("q"),
    question_id: question.question_id || question.id || id("q"),
    sourceDocumentIds: question.sourceDocumentIds?.length ? question.sourceDocumentIds : sourceDocumentIds,
    sourceRefs: question.sourceRefs?.length ? question.sourceRefs : localResult.questions[indexValue]?.sourceRefs || localResult.questions[indexValue]?.source_refs || localResult.questions[0]?.sourceRefs || [],
  }));
}

function parseJsonFromModel(content) {
  const trimmed = String(content || "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const direct = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(direct);
  } catch {
    const candidate = extractJsonCandidate(direct);
    if (candidate) return JSON.parse(candidate);
    throw new Error("API 返回内容不是可解析的 JSON。");
  }
}

function extractJsonCandidate(value) {
  const textValue = String(value || "");
  const starts = [textValue.indexOf("{"), textValue.indexOf("[")].filter((index) => index >= 0).sort((a, b) => a - b);
  for (const start of starts) {
    const open = textValue[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < textValue.length; index += 1) {
      const char = textValue[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === open) depth += 1;
      else if (char === close) {
        depth -= 1;
        if (depth === 0) return textValue.slice(start, index + 1);
      }
    }
  }
  return "";
}

async function apiAsk(db, course, docs, question) {
  const context = retrieveContext(docs, question, 10)
    .map((item) => `【${item.doc.originalName} / ${item.label}】\n${item.text}`)
    .join("\n\n");
  if (db.settings.provider === "api" && db.settings.apiKey) {
    const courseModel = courseKnowledgeModel(course, docs);
    const studyContext = buildApiStudyContext(courseModel, docs, { conceptLimit: 8, formulaLimit: 8, problemLimit: 6, mistakeLimit: 4 });
    return callChatApi(db.settings, [
      {
        role: "system",
        content: "你是 STEM 期末复习助教。只能基于给定资料回答；资料不足时要明确说明。回答要短、直接、面向考试复习。",
      },
      {
        role: "user",
        content: `科目：${course?.name || "未命名科目"}\n问题：${question}\n\n结构化复习上下文：\n${truncateForModel(studyContext, 9000)}\n\n检索到的原文片段：\n${truncateForModel(context, 9000)}`,
      },
    ]);
  }
  return localAnswer(docs, question);
}

function retrieveContext(docs, question, limit = 8) {
  const queryTokens = new Set([...extractKeywords(question, 12), ...question.split(/\s+/).filter(Boolean)]);
  const ranked = [];
  for (const doc of docs) {
    const units = doc.units?.length ? doc.units : [{ label: "全文", text: doc.text }];
    for (const unit of units) {
      const score = [...queryTokens].reduce((sum, token) => sum + (unit.text.includes(token) ? 1 : 0), 0);
      pushTopByScore(ranked, { doc, label: unit.label, text: unit.text.slice(0, 1600), score }, limit, (item) => item.score);
    }
  }
  return ranked;
}

function localAnswer(docs, question) {
  const related = retrieveContext(docs, question, 8);
  const snippets = related
    .filter((item) => item.score > 0)
    .map((item) => `- ${item.doc.originalName} / ${item.label}：${item.text.slice(0, 180)}...`)
    .join("\n");
  if (!snippets) {
    return "本地模式没有找到明显相关片段。你可以换一个关键词，或在设置中接入 API 后获得更强的问答能力。";
  }
  return `本地检索到这些相关片段：\n\n${snippets}\n\n建议你围绕这些片段检查定义、公式适用条件和典型题型。`;
}

function buildApiSolutionContext(courseModel, docs, question, localSolution) {
  const studyContext = buildApiStudyContext(courseModel, docs, { conceptLimit: 10, formulaLimit: 8, problemLimit: 6, mistakeLimit: 6 });
  const relatedUnits = retrieveContext(docs, question, 8)
    .filter((item) => item.score > 0)
    .map((item) => `- ${item.doc.originalName} / ${item.label}：${clampText(item.text, 260)}`);
  const localDraft = [
    `本地题目标题：${localSolution.title}`,
    `本地方法入口：${localSolution.method}`,
    localSolution.formulaHints?.length ? `公式候选：${localSolution.formulaHints.join("；")}` : "",
    localSolution.relatedConcepts?.length ? `相关考点：${localSolution.relatedConcepts.join("、")}` : "",
    `本地答案草稿：${localSolution.answer}`,
  ]
    .filter(Boolean)
    .join("\n");
  return truncateForModel(
    [
      `题目：${question}`,
      "## 结构化复习上下文",
      studyContext,
      relatedUnits.length ? `## 检索到的资料片段\n${relatedUnits.join("\n")}` : "",
      `## 本地解题草稿\n${localDraft}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    18000,
  );
}

async function apiSolveQuestion(db, course, docs, body) {
  const courseModel = courseKnowledgeModel(course, docs);
  const localSolution = localSolveQuestion(course, docs, body, courseModel);
  if (!(db.settings.provider === "api" && db.settings.apiKey)) {
    return { courseModel, solution: localSolution };
  }
  const question = String(body.question || "").trim();
  const content = await callChatApi(
    db.settings,
    [
      {
        role: "system",
        content:
          '你是严谨的 STEM 期末解题助教。只输出 JSON 对象，不要输出 Markdown。必须基于题目和资料证据，给出可复习的完整解法。JSON 字段：title, subject, question, knowns, target, relatedConcepts, formulaHints, method, steps, answer, commonMistakes, reviewCards, similarDrillPrompt。steps 为数组，每项含 title/detail/formula；reviewCards 为数组，每项含 type/title/body。公式用类 LaTeX 字符串。',
      },
      {
        role: "user",
        content: `科目：${course?.name || "未命名科目"}\n\n请生成高质量解题结果。要求：1. 先解释题型入口；2. 步骤完整但不堆砌；3. 明确最终答案或在条件不足时说明缺少什么；4. 生成可固化到期末复习记忆的 reviewCards；5. 不编造资料中不存在的来源。\n\n${buildApiSolutionContext(courseModel, docs, question, localSolution)}`,
      },
    ],
    { type: "json_object" },
    { cache: false, timeoutMs: 60000 },
  );
  const parsed = parseJsonFromModel(content);
  return {
    courseModel,
    solution: normalizeSolution(parsed, {
      ...localSolution,
      provider: "api",
      id: id("solution"),
    }),
  };
}

async function handleApi(req, res, pathname) {
  const db = await readDb();

  if (req.method === "GET" && pathname === "/api/state") {
    const migrated = workspaceService.migrateWorkspace(db);
    if (migrated) await writeDb(db);
    return json(res, 200, publicState(db));
  }

  if (req.method === "POST" && pathname === "/api/courses") {
    const body = await readJson(req);
    const name = String(body.name || "").trim();
    if (!name) return json(res, 400, { error: "科目名称不能为空。" });
    const course = { id: id("course"), name, createdAt: now(), updatedAt: now() };
    db.courses.push(course);
    await writeDb(db);
    return json(res, 200, { course, state: publicState(db) });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/courses/")) {
    const courseId = decodeURIComponent(pathname.split("/").pop() || "");
    const body = await readJson(req);
    const course = db.courses.find((item) => item.id === courseId);
    if (!course) return json(res, 404, { error: "没有找到该科目。" });
    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      const name = String(body.name || "").trim();
      if (!name) return json(res, 400, { error: "科目名称不能为空。" });
      course.name = name;
    }
    course.updatedAt = now();
    await writeDb(db);
    return json(res, 200, { course, state: publicState(db) });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/courses/")) {
    const courseId = decodeURIComponent(pathname.split("/").pop() || "");
    const courseIndex = db.courses.findIndex((item) => item.id === courseId);
    if (courseIndex === -1) return json(res, 404, { error: "没有找到该科目。" });

    const courseDocs = db.documents.filter((doc) => doc.courseId === courseId);
    const mistakeCount = db.mistakes.filter((mistake) => mistake.courseId === courseId).length;
    const sessionCount = db.sessions.filter((session) => session.courseId === courseId).length;
    for (const doc of courseDocs) await deleteStoredDocumentFile(doc);

    const [course] = db.courses.splice(courseIndex, 1);
    db.documents = db.documents.filter((doc) => doc.courseId !== courseId);
    db.mistakes = db.mistakes.filter((mistake) => mistake.courseId !== courseId);
    db.sessions = db.sessions.filter((session) => session.courseId !== courseId);
    db.solvedQuestions = (db.solvedQuestions || []).filter((item) => item.courseId !== courseId);
    await writeDb(db);
    return json(res, 200, {
      courseId,
      deleted: {
        documents: courseDocs.length,
        mistakes: mistakeCount,
        sessions: sessionCount,
      },
      course,
      state: publicState(db),
    });
  }

  if (req.method === "POST" && pathname === "/api/upload") {
    const body = await readBody(req);
    const { fields, files } = parseMultipart(body, req.headers["content-type"]);
    let courseId = fields.courseId;
    if (!courseId && fields.courseName?.trim()) {
      const course = {
        id: id("course"),
        name: fields.courseName.trim(),
        createdAt: now(),
        updatedAt: now(),
      };
      db.courses.push(course);
      courseId = course.id;
    }
    if (!courseId && !db.courses.length) {
      const course = { id: id("course"), name: "未分类", createdAt: now(), updatedAt: now() };
      db.courses.push(course);
      courseId = course.id;
    }
    if (!db.courses.some((course) => course.id === courseId)) {
      return json(res, 400, { error: "请先选择或新建科目。" });
    }
    if (!files.length) return json(res, 400, { error: "没有收到文件。" });

    const imported = [];
    for (const file of files) {
      const originalName = file.filename || "upload";
      const storedName = `${Date.now()}-${id("file")}-${safeFileName(originalName)}`;
      const storedPath = path.join(UPLOAD_DIR, storedName);
      await fsp.writeFile(storedPath, file.data);
      let extracted;
      try {
        extracted = await extractTextFromFile(file.data, originalName);
      } catch (error) {
        extracted = {
          text: "",
          units: [],
          warning: `文件已保存，但解析失败：${error.message}`,
        };
      }
      const doc = {
        id: id("doc"),
        courseId,
        originalName,
        storedName,
        mimeType: file.type,
        size: file.data.length,
        type: path.extname(originalName).replace(".", "").toLowerCase() || "unknown",
        uploadedAt: now(),
        text: extracted.text,
        units: extracted.units,
        keywords: extractKeywords(extracted.text),
        warning: extracted.warning,
      };
      refreshDocumentKnowledge(doc);
      db.documents.push(doc);
      imported.push(doc);
    }
    await writeDb(db);
    return json(res, 200, { imported, state: publicState(db) });
  }

  if (req.method === "POST" && pathname === "/api/text-examples") {
    const body = await readJson(req);
    const courseId = String(body.courseId || "").trim();
    if (!db.courses.some((course) => course.id === courseId)) {
      return json(res, 400, { error: "请先选择或新建科目。" });
    }
    const textValue = normalizeText(String(body.text || ""));
    if (!textValue) return json(res, 400, { error: "纯文字例题内容不能为空。" });

    const originalName = normalizeTextDocumentName(body.originalName || body.name);
    const storedName = "";
    const units = splitPlainTextIntoUnits(textValue);
    const doc = {
      id: id("doc"),
      courseId,
      originalName,
      storedName,
      mimeType: "text/plain; charset=utf-8",
      size: Buffer.byteLength(textValue, "utf8"),
      type: path.extname(originalName).replace(".", "").toLowerCase() || "txt",
      importKind: "text-example",
      uploadedAt: now(),
      updatedAt: now(),
      text: textValue,
      units,
      keywords: extractKeywords(textValue),
      warning: "",
    };
    refreshDocumentKnowledge(doc);
    db.documents.push(doc);
    const course = db.courses.find((item) => item.id === courseId);
    if (course) course.updatedAt = now();
    await writeDb(db);
    return json(res, 200, { document: doc, imported: [doc], state: publicState(db) });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/documents/")) {
    const documentId = decodeURIComponent(pathname.split("/").pop() || "");
    const body = await readJson(req);
    const doc = db.documents.find((item) => item.id === documentId);
    if (!doc) return json(res, 404, { error: "没有找到该资料。" });

    if (Object.prototype.hasOwnProperty.call(body, "originalName") || Object.prototype.hasOwnProperty.call(body, "name")) {
      const originalName = String(body.originalName ?? body.name ?? "").trim();
      if (!originalName) return json(res, 400, { error: "资料名称不能为空。" });
      doc.originalName = originalName;
      const ext = path.extname(originalName).replace(".", "").toLowerCase();
      if (ext) doc.type = ext;
    }

    if (Object.prototype.hasOwnProperty.call(body, "text")) {
      const textValue = normalizeText(String(body.text || ""));
      doc.text = textValue;
      doc.units = textValue ? splitPlainTextIntoUnits(textValue, isPlainTextDocument(doc) ? "全文" : "已编辑文本") : [];
      if (isPlainTextDocument(doc)) doc.size = Buffer.byteLength(textValue, "utf8");
      doc.keywords = extractKeywords(textValue);
      doc.warning = textValue ? "" : "文本已手动清空。";
    }

    doc.updatedAt = now();
    refreshDocumentKnowledge(doc);
    const course = db.courses.find((item) => item.id === doc.courseId);
    if (course) course.updatedAt = now();
    await writeDb(db);
    return json(res, 200, { document: doc, state: publicState(db) });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/documents/") && pathname.includes("/units/")) {
    const parts = pathname.split("/").filter(Boolean);
    const documentId = decodeURIComponent(parts[2] || "");
    const unitIndex = Number(parts[4]);
    const doc = db.documents.find((item) => item.id === documentId);
    if (!doc) return json(res, 404, { error: "没有找到该资料。" });

    const units = Array.isArray(doc.units) && doc.units.length ? [...doc.units] : doc.text ? [{ label: "全文", text: doc.text }] : [];
    if (!units.length) return json(res, 400, { error: "该资料没有可删除的片段。" });
    if (!Number.isInteger(unitIndex) || unitIndex < 0 || unitIndex >= units.length) {
      return json(res, 400, { error: "片段序号无效。" });
    }

    const [deletedUnit] = units.splice(unitIndex, 1);
    doc.units = units;
    doc.text = normalizeText(units.map((unit) => `## ${unit.label || "片段"}\n${unit.text || ""}`).join("\n\n"));
    doc.keywords = extractKeywords(doc.text);
    doc.warning = doc.text ? "" : "资料文本片段已全部删除。";
    doc.updatedAt = now();
    refreshDocumentKnowledge(doc);
    const course = db.courses.find((item) => item.id === doc.courseId);
    if (course) course.updatedAt = now();
    await writeDb(db);
    return json(res, 200, { document: doc, deletedUnit, state: publicState(db) });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/documents/")) {
    const documentId = decodeURIComponent(pathname.split("/").pop() || "");
    const docIndex = db.documents.findIndex((item) => item.id === documentId);
    if (docIndex === -1) return json(res, 404, { error: "没有找到该资料。" });

    const [doc] = db.documents.splice(docIndex, 1);
    await deleteStoredDocumentFile(doc);
    for (const mistake of db.mistakes) {
      if (Array.isArray(mistake.sourceDocumentIds)) {
        mistake.sourceDocumentIds = mistake.sourceDocumentIds.filter((idValue) => idValue !== documentId);
      }
      if (Array.isArray(mistake.sourceRefs)) {
        mistake.sourceRefs = mistake.sourceRefs.filter((ref) => ref.document_id !== documentId && ref.documentId !== documentId);
      }
    }
    for (const session of db.sessions) {
      if (Array.isArray(session.sourceDocumentIds)) {
        session.sourceDocumentIds = session.sourceDocumentIds.filter((idValue) => idValue !== documentId);
      }
      if (Array.isArray(session.sourceRefs)) {
        session.sourceRefs = session.sourceRefs.filter((ref) => ref.document_id !== documentId && ref.documentId !== documentId);
      }
    }
    for (const solvedQuestion of db.solvedQuestions || []) {
      if (Array.isArray(solvedQuestion.sourceDocumentIds)) {
        solvedQuestion.sourceDocumentIds = solvedQuestion.sourceDocumentIds.filter((idValue) => idValue !== documentId);
      }
      if (Array.isArray(solvedQuestion.sourceRefs)) {
        solvedQuestion.sourceRefs = solvedQuestion.sourceRefs.filter((ref) => ref.document_id !== documentId && ref.documentId !== documentId);
      }
    }
    const course = db.courses.find((item) => item.id === doc.courseId);
    if (course) course.updatedAt = now();
    await writeDb(db);
    return json(res, 200, { documentId, state: publicState(db) });
  }

  if (req.method === "POST" && pathname === "/api/generate/summary") {
    const body = await readJson(req);
    const course = db.courses.find((item) => item.id === body.courseId);
    const docs = selectDocs(db, body).filter((doc) => doc.text);
    if (!course) return json(res, 404, { error: "没有找到该科目。" });
    if (!docs.length) return json(res, 400, { error: "该科目还没有可用于总结的文本资料。" });
    try {
      const courseModel = courseKnowledgeModel(course, docs);
      const mindMap = generateMindMap(courseModel, body.mindMapFilters || {});
      const knowledgeMap = localKnowledgeMap(course, docs);
      const markdown =
        db.settings.provider === "api" && db.settings.apiKey
          ? await apiSummary(db, courseModel, docs, mindMap)
          : localStructuredSummary(courseModel, mindMap);
      return json(res, 200, {
        provider: db.settings.provider === "api" && db.settings.apiKey ? "api" : "local",
        courseModel,
        mindMap,
        knowledgeMap,
        markdown,
      });
    } catch (error) {
      const courseModel = courseKnowledgeModel(course, docs);
      const mindMap = generateMindMap(courseModel);
      return json(res, 200, {
        provider: "local",
        warning: error.message,
        courseModel,
        mindMap,
        knowledgeMap: localKnowledgeMap(course, docs),
        markdown: localStructuredSummary(courseModel, mindMap),
      });
    }
  }

  if (req.method === "POST" && pathname === "/api/generate/mindmap") {
    const body = await readJson(req);
    const course = db.courses.find((item) => item.id === body.courseId);
    const docs = selectDocs(db, body).filter((doc) => doc.text);
    if (!course) return json(res, 404, { error: "没有找到该科目。" });
    if (!docs.length) return json(res, 400, { error: "该科目还没有可用于生成思维导图的文本资料。" });
    const courseModel = courseKnowledgeModel(course, docs);
    const mindMap = generateMindMap(courseModel, body.filters || {});
    return json(res, 200, { provider: "local", courseModel, mindMap });
  }

  if (req.method === "POST" && pathname === "/api/generate/quiz") {
    const body = await readJson(req);
    const course = db.courses.find((item) => item.id === body.courseId);
    const docs = selectDocs(db, body).filter((doc) => doc.text);
    if (!course) return json(res, 404, { error: "没有找到该科目。" });
    if (!docs.length) return json(res, 400, { error: "该科目还没有可用于出题的文本资料。" });
    try {
      const courseModel = courseKnowledgeModel(course, docs);
      const localResult = generateQuestionSet(courseModel, body);
      const questions =
        db.settings.provider === "api" && db.settings.apiKey
          ? await apiQuiz(db, courseModel, docs, body, localResult)
          : localResult.questions;
      const evaluation =
        db.settings.provider === "api" && db.settings.apiKey
          ? evaluateQuestionSet(questions, courseModel)
          : localResult.evaluation;
      return json(res, 200, {
        provider: db.settings.provider === "api" && db.settings.apiKey ? "api" : "local",
        courseModel,
        questions,
        evaluation,
        warnings: localResult.warnings,
      });
    } catch (error) {
      const courseModel = courseKnowledgeModel(course, docs);
      const localResult = generateQuestionSet(courseModel, body);
      return json(res, 200, {
        provider: "local",
        warning: error.message,
        courseModel,
        questions: localResult.questions,
        evaluation: localResult.evaluation,
        warnings: localResult.warnings,
      });
    }
  }

  if (req.method === "POST" && pathname === "/api/generate/similar") {
    const body = await readJson(req);
    const mistake = db.mistakes.find((item) => item.id === body.mistakeId);
    if (!mistake) return json(res, 404, { error: "没有找到该错题。" });
    const course = db.courses.find((item) => item.id === mistake.courseId);
    const docs = db.documents
      .filter((doc) => doc.courseId === mistake.courseId)
      .filter((doc) => !mistake.sourceDocumentIds?.length || mistake.sourceDocumentIds.includes(doc.id))
      .filter((doc) => doc.text);
    const count = Math.max(2, Math.min(Number(body.count || 4), 10));
    try {
      const questions =
        db.settings.provider === "api" && db.settings.apiKey
          ? await apiSimilarQuestions(db, course, mistake, docs, count)
          : localSimilarQuestions(mistake, docs, count);
      return json(res, 200, {
        provider: db.settings.provider === "api" && db.settings.apiKey ? "api" : "local",
        questions,
      });
    } catch (error) {
      return json(res, 200, {
        provider: "local",
        warning: error.message,
        questions: localSimilarQuestions(mistake, docs, count),
      });
    }
  }

  if (req.method === "POST" && pathname === "/api/generate/plan") {
    const body = await readJson(req);
    const course = db.courses.find((item) => item.id === body.courseId);
    const docs = selectDocs(db, body).filter((doc) => doc.text);
    if (!course) return json(res, 404, { error: "没有找到该科目。" });
    if (!docs.length) return json(res, 400, { error: "该科目还没有可用于制定计划的文本资料。" });
    const courseModel = courseKnowledgeModel(course, docs);
    const questionResult = generateQuestionSet(courseModel, { count: 18 });
    const plan = new StudyPlanGenerator(courseModel, questionResult.questions).generate({
      ...body,
      mistakes: db.mistakes.filter((mistake) => mistake.courseId === course.id),
    });
    return json(res, 200, {
      provider: "local",
      courseModel,
      plan,
    });
  }

  if (req.method === "POST" && pathname === "/api/generate/cram-pack") {
    const body = await readJson(req);
    const course = db.courses.find((item) => item.id === body.courseId);
    const docs = selectDocs(db, body).filter((doc) => doc.text);
    if (!course) return json(res, 404, { error: "没有找到该科目。" });
    if (!docs.length) return json(res, 400, { error: "该科目还没有可用于生成冲刺包的文本资料。" });
    const courseModel = courseKnowledgeModel(course, docs);
    const questionResult = generateQuestionSet(courseModel, { count: Number(body.questionCount || 12) });
    const cramPack = generateCramPack(courseModel, questionResult.questions, {
      documents: docs,
      mistakes: db.mistakes.filter((mistake) => mistake.courseId === course.id),
      sessions: db.sessions.filter((session) => session.courseId === course.id),
      totalMinutes: Number(body.totalMinutes || 90),
      questionCount: Number(body.questionCount || 12),
      topicLimit: Number(body.topicLimit || 6),
    });
    return json(res, 200, {
      provider: "local",
      courseModel,
      questionResult,
      cramPack,
    });
  }

  if (req.method === "POST" && pathname === "/api/solve") {
    const body = await readJson(req);
    const course = db.courses.find((item) => item.id === body.courseId);
    const docs = selectDocs(db, body).filter((doc) => doc.text);
    const question = String(body.question || "").trim();
    if (!course) return json(res, 404, { error: "没有找到该科目。" });
    if (!question) return json(res, 400, { error: "题目不能为空。" });
    if (!docs.length) return json(res, 400, { error: "该科目还没有可用于辅助解题的文本资料。" });
    try {
      const { courseModel, solution } = await apiSolveQuestion(db, course, docs, body);
      return json(res, 200, {
        provider: db.settings.provider === "api" && db.settings.apiKey ? solution.provider || "api" : "local",
        courseModel,
        solution,
      });
    } catch (error) {
      const courseModel = courseKnowledgeModel(course, docs);
      return json(res, 200, {
        provider: "local",
        warning: error.message,
        courseModel,
        solution: localSolveQuestion(course, docs, body, courseModel),
      });
    }
  }

  if (req.method === "POST" && pathname === "/api/solved-questions") {
    const body = await readJson(req);
    const course = db.courses.find((item) => item.id === body.courseId);
    if (!course) return json(res, 404, { error: "没有找到该科目。" });
    const solution = normalizeSolution(body.solution || body, {
      courseId: course.id,
      subject: course.name,
      provider: body.provider || "local",
    });
    if (!solution.question) return json(res, 400, { error: "题目不能为空。" });
    const courseDocIds = new Set(db.documents.filter((doc) => doc.courseId === course.id).map((doc) => doc.id));
    const sourceRefs = sanitizeSourceRefs(solution.sourceRefs || solution.source_refs, courseDocIds);
    const solvedQuestion = {
      ...solution,
      id: id("solved"),
      courseId: course.id,
      subject: course.name,
      sourceRefs,
      sourceDocumentIds: uniqueStrings([
        ...(Array.isArray(solution.sourceDocumentIds) ? solution.sourceDocumentIds.filter((docId) => courseDocIds.has(docId)) : []),
        ...sourceRefs.map((ref) => ref.document_id),
      ]),
      provider: solution.provider || body.provider || "local",
      memoryPinned: body.memoryPinned !== false,
      createdAt: now(),
      updatedAt: now(),
    };
    db.solvedQuestions = Array.isArray(db.solvedQuestions) ? db.solvedQuestions : [];
    db.solvedQuestions.unshift(solvedQuestion);
    db.solvedQuestions = db.solvedQuestions.slice(0, 300);
    course.updatedAt = now();
    await writeDb(db);
    return json(res, 200, { solvedQuestion, state: publicState(db) });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/solved-questions/")) {
    const solvedQuestionId = decodeURIComponent(pathname.split("/").pop() || "");
    db.solvedQuestions = Array.isArray(db.solvedQuestions) ? db.solvedQuestions : [];
    const solvedIndex = db.solvedQuestions.findIndex((item) => item.id === solvedQuestionId);
    if (solvedIndex === -1) return json(res, 404, { error: "没有找到该解题记录。" });
    const [solvedQuestion] = db.solvedQuestions.splice(solvedIndex, 1);
    const course = db.courses.find((item) => item.id === solvedQuestion.courseId);
    if (course) course.updatedAt = now();
    await writeDb(db);
    return json(res, 200, { solvedQuestionId, state: publicState(db) });
  }

  if (req.method === "POST" && pathname.startsWith("/api/questions/") && pathname.endsWith("/progress")) {
    const parts = pathname.split("/").filter(Boolean);
    const questionId = decodeURIComponent(parts[2] || "");
    const body = await readJson(req);
    if (!questionId) return json(res, 400, { error: "题目 ID 不能为空。" });
    db.questionProgress = Array.isArray(db.questionProgress) ? db.questionProgress : [];
    const existing = db.questionProgress.find((item) => item.questionId === questionId && item.courseId === body.courseId);
    const progress = existing || {
      id: id("qprog"),
      questionId,
      courseId: body.courseId || "",
      createdAt: now(),
    };
    progress.status = ["known", "unknown", "mistake"].includes(body.status) ? body.status : "unknown";
    progress.notes = String(body.notes || "").trim();
    progress.updatedAt = now();
    if (!existing) db.questionProgress.unshift(progress);
    await writeDb(db);
    return json(res, 200, { progress, state: publicState(db) });
  }

  if (req.method === "POST" && pathname === "/api/ask") {
    const body = await readJson(req);
    const course = db.courses.find((item) => item.id === body.courseId);
    const docs = selectDocs(db, body).filter((doc) => doc.text);
    if (!course) return json(res, 404, { error: "没有找到该科目。" });
    if (!String(body.question || "").trim()) return json(res, 400, { error: "问题不能为空。" });
    if (!docs.length) return json(res, 400, { error: "该科目还没有可用于问答的文本资料。" });
    try {
      const answer = await apiAsk(db, course, docs, body.question.trim());
      return json(res, 200, { answer });
    } catch (error) {
      return json(res, 200, { warning: error.message, answer: localAnswer(docs, body.question.trim()) });
    }
  }

  if (req.method === "POST" && pathname === "/api/mistakes") {
    const body = await readJson(req);
    const courseDocIds = new Set(db.documents.filter((doc) => doc.courseId === body.courseId).map((doc) => doc.id));
    const sourceRefs = sanitizeSourceRefs(body.sourceRefs || body.source_refs, courseDocIds);
    const sourceDocumentIds = uniqueStrings([
      ...(Array.isArray(body.sourceDocumentIds) ? body.sourceDocumentIds.filter((docId) => courseDocIds.has(docId)) : []),
      ...sourceRefs.map((ref) => ref.document_id),
    ]);
    const mistake = {
      id: id("mistake"),
      courseId: body.courseId,
      question: body.question,
      answer: body.answer,
      explanation: body.explanation || "",
      userAnswer: body.userAnswer || "",
      sourceDocumentIds,
      sourceRefs,
      mastered: false,
      createdAt: now(),
      updatedAt: now(),
    };
    db.mistakes.unshift(mistake);
    await writeDb(db);
    return json(res, 200, { mistake, state: publicState(db) });
  }

  if (req.method === "POST" && pathname === "/api/sessions") {
    const body = await readJson(req);
    const course = db.courses.find((item) => item.id === body.courseId);
    if (!course) return json(res, 404, { error: "没有找到该科目。" });
    const title = String(body.topicTitle || body.title || "").trim();
    if (!title) return json(res, 400, { error: "复习主题不能为空。" });
    const courseDocIds = new Set(db.documents.filter((doc) => doc.courseId === course.id).map((doc) => doc.id));
    const courseMistakeIds = new Set(db.mistakes.filter((mistake) => mistake.courseId === course.id).map((mistake) => mistake.id));
    const sourceRefs = sanitizeSourceRefs(body.sourceRefs || body.source_refs, courseDocIds);
    const sourceDocumentIds = uniqueStrings([
      ...(Array.isArray(body.sourceDocumentIds) ? body.sourceDocumentIds.filter((docId) => courseDocIds.has(docId)) : []),
      ...sourceRefs.map((ref) => ref.document_id),
    ]);
    const session = {
      id: id("session"),
      courseId: course.id,
      topicId: String(body.topicId || "").trim(),
      topicTitle: title,
      chapterTitle: String(body.chapterTitle || "").trim(),
      notes: String(body.notes || "").trim(),
      durationMinutes: Math.max(1, Math.min(Number(body.durationMinutes || 20), 240)),
      sourceDocumentIds,
      sourceRefs,
      sourceMistakeIds: Array.isArray(body.sourceMistakeIds)
        ? body.sourceMistakeIds.filter((mistakeId) => courseMistakeIds.has(mistakeId))
        : [],
      completedAt: body.completedAt ? new Date(body.completedAt).toISOString() : now(),
      createdAt: now(),
      updatedAt: now(),
    };
    db.sessions.unshift(session);
    course.updatedAt = now();
    await writeDb(db);
    return json(res, 200, { session, state: publicState(db) });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/sessions/")) {
    const sessionId = decodeURIComponent(pathname.split("/").pop() || "");
    const sessionIndex = db.sessions.findIndex((item) => item.id === sessionId);
    if (sessionIndex === -1) return json(res, 404, { error: "没有找到该复盘记录。" });
    const [session] = db.sessions.splice(sessionIndex, 1);
    const course = db.courses.find((item) => item.id === session.courseId);
    if (course) course.updatedAt = now();
    await writeDb(db);
    return json(res, 200, { sessionId, state: publicState(db) });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/mistakes/")) {
    const mistakeId = decodeURIComponent(pathname.split("/").pop() || "");
    const body = await readJson(req);
    const mistake = db.mistakes.find((item) => item.id === mistakeId);
    if (!mistake) return json(res, 404, { error: "没有找到该错题。" });
    if (typeof body.mastered === "boolean") mistake.mastered = body.mastered;
    if (typeof body.userAnswer === "string") mistake.userAnswer = body.userAnswer;
    if (Array.isArray(body.sourceRefs) || Array.isArray(body.source_refs)) {
      const courseDocIds = new Set(db.documents.filter((doc) => doc.courseId === mistake.courseId).map((doc) => doc.id));
      mistake.sourceRefs = sanitizeSourceRefs(body.sourceRefs || body.source_refs, courseDocIds);
      mistake.sourceDocumentIds = uniqueStrings([
        ...(Array.isArray(mistake.sourceDocumentIds) ? mistake.sourceDocumentIds.filter((docId) => courseDocIds.has(docId)) : []),
        ...mistake.sourceRefs.map((ref) => ref.document_id),
      ]);
    }
    mistake.updatedAt = now();
    await writeDb(db);
    return json(res, 200, { mistake, state: publicState(db) });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/mistakes/")) {
    const mistakeId = decodeURIComponent(pathname.split("/").pop() || "");
    const mistakeIndex = db.mistakes.findIndex((item) => item.id === mistakeId);
    if (mistakeIndex === -1) return json(res, 404, { error: "没有找到该错题。" });
    const [mistake] = db.mistakes.splice(mistakeIndex, 1);
    for (const session of db.sessions) {
      if (Array.isArray(session.sourceMistakeIds)) {
        session.sourceMistakeIds = session.sourceMistakeIds.filter((idValue) => idValue !== mistakeId);
      }
    }
    const course = db.courses.find((item) => item.id === mistake.courseId);
    if (course) course.updatedAt = now();
    await writeDb(db);
    return json(res, 200, { mistakeId, state: publicState(db) });
  }

  if (req.method === "POST" && pathname === "/api/settings/models") {
    const body = await readJson(req);
    const settings = resolveApiSettings(db.settings, body);
    try {
      const models = await listApiModels(settings);
      return json(res, 200, {
        ok: true,
        models,
        selectedModel: settings.model && models.some((model) => model.id === settings.model) ? settings.model : models[0]?.id || "",
      });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message || "模型列表获取失败。" });
    }
  }

  if (req.method === "POST" && pathname === "/api/settings/test") {
    const body = await readJson(req);
    const settings = resolveApiSettings(db.settings, body);
    try {
      const models = await listApiModels(settings);
      const selectedModel = settings.model && models.some((model) => model.id === settings.model) ? settings.model : models[0]?.id || settings.model;
      await testApiConnection({ ...settings, model: selectedModel });
      return json(res, 200, {
        ok: true,
        message: "API 连接成功。",
        models,
        selectedModel,
      });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message || "API 连接测试失败。" });
    }
  }

  if (req.method === "POST" && pathname === "/api/settings") {
    const body = await readJson(req);
    const settings = resolveApiSettings(db.settings, body);
    db.settings.provider = body.provider === "api" ? "api" : "local";
    db.settings.apiBaseUrl = settings.apiBaseUrl;
    db.settings.model = settings.model;
    db.settings.apiKey = settings.apiKey;
    await writeDb(db);
    return json(res, 200, { settings: publicState(db).settings, state: publicState(db) });
  }

  return json(res, 404, { error: "未知 API。" });
}

async function serveStatic(req, res, pathname) {
  if (pathname === "/vendor/lucide.js") {
    return streamFile(res, runtimeRequire.resolve("lucide/dist/umd/lucide.js"), "text/javascript; charset=utf-8");
  }
  if (pathname === "/vendor/marked.umd.js") {
    return streamFile(res, runtimeRequire.resolve("marked/lib/marked.umd.js"), "text/javascript; charset=utf-8");
  }
  if (pathname.startsWith("/uploads/")) {
    try {
      const storedName = decodeURIComponent(pathname.slice("/uploads/".length));
      return streamFile(res, storedUploadPath(storedName));
    } catch {
      return text(res, 403, "Forbidden");
    }
  }

  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return text(res, 403, "Forbidden");
  return streamFile(res, filePath);
}

function streamFile(res, filePath, explicitType) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = explicitType || MIME_TYPES[ext] || "application/octet-stream";
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => text(res, 404, "Not found"));
  stream.on("open", () => res.writeHead(200, { "content-type": contentType }));
  stream.pipe(res);
}

async function main() {
  await ensureDataDirs();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url.pathname);
      return await serveStatic(req, res, url.pathname);
    } catch (error) {
      return json(res, 500, { error: error.message || "服务器错误。" });
    }
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`端口 ${PORT} 已被占用，请设置 PORT=其他端口 后重试。`);
    } else if (error.code === "EPERM") {
      console.error(`当前环境不允许监听 ${HOST}:${PORT}，请在本机终端运行或授予本地服务权限。`);
    } else {
      console.error(error);
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Mechanics Review Studio is running at http://${HOST}:${PORT}`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  toLatexFormula,
  wrapInlineFormula,
  extractTextFromFile,
  extractKeywords,
  localKnowledgeMap,
  localReviewPlan,
  localSummary,
  localQuiz,
  localSimilarQuestions,
  generateCramPack,
  detectTopics,
  getImportantSentences,
  getFormulaLines,
  normalizeText,
  buildApiStudyContext,
  normalizeApiQuestion,
  parseJsonFromModel,
  buildCourseKnowledgeModel: courseKnowledgeModel,
  buildDocumentKnowledgeModel,
  extractProblemAnchors,
  generateQuestionSet,
  evaluateQuestionSet,
  generateMindMap,
  StudyPlanGenerator,
  readDb,
  writeDb,
  publicState,
};

process.on("unhandledRejection", (error) => {
  console.error(error);
  process.exit(1);
});
