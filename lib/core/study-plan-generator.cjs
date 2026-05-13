const { buildCourseKnowledgeModel, hashId, uniqueStrings } = require("./knowledge-model.cjs");

class StudyPlanGenerator {
  constructor(courseModel, questions = [], options = {}) {
    this.courseModel = courseModel;
    this.questions = Array.isArray(questions) ? questions : [];
    this.options = options || {};
  }

  generate(input = {}) {
    const today = startOfDay(input.today ? new Date(input.today) : new Date());
    const examDate = input.examDate ? startOfDay(new Date(input.examDate)) : addDays(today, 14);
    const daysUntilExam = Math.max(1, Math.ceil((examDate - today) / 86400000));
    const dailyMinutes = Math.max(20, Math.min(Number(input.dailyMinutes || input.daily_minutes || 90), 480));
    const goal = input.goal || "高分";
    const crammingMode = Boolean(input.crammingMode || input.cramming_mode || daysUntilExam <= 5);
    const chapters = this.rankChapters(input);
    const diagnosticTest = this.buildDiagnosticTest(chapters);
    const days = this.buildDays({ today, examDate, daysUntilExam, dailyMinutes, goal, crammingMode, chapters, input });
    const items = days.flatMap((day) =>
      day.tasks.map((task) => ({
        id: task.task_id,
        title: task.title,
        chapterTitle: day.focus,
        chapterLocation: sourceLocation(task.source_refs),
        priorityLabel: task.priority_label,
        durationMinutes: task.minutes,
        reason: task.reason,
        concepts: task.knowledge_points,
        formulas: task.formulas || [],
        checks: [task.output, task.completion_criteria],
        focusSteps: task.steps,
        nextAction: task.steps?.[0] || task.output,
        evidence: (task.source_refs || []).slice(0, 2).map((ref) => ({
          docName: ref.file_name,
          documentId: ref.document_id,
          label: ref.anchor_label || ref.locator_label || ref.unit_label,
          excerpt: ref.excerpt,
          source_ref: ref,
        })),
        sourceRefs: (task.source_refs || []).slice(0, 4),
        sourceDocumentIds: uniqueStrings((task.source_refs || []).map((ref) => ref.document_id)),
        sourceMistakeIds: task.source_mistake_ids || [],
        questionIds: task.question_ids || [],
        priorityScore: task.priority_score,
      })),
    );

    return {
      courseId: this.courseModel.course?.course_id,
      title: `${this.courseModel.course?.name || "当前科目"}动态复习计划`,
      generatedAt: new Date().toISOString(),
      mode: crammingMode ? "cramming" : "spaced",
      inputs: {
        examDate: formatDate(examDate),
        dailyMinutes,
        goal,
        crammingMode,
        daysUntilExam,
      },
      summary: {
        documentCount: this.courseModel.stats?.documents || this.courseModel.documents?.length || 0,
        topicCount: chapters.length,
        questionCount: this.questions.length,
        totalDays: days.length,
        dailyMinutes,
        weakChapterCount: chapters.filter((chapter) => chapter.mastery < 0.55).length,
        highFocusChapterCount: chapters.filter((chapter) => chapter.exam_focus?.level === "high").length,
      },
      diagnosticTest,
      nextReview: items[0] || null,
      items,
      days,
      warnings: this.warnings(chapters, days),
    };
  }

  rankChapters(input = {}) {
    const mastery = input.currentMastery || input.current_mastery || {};
    const overrides = input.chapterOverrides || input.chapter_overrides || {};
    const userMistakes = Array.isArray(input.mistakes) ? input.mistakes : [];
    const wrongText = userMistakes.map((mistake) => `${mistake.question || ""}\n${mistake.explanation || ""}`).join("\n");
    const chapters = (this.courseModel.chapters || []).map((chapter, index) => {
      const override = overrides[chapter.chapter_id] || overrides[chapter.title] || {};
      const relatedMistakes = (this.courseModel.mistake_points || []).filter((mistake) => mistake.chapter_id === chapter.chapter_id);
      const externalMistakeHits = userMistakes.filter((mistake) => {
        const sourceIds = new Set((chapter.source_refs || []).map((ref) => ref.document_id));
        return (mistake.sourceDocumentIds || []).some((docId) => sourceIds.has(docId)) || wrongText.includes(chapter.title);
      });
      const masteryScore =
        Number(override.mastery ?? mastery[chapter.chapter_id] ?? mastery[chapter.title] ?? (externalMistakeHits.length ? 0.35 : 0.65)) || 0.65;
      const difficultyWeight = { basic: 1, medium: 1.2, hard: 1.45, comprehensive: 1.65 }[override.difficulty || chapter.difficulty] || 1.2;
      const focusWeight = { low: 1, medium: 1.25, high: 1.55 }[override.importance || chapter.exam_focus?.level] || 1;
      const mistakeWeight = 1 + (relatedMistakes.length + externalMistakeHits.length) * 0.22;
      const priorityScore = Math.round((1.25 - Math.min(1, Math.max(0, masteryScore))) * 45 * difficultyWeight * focusWeight * mistakeWeight + index);
      return {
        ...chapter,
        mastery: Math.min(1, Math.max(0, masteryScore)),
        related_mistake_count: relatedMistakes.length + externalMistakeHits.length,
        priorityScore,
        priorityLabel: priorityScore >= 55 ? "高优先级" : priorityScore >= 32 ? "中优先级" : "巩固",
      };
    });
    return chapters.sort((a, b) => b.priorityScore - a.priorityScore || a.order - b.order);
  }

  buildDiagnosticTest(chapters) {
    const questionIds = [];
    for (const chapter of chapters.slice(0, 6)) {
      const question = this.questions.find((item) => sourceMatchesChapter(item.source_refs, chapter)) || this.questions[questionIds.length];
      if (question) questionIds.push(question.question_id || question.id);
    }
    return {
      title: "诊断测试",
      estimated_time: Math.max(15, questionIds.length * 5),
      question_ids: uniqueStrings(questionIds),
      purpose: "先识别薄弱章节，再调整后续每日任务权重。",
      completion_criteria: "完成后把每题标记为会 / 不会 / 易错，并更新当前掌握情况。",
    };
  }

  buildDays({ today, daysUntilExam, dailyMinutes, goal, crammingMode, chapters }) {
    const dayCount = Math.min(daysUntilExam, crammingMode ? 7 : 21);
    const days = [];
    const intervals = crammingMode ? [0, 1, 2] : [0, 1, 3, 7, 14];
    for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
      const date = addDays(today, dayIndex);
      const isFinal = dayIndex >= dayCount - 2;
      const focusChapters = pickChaptersForDay(chapters, dayIndex, crammingMode, isFinal);
      const tasks = [];
      let remaining = dailyMinutes;
      if (dayIndex === 0) {
        const minutes = Math.min(30, Math.max(15, Math.floor(dailyMinutes * 0.25)));
        tasks.push(this.task("diagnostic", "完成诊断测试", minutes, focusChapters[0], {
          output: "标记每道诊断题的掌握情况。",
          completion_criteria: "至少完成诊断测试并记录错因。",
          priority_score: 80,
        }));
        remaining -= minutes;
      }
      for (const chapter of focusChapters) {
        if (remaining <= 10) break;
        const firstPassMinutes = Math.min(remaining, crammingMode ? 25 : 35);
        tasks.push(this.task("review", `复习 ${chapter.title}`, firstPassMinutes, chapter, {
          output: "整理一页章节卡片：概念、公式、例题入口、易错点。",
          completion_criteria: "能不看资料复述核心概念，并完成至少一道关联题。",
          priority_score: chapter.priorityScore,
        }));
        remaining -= firstPassMinutes;
        if (remaining >= 15) {
          const practiceMinutes = Math.min(remaining, crammingMode || goal === "冲刺满分" ? 30 : 20);
          tasks.push(this.task("practice", `做题巩固 ${chapter.title}`, practiceMinutes, chapter, {
            output: "完成关联题并记录错因。",
            completion_criteria: "错题必须写出错误入口和正确第一步。",
            priority_score: chapter.priorityScore + 8,
          }));
          remaining -= practiceMinutes;
        }
      }
      for (const interval of intervals) {
        const targetDay = dayIndex - interval;
        if (targetDay < 0 || remaining < 10) continue;
        const chapter = chapters[(targetDay + interval) % Math.max(chapters.length, 1)];
        if (!chapter) continue;
        tasks.push(this.task("spaced_review", `间隔复习 ${chapter.title}`, Math.min(remaining, 12), chapter, {
          output: "闭卷复述公式适用条件和一个易错点。",
          completion_criteria: "复述后核对来源页，标记仍不熟的点。",
          priority_score: chapter.priorityScore - 8,
        }));
        remaining -= Math.min(remaining, 12);
      }
      if (isFinal && remaining >= 10) {
        const chapter = chapters[dayIndex % Math.max(chapters.length, 1)];
        tasks.push(this.task("exam_drill", "考前冲刺：高频题和错题回炉", remaining, chapter, {
          output: "完成高频公式、错题、综合题的限时训练。",
          completion_criteria: "所有错题写出二次错因；公式题能说明适用条件。",
          priority_score: 90,
        }));
      }
      days.push({
        day_index: dayIndex + 1,
        date: formatDate(date),
        total_minutes: dailyMinutes,
        mode: crammingMode || isFinal ? "cramming" : "spaced",
        focus: focusChapters.map((chapter) => chapter.title).join(" / ") || "综合复盘",
        tasks,
      });
    }
    return days;
  }

  task(type, title, minutes, chapter, overrides = {}) {
    const concepts = (this.courseModel.concepts || []).filter((concept) => concept.chapter_id === chapter?.chapter_id).map((concept) => concept.name);
    const formulas = (this.courseModel.formulas || []).filter((formula) => formula.chapter_id === chapter?.chapter_id).map((formula) => formula.expression);
    const questions = this.questions.filter((question) => sourceMatchesChapter(question.source_refs, chapter)).slice(0, type === "practice" ? 4 : 2);
    return {
      task_id: hashId("task", [type, title, chapter?.chapter_id, minutes]),
      type,
      title,
      minutes,
      priority_label: chapter?.priorityLabel || "巩固",
      priority_score: overrides.priority_score || chapter?.priorityScore || 20,
      reason: chapterReason(chapter),
      knowledge_points: uniqueStrings(concepts).slice(0, 5),
      formulas: uniqueStrings(formulas).slice(0, 3),
      question_ids: questions.map((question) => question.question_id || question.id),
      source_refs: chapter?.source_refs || [],
      source_mistake_ids: [],
      output: overrides.output,
      completion_criteria: overrides.completion_criteria,
      steps: taskSteps(type, chapter),
    };
  }

  warnings(chapters, days) {
    const warnings = [];
    if (!chapters.length) warnings.push("没有识别到章节，计划以综合复盘为主。");
    if (!this.questions.length) warnings.push("没有可关联题目，建议先生成题库再生成计划。");
    if (!days.length) warnings.push("考试日期无效或复习天数过短。");
    return warnings;
  }
}

function generateStudyPlan(courseOrModel, docsOrQuestions = [], options = {}) {
  const hasModel = courseOrModel?.schema_version && Array.isArray(courseOrModel?.chapters);
  const model = hasModel ? courseOrModel : buildCourseKnowledgeModel(courseOrModel, docsOrQuestions || []);
  const questions = hasModel ? docsOrQuestions || [] : [];
  return new StudyPlanGenerator(model, questions, options).generate(options);
}

function pickChaptersForDay(chapters, dayIndex, crammingMode, isFinal) {
  if (!chapters.length) return [];
  if (isFinal) return chapters.slice(0, crammingMode ? 3 : 2);
  const size = crammingMode ? 2 : 1;
  const start = dayIndex % chapters.length;
  return Array.from({ length: size }, (_, offset) => chapters[(start + offset) % chapters.length]).filter(Boolean);
}

function sourceMatchesChapter(sourceRefs = [], chapter) {
  if (!chapter) return false;
  const chapterSources = new Set((chapter.source_refs || []).map((ref) => `${ref.document_id}:${ref.unit_index}`));
  return (sourceRefs || []).some((ref) => chapterSources.has(`${ref.document_id}:${ref.unit_index}`) || chapterSources.has(`${ref.document_id}:0`));
}

function taskSteps(type, chapter) {
  const base = [`打开来源页：${sourceLocation(chapter?.source_refs || [])}`];
  if (type === "diagnostic") return ["限时完成诊断题。", "按会 / 不会 / 易错标记结果。", "把错因写成一句话。"];
  if (type === "practice") return [...base, "先独立做题，再看步骤解析。", "把错误归类为概念、公式、条件、单位或符号。"];
  if (type === "spaced_review") return [...base, "闭卷复述 3 分钟。", "回看资料补漏。"];
  if (type === "exam_drill") return ["优先做高频公式题、错题和综合题。", "限时完成。", "只补最影响得分的漏洞。"];
  return [...base, "整理核心概念和公式。", "完成一个例题或题库题。"];
}

function chapterReason(chapter) {
  if (!chapter) return ["资料不足，按综合复盘安排。"];
  const reasons = [];
  if (chapter.priorityLabel) reasons.push(chapter.priorityLabel);
  if (chapter.exam_focus?.level === "high") reasons.push("高频考点");
  if (chapter.related_mistake_count) reasons.push(`${chapter.related_mistake_count} 个错题/易错点`);
  if (chapter.mastery < 0.55) reasons.push("当前掌握偏弱");
  return reasons.length ? reasons : ["常规巩固"];
}

function sourceLocation(sourceRefs = []) {
  const ref = sourceRefs[0];
  if (!ref) return "暂无资料定位";
  return `${ref.file_name || "资料"} / ${ref.anchor_label || ref.locator_label || ref.unit_label || "全文"}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

module.exports = {
  StudyPlanGenerator,
  generateStudyPlan,
};
