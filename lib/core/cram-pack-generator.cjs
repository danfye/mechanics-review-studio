const {
  buildCourseKnowledgeModel,
  clamp,
  hashId,
  sourceDocumentIds,
  uniqueBy,
  uniqueStrings,
} = require("./knowledge-model.cjs");
const { formulaIsUsable, verifiedFormulaScore } = require("./formula-verifier.cjs");
const { learningPackQuestions } = require("./learning-pack.cjs");

function generateCramPack(courseOrModel, docsOrQuestions = [], input = {}) {
  const hasModel = courseOrModel?.schema_version && Array.isArray(courseOrModel?.chapters);
  const courseModel = hasModel ? courseOrModel : buildCourseKnowledgeModel(courseOrModel, docsOrQuestions || []);
  const questions = hasModel ? docsOrQuestions || [] : input.questions || [];
  const documents = Array.isArray(input.documents) ? input.documents : [];
  const mistakes = Array.isArray(input.mistakes) ? input.mistakes : [];
  const sessions = Array.isArray(input.sessions) ? input.sessions : [];
  const totalMinutes = numberInRange(input.totalMinutes || input.total_minutes || 90, 30, 240);
  const questionCount = numberInRange(input.questionCount || input.question_count || 10, 3, 20);
  const topicLimit = numberInRange(input.topicLimit || input.topic_limit || 6, 3, 10);
  const nowDate = input.now ? new Date(input.now) : new Date();

  const rankedChapters = rankCramChapters(courseModel, mistakes, sessions, nowDate);
  const focusTopics = rankedChapters.slice(0, topicLimit).map((entry, index) => toFocusTopic(entry, courseModel, totalMinutes, index));
  const formulas = rankFormulas(courseModel, focusTopics).slice(0, 10);
  const pitfalls = buildPitfalls(courseModel, mistakes, focusTopics).slice(0, 12);
  const mistakeQueue = rankMistakes(mistakes, focusTopics, nowDate).slice(0, 10);
  const drillQuestions = selectDrillQuestions(enrichQuestionsWithLearningPack(questions, courseModel), focusTopics, questionCount);
  const timeline = buildTimeline({ totalMinutes, focusTopics, formulas, mistakeQueue, drillQuestions });
  const nextAction = timeline[0] || focusTopics[0] || null;
  const scope = scopeStats(courseModel, documents, mistakes, sessions);
  const warnings = uniqueStrings([
    ...(courseModel.warnings || []),
    !scope.documentCount ? "没有可统计的资料，冲刺包只能基于错题或空模板生成。" : "",
    !focusTopics.length ? "没有识别到稳定章节，请先导入可抽取文本的课件或例题。" : "",
    !drillQuestions.length ? "题目不足，建议先生成题库或补充例题资料。" : "",
  ]);

  return {
    courseId: courseModel.course?.course_id || "unknown",
    title: `${courseModel.course?.name || "当前科目"}考前冲刺包`,
    generatedAt: new Date().toISOString(),
    mode: totalMinutes <= 60 ? "quick" : totalMinutes >= 150 ? "deep" : "standard",
    inputs: {
      totalMinutes,
      questionCount,
      topicLimit,
    },
    scope,
    summary: {
      estimatedMinutes: timeline.reduce((sum, item) => sum + Number(item.minutes || 0), 0),
      focusTopicCount: focusTopics.length,
      weakTopicCount: focusTopics.filter((item) => item.priorityScore >= 70).length,
      formulaCount: formulas.length,
      pitfallCount: pitfalls.length,
      mistakeCount: mistakeQueue.length,
      drillQuestionCount: drillQuestions.length,
      unmasteredMistakeCount: mistakeQueue.filter((item) => !item.mastered).length,
    },
    nextAction,
    focusTopics,
    formulas,
    pitfalls,
    mistakeQueue,
    drillQuestions,
    timeline,
    warnings,
  };
}

function rankCramChapters(courseModel, mistakes, sessions, nowDate) {
  const chapters = Array.isArray(courseModel.chapters) ? courseModel.chapters : [];
  return chapters
    .map((chapter, index) => {
      const concepts = relatedItems(courseModel.concepts, chapter);
      const formulas = relatedItems(courseModel.formulas, chapter);
      const examples = relatedItems(courseModel.examples, chapter);
      const homework = relatedItems(courseModel.homework_problems, chapter);
      const modelMistakes = relatedItems(courseModel.mistake_points, chapter);
      const userMistakes = mistakes.filter((mistake) => mistakeMatchesChapter(mistake, chapter, concepts, formulas));
      const sessionHits = sessions.filter((session) => sessionMatchesChapter(session, chapter));
      const unmasteredMistakes = userMistakes.filter((mistake) => !mistake.mastered);
      const lastCompletedAt = latestDate(sessionHits.map((session) => session.completedAt || session.createdAt));
      const daysSince = daysBetween(lastCompletedAt, nowDate);
      const recentPenalty = lastCompletedAt ? (daysSince <= 1 ? 22 : daysSince <= 3 ? 14 : daysSince <= 7 ? 8 : 0) : 0;
      const difficultyBonus = { basic: 4, medium: 10, hard: 16, comprehensive: 22 }[chapter.difficulty] || 8;
      const score = Math.round(
        Number(chapter.exam_focus?.score || 0) * 0.75 +
          concepts.length * 4 +
          formulas.length * 11 +
          examples.length * 7 +
          homework.length * 9 +
          modelMistakes.length * 9 +
          unmasteredMistakes.length * 24 +
          (userMistakes.length - unmasteredMistakes.length) * 8 +
          difficultyBonus -
          sessionHits.length * 5 -
          recentPenalty +
          index,
      );
      return {
        chapter,
        concepts,
        formulas,
        examples,
        homework,
        modelMistakes,
        userMistakes,
        sessionHits,
        lastCompletedAt,
        priorityScore: Math.max(1, score),
        priorityLabel: priorityLabel(score),
        reasons: chapterReasons(chapter, {
          concepts,
          formulas,
          examples,
          homework,
          modelMistakes,
          userMistakes,
          unmasteredMistakes,
          sessionHits,
          recentPenalty,
        }),
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore || (a.chapter.order || 0) - (b.chapter.order || 0));
}

function toFocusTopic(entry, courseModel, totalMinutes, index) {
  const chapter = entry.chapter;
  const duration = index === 0 ? Math.min(35, Math.max(22, Math.round(totalMinutes * 0.28))) : Math.min(28, Math.max(16, Math.round(totalMinutes * 0.18)));
  const evidence = uniqueBy(
    [
      ...(chapter.source_refs || []),
      ...entry.formulas.flatMap((item) => item.source_refs || []),
      ...entry.examples.flatMap((item) => item.source_refs || []),
      ...entry.homework.flatMap((item) => item.source_refs || []),
      ...entry.modelMistakes.flatMap((item) => item.source_refs || []),
    ],
    refKey,
  )
    .slice(0, 4)
    .map(toEvidence);
  const sourceIds = uniqueStrings([
    ...sourceDocumentIds(chapter.source_refs || []),
    ...entry.formulas.flatMap((item) => sourceDocumentIds(item.source_refs || [])),
    ...entry.userMistakes.flatMap((mistake) => mistake.sourceDocumentIds || []),
  ]);
  const relatedRules = relatedItems(courseModel.theorem_or_rules, chapter);
  return {
    id: hashId("cram_topic", [chapter.chapter_id, chapter.title]),
    chapterId: chapter.chapter_id,
    title: chapter.title || "综合复盘",
    priorityScore: entry.priorityScore,
    priorityLabel: entry.priorityLabel,
    durationMinutes: duration,
    reason: entry.reasons,
    sourceLocation: sourceLocation(chapter.source_refs || []),
    sourceRefs: (chapter.source_refs || []).slice(0, 3),
    sourceDocumentIds: sourceIds,
    sourceMistakeIds: entry.userMistakes.map((mistake) => mistake.id).filter(Boolean),
    completedCount: entry.sessionHits.length,
    lastCompletedAt: entry.lastCompletedAt ? entry.lastCompletedAt.toISOString() : "",
    concepts: uniqueStrings(entry.concepts.map((item) => item.name)).slice(0, 8),
    formulas: uniqueStrings(entry.formulas.map((item) => item.expression)).slice(0, 5),
    rules: uniqueStrings(relatedRules.map((item) => item.name || item.statement)).slice(0, 4),
    pitfalls: uniqueStrings([
      ...entry.modelMistakes.map((item) => item.description),
      ...entry.userMistakes.map((item) => item.explanation || item.question),
    ]).slice(0, 5),
    actions: cramActions(entry),
    evidence,
  };
}

function rankFormulas(courseModel, focusTopics) {
  const topicsByChapter = new Map(focusTopics.map((topic) => [topic.chapterId, topic]));
  return (courseModel.formulas || [])
    .filter((formula) => formulaIsUsable(formula, { requireReference: true }))
    .map((formula) => {
      const topic = topicsByChapter.get(formula.chapter_id) || focusTopics.find((item) => sourceRefsOverlap(item.sourceRefs, formula.source_refs || []));
      const score =
        Number(topic?.priorityScore || 20) +
        Number(formula.exam_focus?.score || 0) +
        (formula.common_misuses || []).length * 8 +
        verifiedFormulaScore(formula);
      return {
        id: formula.formula_id || hashId("cram_formula", [formula.expression, formula.chapter_id]),
        name: formula.name || "公式",
        expression: formula.expression || "",
        topicTitle: topic?.title || "综合",
        priorityScore: score,
        conditions: formula.applicable_conditions && formula.applicable_conditions !== "unknown" ? formula.applicable_conditions : "回到来源页核对适用条件。",
        commonMisuses: (formula.common_misuses || []).filter((item) => item && item !== "unknown").slice(0, 3),
        referenceMatch: formula.reference_match || null,
        verificationStatus: formula.verification_status || formula.verification?.status || "unverified",
        sourceRefs: formula.source_refs || [],
        evidence: (formula.source_refs || []).slice(0, 2).map(toEvidence),
      };
    })
    .filter((formula) => formula.expression)
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

function buildPitfalls(courseModel, mistakes, focusTopics) {
  const topicByChapter = new Map(focusTopics.map((topic) => [topic.chapterId, topic]));
  const modelPitfalls = (courseModel.mistake_points || []).map((item) => {
    const topic = topicByChapter.get(item.chapter_id) || focusTopics.find((focus) => sourceRefsOverlap(focus.sourceRefs, item.source_refs || []));
    return {
      id: item.mistake_point_id || hashId("cram_pitfall", [item.description]),
      source: "资料易错点",
      text: item.description,
      topicTitle: topic?.title || "综合",
      priorityScore: Number(topic?.priorityScore || 20) + (item.severity === "high" ? 20 : 8),
      sourceRefs: item.source_refs || [],
      sourceDocumentIds: sourceDocumentIds(item.source_refs || []),
    };
  });
  const userPitfalls = mistakes.map((mistake) => {
    const topic = focusTopics.find((focus) => (mistake.sourceDocumentIds || []).some((docId) => focus.sourceDocumentIds.includes(docId)));
    return {
      id: mistake.id || hashId("cram_user_pitfall", [mistake.question, mistake.explanation]),
      source: mistake.mastered ? "已掌握错题" : "未掌握错题",
      text: mistake.explanation || mistake.question || "错题本条目",
      topicTitle: topic?.title || "错题回炉",
      priorityScore: Number(topic?.priorityScore || 30) + (mistake.mastered ? 6 : 26),
      sourceRefs: mistake.sourceRefs || mistake.source_refs || [],
      sourceDocumentIds: mistake.sourceDocumentIds || [],
    };
  });
  return uniqueBy([...modelPitfalls, ...userPitfalls], (item) => item.text)
    .filter((item) => item.text)
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

function rankMistakes(mistakes, focusTopics, nowDate) {
  return (mistakes || [])
    .map((mistake) => {
      const topic = focusTopics.find((focus) => (mistake.sourceDocumentIds || []).some((docId) => focus.sourceDocumentIds.includes(docId)));
      const age = daysBetween(new Date(mistake.updatedAt || mistake.createdAt || nowDate), nowDate);
      const score = Number(topic?.priorityScore || 30) + (mistake.mastered ? 5 : 32) + Math.min(18, Math.max(0, age || 0));
      return {
        id: mistake.id,
        question: mistake.question || "未命名错题",
        answer: mistake.answer || "",
        explanation: mistake.explanation || "",
        userAnswer: mistake.userAnswer || "",
        mastered: Boolean(mistake.mastered),
        topicTitle: topic?.title || "错题回炉",
        priorityScore: score,
        reason: mistake.mastered ? "已掌握，考前快速确认" : "未掌握，优先回炉",
        sourceRefs: mistake.sourceRefs || mistake.source_refs || [],
        sourceDocumentIds: mistake.sourceDocumentIds || [],
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

function selectDrillQuestions(questions, focusTopics, count) {
  const focusSourceIds = new Set(focusTopics.flatMap((topic) => topic.sourceDocumentIds || []));
  const focusConcepts = new Set(focusTopics.flatMap((topic) => topic.concepts || []));
  const typeWeights = {
    mistake_diagnosis: 22,
    formula_application: 20,
    exam_practice: 20,
    textbook_exercise: 19,
    calculation: 18,
    comprehensive: 18,
    variant: 14,
    derivation_proof: 12,
    concept_understanding: 10,
    subjective_recall: 8,
  };
  const scored = (questions || [])
    .map((question, index) => {
      const refs = question.source_refs || [];
      const docMatch = refs.some((ref) => focusSourceIds.has(ref.document_id));
      const conceptMatch = (question.related_concepts || []).some((concept) => focusConcepts.has(concept));
      const score = (docMatch ? 28 : 0) + (conceptMatch ? 18 : 0) + (typeWeights[question.question_type || question.type] || 6) - index * 0.01;
      return {
        ...question,
        sourceDocumentIds: question.sourceDocumentIds || sourceDocumentIds(refs),
        cramScore: score,
      };
    })
    .sort((a, b) => b.cramScore - a.cramScore);

  const picked = [];
  const typeCounts = new Map();
  for (const question of uniqueBy(scored, (item) => normalizeQuestion(item))) {
    const type = question.question_type || question.type || "unknown";
    if ((typeCounts.get(type) || 0) >= Math.ceil(count / 3) && picked.length < Math.floor(count * 0.7)) continue;
    picked.push(question);
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    if (picked.length >= count) break;
  }
  return picked;
}

function enrichQuestionsWithLearningPack(questions, courseModel) {
  const packQuestions = learningPackQuestions(courseModel.learning_pack, { limit: 12 }).map((question) => ({
    ...question,
    id: question.id || hashId("learning_pack_question", [question.question_text]),
    question_id: question.question_id || hashId("learning_pack_question", [question.question_text]),
    sourceDocumentIds: sourceDocumentIds(question.source_refs || []),
  }));
  return [...packQuestions, ...(questions || [])];
}

function buildTimeline({ totalMinutes, focusTopics, formulas, mistakeQueue, drillQuestions }) {
  const timeline = [];
  let remaining = totalMinutes;
  const push = (type, title, minutes, detail, extra = {}) => {
    if (remaining <= 0 || minutes <= 0) return;
    const safeMinutes = Math.min(remaining, Math.max(5, Math.round(minutes)));
    timeline.push({
      id: hashId("cram_step", [type, title, timeline.length]),
      type,
      title,
      minutes: safeMinutes,
      detail,
      ...extra,
    });
    remaining -= safeMinutes;
  };

  if (drillQuestions.length) {
    push("diagnostic", "限时诊断题", Math.min(15, Math.max(8, totalMinutes * 0.15)), "先做冲刺包里的前几道题，只标会 / 不会 / 易错。", {
      questionIds: drillQuestions.slice(0, 4).map((item) => item.question_id || item.id),
    });
  }
  for (const topic of focusTopics.slice(0, 3)) {
    push("topic", `闭卷复盘：${topic.title}`, Math.min(topic.durationMinutes, remaining), "不看资料写出概念、公式入口、第一步列式和最容易错的一点。", {
      topicId: topic.id,
      sourceDocumentIds: topic.sourceDocumentIds,
      sourceMistakeIds: topic.sourceMistakeIds,
    });
  }
  if (formulas.length) push("formula", "公式与适用条件核对", Math.min(18, remaining), "只背公式不够，每条都要补一句适用条件和单位检查。");
  if (mistakeQueue.length) push("mistakes", "错题回炉", Math.min(22, remaining), "优先重做未掌握错题，写出错误入口和正确第一步。");
  if (drillQuestions.length && remaining > 0) push("drill", "限时刷题", remaining, "用剩余时间做冲刺题，最后统一看答案。", {
    questionIds: drillQuestions.map((item) => item.question_id || item.id),
  });
  return timeline;
}

function scopeStats(courseModel, documents, mistakes, sessions) {
  const documentList = documents.length ? documents : courseModel.documents || [];
  return {
    documentCount: documentList.length,
    unitCount: documentList.reduce((sum, doc) => sum + Number(doc.units?.length || doc.unit_count || 0), 0),
    textLength: documentList.reduce((sum, doc) => sum + String(doc.text || "").length, 0),
    chapterCount: courseModel.stats?.chapters || courseModel.chapters?.length || 0,
    conceptCount: courseModel.stats?.concepts || courseModel.concepts?.length || 0,
    formulaCount: courseModel.stats?.formulas || courseModel.formulas?.length || 0,
    homeworkCount: courseModel.stats?.homework_problems || courseModel.homework_problems?.length || 0,
    materialMistakeCount: courseModel.stats?.mistake_points || courseModel.mistake_points?.length || 0,
    mistakeCount: mistakes.length,
    unmasteredMistakeCount: mistakes.filter((mistake) => !mistake.mastered).length,
    sessionCount: sessions.length,
  };
}

function relatedItems(items = [], chapter) {
  return (items || []).filter((item) => item?.chapter_id === chapter.chapter_id || sourceRefsOverlap(item?.source_refs || [], chapter.source_refs || []));
}

function mistakeMatchesChapter(mistake, chapter, concepts, formulas) {
  const chapterDocIds = new Set(sourceDocumentIds(chapter.source_refs || []));
  if ((mistake.sourceDocumentIds || []).some((docId) => chapterDocIds.has(docId))) return true;
  const text = compact(`${mistake.question || ""}\n${mistake.answer || ""}\n${mistake.explanation || ""}\n${mistake.userAnswer || ""}`);
  const title = compact(chapter.title || "");
  if (title && title !== "unknown" && (text.includes(title) || title.includes(text.slice(0, 18)))) return true;
  return [...(concepts || []).map((item) => item.name), ...(formulas || []).map((item) => item.name)]
    .filter(Boolean)
    .some((term) => text.includes(compact(term)));
}

function sessionMatchesChapter(session, chapter) {
  const text = compact(`${session.topicId || ""}\n${session.topicTitle || ""}\n${session.chapterTitle || ""}`);
  const title = compact(chapter.title || "");
  return text.includes(compact(chapter.chapter_id || "")) || (title && title !== "unknown" && (text.includes(title) || title.includes(text)));
}

function chapterReasons(chapter, parts) {
  const reasons = [];
  if (chapter.exam_focus?.level === "high") reasons.push("资料高频考点");
  if (parts.formulas.length) reasons.push(`${parts.formulas.length} 条公式`);
  if (parts.homework.length) reasons.push(`${parts.homework.length} 道作业/练习`);
  if (parts.examples.length) reasons.push(`${parts.examples.length} 个例题`);
  if (parts.modelMistakes.length) reasons.push(`${parts.modelMistakes.length} 个资料易错点`);
  const unmastered = parts.unmasteredMistakes.length;
  if (unmastered) reasons.push(`${unmastered} 条未掌握错题`);
  if (parts.sessionHits.length && !parts.recentPenalty) reasons.push("复盘过但需要保温");
  if (parts.recentPenalty) reasons.push("近期已复盘，已降权");
  return reasons.length ? reasons : ["资料覆盖较多，适合快速确认"];
}

function cramActions(entry) {
  const actions = ["闭卷写出本节解题入口：研究对象、受力/变形关系、第一步方程。"];
  if (entry.formulas.length) actions.push("逐条核对公式的适用条件、变量单位和正负号约定。");
  if (entry.homework.length || entry.examples.length) actions.push("重做一个来源例题或作业题，只看题干不看解答。");
  if (entry.userMistakes.some((mistake) => !mistake.mastered)) actions.push("把相关未掌握错题重做一遍，并写出错误入口。");
  if (entry.modelMistakes.length) actions.push("把资料中的易错提示改写成考场检查清单。");
  return actions;
}

function priorityLabel(score) {
  if (score >= 90) return "立即补";
  if (score >= 65) return "高优先级";
  if (score >= 40) return "快速确认";
  return "保温";
}

function sourceRefsOverlap(a = [], b = []) {
  const left = new Set(sourceDocumentIds(a));
  if (!left.size) return false;
  return sourceDocumentIds(b).some((docId) => left.has(docId));
}

function sourceLocation(sourceRefs = []) {
  const ref = sourceRefs[0];
  if (!ref) return "暂无资料定位";
  return `${ref.file_name || "资料"} / ${ref.unit_label || "全文"}`;
}

function toEvidence(ref) {
  return {
    docName: ref.file_name || "资料",
    file_name: ref.file_name || "资料",
    document_id: ref.document_id || "",
    label: ref.unit_label || "全文",
    unit_label: ref.unit_label || "全文",
    unit_index: Number.isInteger(Number(ref.unit_index)) ? Number(ref.unit_index) : undefined,
    anchor_label: ref.anchor_label || "",
    locator_label: ref.locator_label || "",
    locator_confidence: ref.locator_confidence || ref.confidence || "",
    excerpt: ref.excerpt || "",
    source_ref: ref,
    pageNumber: ref.page_number || null,
    documentId: ref.document_id || "",
  };
}

function refKey(ref) {
  return `${ref?.document_id || ""}:${ref?.unit_index ?? ""}:${ref?.excerpt || ""}`;
}

function latestDate(values) {
  const dates = values.map((value) => new Date(value)).filter((date) => Number.isFinite(date.getTime()));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function daysBetween(fromDate, toDate) {
  if (!fromDate || !Number.isFinite(fromDate.getTime())) return null;
  const end = toDate && Number.isFinite(toDate.getTime()) ? toDate : new Date();
  return Math.max(0, Math.floor((end - fromDate) / 86400000));
}

function normalizeQuestion(question) {
  return compact(question.question_text || question.stem || question.answer || "").slice(0, 120);
}

function compact(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function numberInRange(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.round(number)));
}

module.exports = {
  generateCramPack,
};
