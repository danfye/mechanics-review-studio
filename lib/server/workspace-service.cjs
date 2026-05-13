const { extractProblemAnchors, LOCATOR_VERSION } = require("../core/knowledge-model.cjs");

function createWorkspaceService({ buildDocumentKnowledgeModel }) {
  function needsDocumentKnowledgeRefresh(doc) {
    if (!doc?.text) return false;
    if (!doc.parseQuality || !doc.knowledgeModel) return true;
    return Number(doc.locatorVersion || 0) < LOCATOR_VERSION;
  }

  function refreshDocumentKnowledge(doc) {
    const model = buildDocumentKnowledgeModel(doc);
    doc.knowledgeModel = model;
    doc.parseQuality = model.parse_quality;
    doc.learningPack = model.learning_pack;
    doc.locatorVersion = LOCATOR_VERSION;
    return doc;
  }

  function migrateWorkspace(db) {
    let changed = false;
    for (const doc of db.documents || []) {
      if (needsDocumentKnowledgeRefresh(doc)) {
        refreshDocumentKnowledge(doc);
        changed = true;
      }
    }
    return changed;
  }

  function publicState(db) {
    const state = {
      ...db,
      settings: {
        ...db.settings,
        apiKey: db.settings?.apiKey ? "__SET__" : "",
      },
    };
    state.workspace = buildWorkspaceView(state);
    return state;
  }

  return {
    buildWorkspaceView,
    migrateWorkspace,
    needsDocumentKnowledgeRefresh,
    publicState,
    refreshDocumentKnowledge,
  };
}

function buildWorkspaceView(db) {
  const documentsByCourse = groupBy(db.documents || [], (doc) => doc.courseId);
  const mistakesByCourse = groupBy(db.mistakes || [], (mistake) => mistake.courseId);
  const sessionsByCourse = groupBy(db.sessions || [], (session) => session.courseId);
  const solvedByCourse = groupBy(db.solvedQuestions || [], (item) => item.courseId);
  const courses = (db.courses || []).map((course) => {
    const documents = documentsByCourse.get(course.id) || [];
    const mistakes = mistakesByCourse.get(course.id) || [];
    const sessions = sessionsByCourse.get(course.id) || [];
    const solvedQuestions = solvedByCourse.get(course.id) || [];
    return {
      id: course.id,
      name: course.name,
      createdAt: course.createdAt || "",
      updatedAt: course.updatedAt || "",
      documentIds: documents.map((doc) => doc.id),
      mistakeIds: mistakes.map((mistake) => mistake.id),
      sessionIds: sessions.map((session) => session.id),
      stats: {
        documents: documents.length,
        mistakes: mistakes.length,
        unmasteredMistakes: mistakes.filter((mistake) => !mistake.mastered).length,
        sessions: sessions.length,
        solvedQuestions: solvedQuestions.length,
        learningPacks: documents.filter((doc) => doc.learningPack || doc.knowledgeModel?.learning_pack).length,
        learningPackDrills: documents.reduce((sum, doc) => sum + Number((doc.learningPack || doc.knowledgeModel?.learning_pack)?.coverage?.drillTemplates || 0), 0),
        selectedByDefaultDocumentIds: documents.map((doc) => doc.id),
        textLength: documents.reduce((total, doc) => total + String(doc.text || "").length, 0),
      },
    };
  });

  return {
    courses,
    documents: (db.documents || []).map(buildDocumentView),
    providerLabel: db.settings?.provider === "api" ? "API 增强版" : "本地模式",
    stats: {
      courseCount: (db.courses || []).length,
      documentCount: (db.documents || []).length,
      mistakeCount: (db.mistakes || []).length,
      sessionCount: (db.sessions || []).length,
      solvedQuestionCount: (db.solvedQuestions || []).length,
    },
  };
}

function buildDocumentView(doc) {
  const units = documentUnits(doc);
  const outline = buildDocOutline(doc, units);
  const quality = doc.parseQuality || doc.knowledgeModel?.parse_quality || null;
  const counts = quality?.counts || {};
  const textLength = String(doc.text || "").length;
  return {
    id: doc.id,
    courseId: doc.courseId,
    originalName: doc.originalName,
    type: String(doc.type || "file").toUpperCase(),
    lowerType: String(doc.type || "").toLowerCase(),
    isTextExample: isTextExampleDoc(doc),
    size: Number(doc.size || 0),
    textLength,
    textLengthLabel: textLength ? `${textLength} 字` : "无文本",
    warning: doc.warning || "",
    keywords: (doc.keywords || []).slice(0, 8),
    parseQuality: quality
      ? {
          level: quality.level || "",
          score: Number(quality.score || 0),
          label: `解析 ${Number(quality.score || 0)}`,
          counts: {
            chapters: Number(counts.chapters || 0),
            concepts: Number(counts.concepts || 0),
            formulas: Number(counts.formulas || 0),
            examples: Number(counts.examples || 0),
            homework_problems: Number(counts.homework_problems || 0),
            mistake_points: Number(counts.mistake_points || 0),
          },
        }
      : null,
    learningPack: buildLearningPackView(doc.learningPack || doc.knowledgeModel?.learning_pack),
    unitCount: units.length,
    unitCountLabel: `${units.length || 0} ${isPagedDocument(doc) ? "页" : "段"}`,
    outline,
  };
}

function buildLearningPackView(pack) {
  if (!pack) return null;
  const coverage = pack.coverage || {};
  return {
    id: pack.id || "",
    title: pack.title || "",
    summary: pack.summary || "",
    coverage: {
      concepts: Number(coverage.concepts || 0),
      formulas: Number(coverage.formulas || 0),
      problemTemplates: Number(coverage.problemTemplates || 0),
      pitfalls: Number(coverage.pitfalls || 0),
      drillTemplates: Number(coverage.drillTemplates || 0),
    },
  };
}

function buildDocOutline(doc, units = documentUnits(doc)) {
  const counters = {
    example: 0,
    thinking: 0,
    question: 0,
    exercise: 0,
  };
  const landmarks = [];
  const pages = units.map((unit, index) => {
    const pageNumber = unitPageNumber(unit, index);
    const pageLabel = pageNumber ? `第 ${pageNumber} 页` : unit.label || "全文";
    const title = outlineTitle(unit.text || unit.label || pageLabel, 42);
    const sectionTitle = extractSectionTitle(unit.text || "");
    if (sectionTitle) {
      landmarks.push({
        type: "section",
        label: sectionTitle,
        pageLabel,
        unitIndex: index,
      });
    }

    const text = compactText(unit.text);
    for (const anchor of extractProblemAnchors(text)) {
      const type = outlineTypeFromAnchor(anchor);
      counters[type] = (counters[type] || 0) + 1;
      const fallbackLabel =
        anchor.fallbackLabel ||
        (type === "example" ? "例题" : type === "thinking" ? "思考题" : type === "exercise" ? "练习" : "问题");
      const label = !anchor.label || anchor.label === fallbackLabel ? `${fallbackLabel} ${counters[type]}` : anchor.label;
      landmarks.push({
        type,
        label,
        pageLabel,
        unitIndex: index,
        title: anchor.title,
      });
    }

    return {
      shortLabel: pageNumber || unitShortLabel(unit, index),
      title: `${pageLabel} ${title}`,
      unitIndex: index,
    };
  });

  return { units: units.length, landmarks: dedupeLandmarks(landmarks), pages };
}

function outlineTypeFromAnchor(anchor) {
  const marker = String(anchor?.marker || anchor?.label || "").replace(/\s+/g, "");
  if (anchor?.type) return anchor.type;
  if (anchor?.kind === "example" || /^例题?$/.test(marker)) return "example";
  if (/思考题/.test(marker)) return "thinking";
  if (/习题|练习|作业/.test(marker)) return "exercise";
  return "question";
}

function documentUnits(doc) {
  if (Array.isArray(doc?.units) && doc.units.length) return doc.units;
  if (doc?.text) return [{ label: "全文", text: doc.text }];
  return [];
}

function unitPageNumber(unit) {
  const match = /第\s*(\d+)\s*页/.exec(String(unit?.label || ""));
  return match ? Number(match[1]) : null;
}

function unitShortLabel(unit, index) {
  const label = compactText(unit?.label || "");
  if (!label || label === "全文") return index + 1;
  return label.length > 6 ? `${label.slice(0, 5)}...` : label;
}

function isPagedDocument(doc) {
  const type = String(doc?.type || "").toLowerCase();
  if (type === "pdf" || type === "pptx") return true;
  return (doc?.units || []).some((unit) => /第\s*\d+\s*页/.test(String(unit?.label || "")));
}

function isTextExampleDoc(doc) {
  const type = String(doc?.type || "").toLowerCase();
  const mimeType = String(doc?.mimeType || "").toLowerCase();
  return doc?.importKind === "text-example" || type === "txt" || type === "md" || mimeType.startsWith("text/");
}

function extractSectionTitle(text) {
  const match = compactText(text).match(/\d+\s*[-－–—]\s*\d+\s*[、,.，．]\s*[\p{L}\s（）()、]{2,32}/u);
  if (!match) return "";
  return outlineTitle(match[0].replace(/\s*[-－–—]\s*/g, "-").replace(/\s*[、,.，．]\s*/g, "、"), 30);
}

function outlineTitle(text, maxLength = 36) {
  const cleaned = compactText(text)
    .replace(/TaoFM-\s*/gi, "")
    .replace(/\b\d{4}\/\d{1,2}\/\d{1,2}\b/g, "")
    .replace(/\s+\d{1,3}\s*$/g, "")
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}...` : cleaned;
}

function compactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function dedupeLandmarks(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.type}:${item.label}:${item.unitIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const group = map.get(key) || [];
    group.push(item);
    map.set(key, group);
  }
  return map;
}

module.exports = {
  buildDocOutline,
  buildDocumentView,
  buildWorkspaceView,
  createWorkspaceService,
  documentUnits,
};
