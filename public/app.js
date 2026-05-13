(function () {
  const state = {
    data: null,
    currentCourseId: null,
    selectedDocumentIds: new Set(),
    editingCourseId: null,
    editingDocumentId: null,
    previewDocumentId: null,
    previewUnitIndex: 0,
    activeTab: "documents",
    currentQuiz: [],
    currentQuizEvaluation: null,
    currentCourseModel: null,
    currentMindMap: null,
    currentPlan: null,
    currentCramPack: null,
    apiModels: [],
    pendingSourceHighlight: null,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function workspace() {
    return state.data?.workspace || { courses: [], documents: [], providerLabel: "本地模式", stats: {} };
  }

  function courseViews() {
    const views = workspace().courses || [];
    return views.length ? views : state.data?.courses || [];
  }

  function courseView(courseId = state.currentCourseId) {
    return (workspace().courses || []).find((course) => course.id === courseId) || null;
  }

  function documentView(documentId) {
    return (workspace().documents || []).find((doc) => doc.id === documentId) || null;
  }

  function courseDocumentViews(courseId = state.currentCourseId) {
    return (workspace().documents || []).filter((doc) => doc.courseId === courseId);
  }

  function iconRefresh() {
    if (window.lucide) window.lucide.createIcons();
  }

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => el.classList.remove("show"), 2600);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      headers: options.body instanceof FormData ? undefined : { "content-type": "application/json" },
      ...options,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "请求失败");
    if (data.state) {
      state.data = data.state;
      keepValidCourse();
      render();
    }
    return data;
  }

  function keepValidCourse() {
    const courses = courseViews();
    if (!courses.length) {
      state.currentCourseId = null;
      state.selectedDocumentIds.clear();
      state.editingCourseId = null;
      state.editingDocumentId = null;
      state.previewDocumentId = null;
      state.previewUnitIndex = 0;
      state.currentPlan = null;
      state.currentCramPack = null;
      return;
    }
    if (!state.currentCourseId || !courses.some((course) => course.id === state.currentCourseId)) {
      state.currentCourseId = courses[0].id;
      state.selectedDocumentIds = new Set((courseView()?.stats?.selectedByDefaultDocumentIds || courseDocuments().map((doc) => doc.id)));
    }
    const validDocumentIds = new Set(courseDocuments().map((doc) => doc.id));
    state.selectedDocumentIds = new Set([...state.selectedDocumentIds].filter((docId) => validDocumentIds.has(docId)));
    if (state.editingCourseId && !courses.some((course) => course.id === state.editingCourseId)) state.editingCourseId = null;
    if (state.editingDocumentId && !validDocumentIds.has(state.editingDocumentId)) state.editingDocumentId = null;
    if (state.previewDocumentId && !validDocumentIds.has(state.previewDocumentId)) {
      state.previewDocumentId = courseDocuments()[0]?.id || null;
      state.previewUnitIndex = 0;
    }
  }

  function currentCourse() {
    return (state.data?.courses || []).find((course) => course.id === state.currentCourseId) || courseView();
  }

  function courseDocuments(courseId = state.currentCourseId) {
    return (state.data?.documents || []).filter((doc) => doc.courseId === courseId);
  }

  function courseMistakes(courseId = state.currentCourseId) {
    return (state.data?.mistakes || []).filter((mistake) => mistake.courseId === courseId);
  }

  function courseSessions(courseId = state.currentCourseId) {
    return (state.data?.sessions || []).filter((session) => session.courseId === courseId);
  }

  function selectedDocumentIds() {
    const docs = courseDocuments();
    const selected = docs.filter((doc) => state.selectedDocumentIds.has(doc.id)).map((doc) => doc.id);
    return selected.length ? selected : docs.map((doc) => doc.id);
  }

  function render() {
    renderCourses();
    renderStats();
    renderTopbar();
    renderDocuments();
    renderMistakes();
    renderPlanner();
    renderCramPack();
    renderSettings();
    iconRefresh();
  }

  function renderCourses() {
    const list = $("#course-list");
    const courses = courseViews();
    if (!courses.length) {
      list.innerHTML = '<p class="muted">先创建一个科目，比如“理论力学”。</p>';
      return;
    }
    list.innerHTML = courses
      .map((course) => {
        const docCount = Number(course.stats?.documents ?? courseDocuments(course.id).length);
        const mistakeCount = Number(course.stats?.mistakes ?? courseMistakes(course.id).length);
        const sessionCount = Number(course.stats?.sessions ?? courseSessions(course.id).length);
        const active = course.id === state.currentCourseId;
        const editForm =
          state.editingCourseId === course.id
            ? `<form class="course-edit-form" data-course-id="${course.id}">
              <input class="course-name-input" value="${escapeAttribute(course.name)}" autocomplete="off" aria-label="科目名称" />
              <div class="course-edit-actions">
                <button class="icon-button" type="submit" title="保存科目名称" aria-label="保存科目名称"><i data-lucide="check"></i></button>
                <button class="secondary-icon-button cancel-edit-course" type="button" title="取消" aria-label="取消"><i data-lucide="x"></i></button>
              </div>
            </form>`
            : "";
        return `<div class="course-item ${active ? "active" : ""}" data-course-id="${course.id}">
          <div class="course-row">
            <button class="course-button" type="button">
              <span>${escapeHtml(course.name)}</span>
              <small>${docCount} 资料${mistakeCount ? ` · ${mistakeCount} 错题` : ""}${sessionCount ? ` · ${sessionCount} 复盘` : ""}</small>
            </button>
            <div class="course-actions">
              <button class="secondary-icon-button edit-course" type="button" title="修改科目名称" aria-label="修改科目名称"><i data-lucide="pencil"></i></button>
              <button class="danger-icon-button delete-course" type="button" title="删除科目" aria-label="删除科目"><i data-lucide="trash-2"></i></button>
            </div>
          </div>
          ${editForm}
        </div>`;
      })
      .join("");
  }

  function renderStats() {
    const stats = courseView()?.stats || {};
    $("#stat-docs").textContent = Number(stats.documents ?? courseDocuments().length);
    $("#stat-mistakes").textContent = Number(stats.mistakes ?? courseMistakes().length);
    $("#stat-sessions").textContent = Number(stats.sessions ?? courseSessions().length);
  }

  function renderTopbar() {
    const course = currentCourse();
    $("#current-course-title").textContent = course ? course.name : "先新建一个科目";
    const provider = workspace().providerLabel || (state.data?.settings?.provider === "api" ? "API 增强版" : "本地模式");
    $("#provider-pill span").textContent = provider;
  }

  function renderDocuments() {
    const docs = courseDocuments();
    const list = $("#document-list");
    if (!docs.length) {
      list.innerHTML = '<article class="item-card"><p class="muted">还没有资料。先上传文件或粘贴纯文字例题。</p></article>';
      $("#doc-preview").textContent = "上传资料后，这里会显示抽取出的文本。";
      $("#doc-preview-meta").textContent = "暂无资料";
      $("#doc-outline").textContent = "上传资料后，这里会显示分页划分。";
      $("#doc-outline").className = "doc-outline empty-state";
      $("#doc-file-frame-wrap").hidden = true;
      state.previewDocumentId = null;
      state.previewUnitIndex = 0;
      return;
    }

    list.innerHTML = docs
      .map((doc) => {
        const view = documentView(doc.id) || {};
        const selected = state.selectedDocumentIds.has(doc.id);
        const textLength = view.textLengthLabel || (doc.text ? `${doc.text.length} 字` : "无文本");
        const warning = view.warning ? `<span class="chip warn">${escapeHtml(view.warning)}</span>` : "";
        const sourceChip = view.isTextExample ? '<span class="chip">纯文字例题</span>' : "";
        const quality = view.parseQuality || doc.parseQuality || doc.knowledgeModel?.parse_quality;
        const counts = quality?.counts || {};
        const qualityChip = quality
          ? `<span class="chip ${quality.level === "good" ? "good" : quality.level === "weak" ? "warn" : ""}">${escapeHtml(quality.label || `解析 ${Number(quality.score || 0)}`)}</span>`
          : '<span class="chip warn">待结构化</span>';
        const structureStats = quality
          ? `<div class="doc-structure">
            <span>章节 ${Number(counts.chapters || 0)}</span>
            <span>概念 ${Number(counts.concepts || 0)}</span>
            <span>公式 ${Number(counts.formulas || 0)}</span>
            <span>例题 ${Number(counts.examples || 0)}</span>
            <span>作业 ${Number(counts.homework_problems || 0)}</span>
            <span>易错 ${Number(counts.mistake_points || 0)}</span>
          </div>`
          : "";
        const keywords = (view.keywords || doc.keywords || [])
          .slice(0, 6)
          .map((word) => `<span class="chip">${escapeHtml(word)}</span>`)
          .join("");
        const editForm =
          state.editingDocumentId === doc.id
            ? `<form class="doc-edit-form" data-doc-id="${doc.id}">
              <label>
                资料名称
                <input class="doc-name-input" value="${escapeAttribute(doc.originalName)}" autocomplete="off" />
              </label>
              <label>
                文本内容
                <textarea class="doc-text-input">${escapeHtml(doc.text || "")}</textarea>
              </label>
              <div class="question-actions">
                <button class="primary-button" type="submit"><i data-lucide="save"></i>保存</button>
                <button class="secondary-button cancel-edit-doc" type="button"><i data-lucide="x"></i>取消</button>
              </div>
            </form>`
            : "";
        return `<article class="item-card ${selected ? "selected" : ""}" data-doc-id="${doc.id}">
          <div class="item-title-row">
            <label class="check-label">
              <input type="checkbox" class="doc-check" ${selected ? "checked" : ""} />
              <h4>${escapeHtml(doc.originalName)}</h4>
            </label>
            <div class="document-actions">
              <button class="secondary-button preview-doc" type="button"><i data-lucide="eye"></i>预览</button>
              <button class="secondary-button edit-doc" type="button"><i data-lucide="pencil"></i>修改</button>
              <button class="danger-button delete-doc" type="button"><i data-lucide="trash-2"></i>删除</button>
            </div>
          </div>
          <div class="doc-meta">
            <span class="chip">${escapeHtml(view.type || (doc.type || "file").toUpperCase())}</span>
            ${sourceChip}
            <span class="chip">${formatBytes(doc.size)}</span>
            <span class="chip">${textLength}</span>
            ${qualityChip}
            ${warning}
          </div>
          ${structureStats}
          <div class="doc-meta">${keywords}</div>
          ${editForm}
        </article>`;
      })
      .join("");

    const firstSelected = docs.find((doc) => state.selectedDocumentIds.has(doc.id)) || docs[0];
    const previewDoc = docs.find((doc) => doc.id === state.previewDocumentId) || firstSelected;
    showPreview(previewDoc, state.previewDocumentId ? state.previewUnitIndex : 0);
  }

  function showPreview(doc, unitIndex = 0) {
    if (!doc) return;
    const units = documentUnits(doc);
    const safeIndex = units.length ? Math.max(0, Math.min(Number(unitIndex) || 0, units.length - 1)) : 0;
    const unit = units[safeIndex];
    state.previewDocumentId = doc.id;
    state.previewUnitIndex = safeIndex;

    $("#doc-preview").textContent = unit?.text || doc.warning || "这份资料暂时没有可预览文本。";
    const highlight =
      state.pendingSourceHighlight?.docId === doc.id && state.pendingSourceHighlight?.unitIndex === safeIndex
        ? ` · 定位：${outlineTitle(state.pendingSourceHighlight.excerpt, 24)}`
        : "";
    $("#doc-preview-meta").textContent = `${doc.originalName} · ${unit?.label || "全文"} · ${documentView(doc.id)?.unitCountLabel || unitCountLabel(doc, units.length)}${highlight}`;
    renderDocOutline(doc, safeIndex);
    renderDocFrame(doc, unit, safeIndex);
  }

  function documentUnits(doc) {
    if (Array.isArray(doc?.units) && doc.units.length) return doc.units;
    if (doc?.text) return [{ label: "全文", text: doc.text }];
    return [];
  }

  function renderDocOutline(doc, activeUnitIndex) {
    const target = $("#doc-outline");
    const outline = documentView(doc.id)?.outline || buildDocOutline(doc);
    if (!Number(outline.units || 0)) {
      target.textContent = doc.warning || "这份资料暂时没有可划分的页面。";
      target.className = "doc-outline empty-state";
      return;
    }

    target.className = "doc-outline";
    const landmarkButtons = outline.landmarks
      .map(
        (item) => `<button class="outline-button outline-${item.type} ${item.unitIndex === activeUnitIndex ? "active" : ""}" type="button" data-doc-id="${doc.id}" data-unit-index="${item.unitIndex}" title="${escapeAttribute(item.title || `${item.pageLabel} ${item.label}`)}">
            <span>${escapeHtml(item.label)}</span>
            <small>${escapeHtml(item.pageLabel)}</small>
          </button>`,
      )
      .join("");
    const unitNavLabel = isPagedDocument(doc) ? "页码" : "段落";
    const pageButtons = outline.pages
      .map(
        (page) => `<div class="page-entry">
          <button class="page-button ${page.unitIndex === activeUnitIndex ? "active" : ""}" type="button" data-doc-id="${doc.id}" data-unit-index="${page.unitIndex}" title="${escapeAttribute(page.title)}">
            ${escapeHtml(page.shortLabel)}
          </button>
          <button class="page-delete-button delete-unit" type="button" data-doc-id="${doc.id}" data-unit-index="${page.unitIndex}" title="删除该页/片段" aria-label="删除该页/片段"><i data-lucide="trash-2"></i></button>
        </div>`,
      )
      .join("");

    target.innerHTML = `${landmarkButtons ? `<div class="outline-block">
        <div class="outline-label">重点划分</div>
        <div class="outline-buttons">${landmarkButtons}</div>
      </div>` : ""}
      <div class="outline-block">
        <div class="outline-label">${unitNavLabel}</div>
        <div class="page-grid">${pageButtons}</div>
      </div>`;
  }

  function buildDocOutline(doc) {
    const units = documentUnits(doc);
    const pages = units.map((unit, index) => {
      const pageNumber = unitPageNumber(unit, index);
      const pageLabel = pageNumber ? `第 ${pageNumber} 页` : unit.label || "全文";
      const title = outlineTitle(unit.text || unit.label || pageLabel, 42);
      return {
        shortLabel: pageNumber || unitShortLabel(unit, index),
        title: `${pageLabel} ${title}`,
        unitIndex: index,
      };
    });

    return { units: units.length, landmarks: [], pages };
  }

  function renderDocFrame(doc, unit, unitIndex) {
    const wrap = $("#doc-file-frame-wrap");
    const frame = $("#doc-file-frame");
    const link = $("#doc-file-link");
    const page = $("#doc-file-page");
    const type = String(doc.type || "").toLowerCase();
    if (!doc.storedName || type !== "pdf") {
      wrap.hidden = true;
      frame.removeAttribute("src");
      return;
    }

    const pageNumber = unitPageNumber(unit, unitIndex) || unitIndex + 1;
    const fileUrl = `/uploads/${encodeURIComponent(doc.storedName)}`;
    const previewUrl = `${fileUrl}#page=${pageNumber}&zoom=page-width`;
    page.textContent = `原文件 · 第 ${pageNumber} 页`;
    link.href = previewUrl;
    wrap.hidden = false;
    if (frame.src !== new URL(previewUrl, window.location.href).href) frame.src = previewUrl;
  }

  function unitPageNumber(unit, index) {
    const match = /第\s*(\d+)\s*页/.exec(String(unit?.label || ""));
    return match ? Number(match[1]) : null;
  }

  function unitShortLabel(unit, index) {
    const label = compactText(unit?.label || "");
    if (!label || label === "全文") return index + 1;
    return label.length > 6 ? `${label.slice(0, 5)}…` : label;
  }

  function isPagedDocument(doc) {
    const type = String(doc?.type || "").toLowerCase();
    if (type === "pdf" || type === "pptx") return true;
    return (doc?.units || []).some((unit) => /第\s*\d+\s*页/.test(String(unit?.label || "")));
  }

  function unitCountLabel(doc, count) {
    return `${count || 0} ${isPagedDocument(doc) ? "页" : "段"}`;
  }

  function outlineTitle(text, maxLength = 36) {
    const cleaned = compactText(text)
      .replace(/TaoFM-\s*/gi, "")
      .replace(/\b\d{4}\/\d{1,2}\/\d{1,2}\b/g, "")
      .replace(/\s+\d{1,3}\s*$/g, "")
      .trim();
    return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
  }

  function compactText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeEvidenceSource(item) {
    if (!item) return null;
    if (item.source_ref) return normalizeEvidenceSource({ ...item.source_ref, excerpt: item.source_ref.excerpt || item.excerpt });
    const ref = {
      document_id: item.document_id || item.documentId || "",
      file_name: item.file_name || item.docName || "",
      unit_index: item.unit_index,
      unit_label: item.unit_label || item.label || "全文",
      locator_label: item.locator_label || item.anchor_label || item.label || "",
      anchor_label: item.anchor_label || "",
      excerpt: item.excerpt || "",
      confidence: item.confidence || item.locator_confidence || "",
    };
    if (!ref.document_id && ref.file_name) {
      const doc = courseDocuments().find((candidate) => candidate.originalName === ref.file_name);
      if (doc) ref.document_id = doc.id;
    }
    return ref;
  }

  function sourceRefLabel(ref) {
    return ref?.anchor_label || ref?.locator_label || ref?.unit_label || ref?.label || "全文";
  }

  function sourceRefUnitIndex(ref) {
    const rawIndex = ref?.unit_index ?? ref?.unitIndex;
    if (rawIndex !== undefined && rawIndex !== null && rawIndex !== "" && Number.isInteger(Number(rawIndex))) return Number(rawIndex);
    const doc = courseDocuments().find((candidate) => candidate.id === ref?.document_id || candidate.originalName === ref?.file_name);
    if (!doc) return 0;
    const units = documentUnits(doc);
    const label = ref?.unit_label || ref?.label || "";
    const index = units.findIndex((unit) => unit.label === label);
    return index >= 0 ? index : 0;
  }

  function renderSourceRefs(refs, limit = 2) {
    return (refs || [])
      .map(normalizeEvidenceSource)
      .filter(Boolean)
      .slice(0, limit)
      .map(renderSourceRef)
      .join("");
  }

  function renderEvidenceItems(items, limit = 2) {
    return (items || [])
      .map(normalizeEvidenceSource)
      .filter(Boolean)
      .slice(0, limit)
      .map(renderSourceRef)
      .join("");
  }

  function renderSourceRef(ref) {
    const label = sourceRefLabel(ref);
    const docName = ref.file_name || "资料";
    const unitIndex = sourceRefUnitIndex(ref);
    const canJump = Boolean(ref.document_id);
    const confidence = ref.confidence || ref.locator_confidence || "";
    const excerpt = cleanEvidenceText(ref.excerpt || ref.anchor_text || "");
    const confidenceChip =
      confidence === "low"
        ? '<span class="source-confidence low">低置信</span>'
        : confidence === "high"
          ? '<span class="source-confidence high">高置信</span>'
          : "";
    const control = canJump
      ? `<button class="source-ref-button" type="button" data-doc-id="${escapeAttribute(ref.document_id)}" data-unit-index="${unitIndex}" data-source-excerpt="${escapeAttribute(excerpt)}" title="跳到来源">
          <i data-lucide="map-pin"></i>
          <span>${escapeHtml(docName)}</span>
          <small>${escapeHtml(label)}</small>
        </button>`
      : `<span class="source-ref-static"><span>${escapeHtml(docName)}</span><small>${escapeHtml(label)}</small></span>`;
    return `<div class="source-ref">
      <div class="source-ref-head">${control}${confidenceChip}</div>
      ${excerpt ? `<p>${renderTextWithInlineMath(excerpt)}</p>` : ""}
    </div>`;
  }

  function jumpToSourceRef(ref) {
    const source = normalizeEvidenceSource(ref);
    if (!source?.document_id) return false;
    const doc = courseDocuments().find((item) => item.id === source.document_id);
    if (!doc) return false;
    state.activeTab = "documents";
    $$(".tab-button").forEach((item) => item.classList.toggle("active", item.dataset.tab === "documents"));
    $$(".view").forEach((view) => view.classList.remove("active-view"));
    $("#view-documents").classList.add("active-view");
    const unitIndex = sourceRefUnitIndex(source);
    state.pendingSourceHighlight = {
      docId: doc.id,
      unitIndex,
      excerpt: compactText(source.excerpt || source.anchor_text || sourceRefLabel(source)),
    };
    showPreview(doc, unitIndex);
    toast(`已定位到 ${sourceRefLabel(source)}`);
    window.requestAnimationFrame(() => {
      $("#doc-preview")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return true;
  }

  function renderMistakes() {
    const list = $("#mistake-list");
    const mistakes = courseMistakes();
    if (!mistakes.length) {
      list.innerHTML = '<article class="item-card"><p class="muted">刷题时点击“加入错题”，这里会形成考前复盘清单。</p></article>';
      return;
    }
    list.innerHTML = mistakes
      .map((mistake) => `<article class="item-card" data-mistake-id="${mistake.id}">
        <div class="item-title-row">
          <h4>${escapeHtml(mistake.question || "未命名错题")}</h4>
          <div class="record-actions">
            <label class="check-label">
              <input type="checkbox" class="mastered-check" data-id="${mistake.id}" ${mistake.mastered ? "checked" : ""} />
              已掌握
            </label>
            <button class="danger-icon-button delete-mistake" type="button" title="删除错题" aria-label="删除错题"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
        <p><strong>我的答案：</strong>${escapeHtml(mistake.userAnswer || "未填写")}</p>
        <p><strong>参考答案：</strong>${escapeHtml(mistake.answer || "")}</p>
        ${mistake.explanation ? `<p><strong>解析：</strong>${escapeHtml(mistake.explanation)}</p>` : ""}
        <div class="question-actions">
          <button class="secondary-button similar-question" type="button"><i data-lucide="copy-plus"></i>生成同类题</button>
        </div>
      </article>`)
      .join("");
  }

  function renderPlanner() {
    const plan = state.currentPlan?.courseId === state.currentCourseId ? state.currentPlan : null;
    const nextTarget = $("#planner-next");
    const grid = $("#planner-grid");
    const sessions = courseSessions();
    renderSessionList(sessions);

    if (!state.currentCourseId) {
      nextTarget.className = "planner-next empty-state";
      nextTarget.textContent = "先新建或选择科目。";
      grid.innerHTML = "";
      return;
    }

    if (!plan) {
      nextTarget.className = "planner-next empty-state";
      nextTarget.textContent = "生成计划后，这里会显示下一步该复盘的章节或专题。";
      grid.innerHTML = "";
      return;
    }

    const summary = plan.summary || {};
    const next = plan.nextReview;
    const diagnostic = plan.diagnosticTest;
    nextTarget.className = "planner-next";
    nextTarget.innerHTML = `<div>
        <span class="map-label">下一步</span>
        <h3>${escapeHtml(next?.title || "暂无待复盘主题")}</h3>
        <p>${escapeHtml(next?.chapterTitle || "完成当前资料整理后再生成计划。")}</p>
        ${next?.nextAction ? `<p class="next-action">${escapeHtml(next.nextAction)}</p>` : ""}
        ${diagnostic ? `<p class="next-action">诊断：${escapeHtml(diagnostic.title)} · ${Number(diagnostic.estimated_time || 0)} 分钟 · ${Number(diagnostic.question_ids?.length || 0)} 题</p>` : ""}
        ${next?.chapterLocation ? `<div class="next-location"><i data-lucide="map-pin"></i>${escapeHtml(next.chapterLocation)}</div>` : ""}
      </div>
      <div class="planner-stats">
        <span><strong>${Number(summary.documentCount || 0)}</strong>资料</span>
        <span><strong>${Number(summary.topicCount || 0)}</strong>章节</span>
        <span><strong>${Number(summary.totalDays || 0)}</strong>天</span>
        <span><strong>${Number(summary.dailyMinutes || 0)}</strong>分钟/天</span>
      </div>`;

    const daySections = (plan.days || [])
      .map((day) => {
        const tasks = (day.tasks || [])
          .map((task) => `<li>
            <strong>${escapeHtml(task.title)}</strong>
            <span>${Number(task.minutes || 0)} 分钟</span>
            <p>${escapeHtml(task.output || "")}</p>
          </li>`)
          .join("");
        return `<section class="day-plan">
          <div class="day-plan-head">
            <span class="chip">第 ${Number(day.day_index || 0)} 天</span>
            <span class="chip">${escapeHtml(day.date || "")}</span>
            <span class="chip">${escapeHtml(day.mode || "")}</span>
          </div>
          <h4>${escapeHtml(day.focus || "综合复盘")}</h4>
          <ol>${tasks}</ol>
        </section>`;
      })
      .join("");

    const itemCards = (plan.items || [])
      .map((item, index) => {
        const reason = (item.reason || [])
          .map((entry) => `<span class="chip">${escapeHtml(entry)}</span>`)
          .join("");
        const concepts = (item.concepts || [])
          .slice(0, 5)
          .map((entry) => `<span>${escapeHtml(entry)}</span>`)
          .join("");
        const formulas = (item.formulas || [])
          .slice(0, 2)
          .map((entry) => `<li>${renderFormula(entry)}</li>`)
          .join("");
        const focusSteps = (item.focusSteps || [])
          .slice(0, 4)
          .map((entry) => `<li>${renderInlineText(entry)}</li>`)
          .join("");
        const evidence = (item.evidence || [])
          .slice(0, 2);
        const completed = item.completedCount ? `<span class="chip good">已完成 ${Number(item.completedCount)}</span>` : "";
        const lastReview = item.lastCompletedAt ? `<span class="chip good">上次 ${formatDateTime(item.lastCompletedAt)}</span>` : "";
        const mistakeNote = item.totalMistakes
          ? `<div class="mistake-note"><i data-lucide="bookmark-x"></i>${Number(item.totalMistakes)} 条相关错题，${Number(item.unmasteredMistakes || 0)} 条未掌握</div>`
          : "";
        return `<article class="plan-card tone-${escapeHtml(item.tone || "teal")}" data-plan-index="${index}">
          <div class="plan-card-head">
            <span class="node-icon"><i data-lucide="${escapeHtml(item.icon || "calendar-check")}"></i></span>
            <div>
              <div class="question-meta">
                <span class="chip">${escapeHtml(item.priorityLabel || "巩固")}</span>
                <span class="chip">${Number(item.durationMinutes || 20)} 分钟</span>
                ${item.unmasteredMistakes ? `<span class="chip warn">${Number(item.unmasteredMistakes)} 错题</span>` : ""}
                ${completed}
                ${lastReview}
              </div>
              <h4>${escapeHtml(item.title)}</h4>
              <p>${escapeHtml(item.chapterTitle || "")}</p>
            </div>
          </div>
          <div class="plan-location"><i data-lucide="map-pin"></i>${escapeHtml(item.chapterLocation || "暂无资料定位")}</div>
          <div class="doc-meta">${reason}</div>
          ${concepts ? `<div class="concept-strip">${concepts}</div>` : ""}
          ${mistakeNote}
          <div class="plan-body">
            <section>
              <strong>复盘动作</strong>
              <ol>${focusSteps}</ol>
            </section>
            ${formulas ? `<section><strong>公式</strong><ul>${formulas}</ul></section>` : ""}
          </div>
          ${evidence.length ? `<div class="node-evidence">${renderEvidenceItems(evidence)}</div>` : ""}
          <div class="question-actions">
            <button class="primary-button complete-session" type="button"><i data-lucide="check-circle-2"></i>标记完成</button>
            <button class="danger-button delete-plan-item" type="button"><i data-lucide="trash-2"></i>删除</button>
          </div>
        </article>`;
      })
      .join("");
    grid.innerHTML = `${daySections}${itemCards}`;
    renderMathIn(grid);
    iconRefresh();
  }

  function renderCramPack() {
    const target = $("#cram-output");
    if (!target) return;
    const pack = state.currentCramPack?.courseId === state.currentCourseId ? state.currentCramPack : null;
    if (!state.currentCourseId) {
      target.className = "cram-output empty-state";
      target.textContent = "先新建或选择科目。";
      return;
    }
    if (!pack) {
      target.className = "cram-output empty-state";
      target.textContent = "生成后会按该科目资料、错题和复盘记录汇总出今天最该做的冲刺清单。";
      return;
    }

    const scope = pack.scope || {};
    const summary = pack.summary || {};
    const timeline = (pack.timeline || [])
      .map((item, index) => `<li>
        <span>${String(index + 1).padStart(2, "0")}</span>
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.detail || "")}</p>
        </div>
        <em>${Number(item.minutes || 0)} 分钟</em>
      </li>`)
      .join("");
    const statCards = [
      ["资料", scope.documentCount],
      ["片段", scope.unitCount],
      ["文本字数", scope.textLength],
      ["公式", scope.formulaCount],
      ["未掌握错题", scope.unmasteredMistakeCount],
      ["复盘记录", scope.sessionCount],
    ]
      .map(([label, value]) => `<span><strong>${Number(value || 0).toLocaleString("zh-CN")}</strong>${escapeHtml(label)}</span>`)
      .join("");

    const focusCards = (pack.focusTopics || [])
      .map((topic, index) => {
        const reasons = (topic.reason || []).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("");
        const concepts = (topic.concepts || []).slice(0, 6).map((item) => `<span>${escapeHtml(item)}</span>`).join("");
        const formulas = (topic.formulas || []).slice(0, 3).map((item) => `<li>${renderFormula(item)}</li>`).join("");
        const actions = (topic.actions || []).slice(0, 5).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
        const pitfalls = (topic.pitfalls || []).slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
        const evidence = renderEvidenceItems([...(topic.sourceRefs || []), ...(topic.evidence || [])], 3);
        return `<article class="plan-card cram-topic-card" data-cram-topic-index="${index}">
          <div class="plan-card-head">
            <span class="node-icon"><i data-lucide="${index === 0 ? "flame" : "target"}"></i></span>
            <div>
              <div class="question-meta">
                <span class="chip warn">${escapeHtml(topic.priorityLabel || "冲刺")}</span>
                <span class="chip">${Number(topic.durationMinutes || 0)} 分钟</span>
                ${topic.sourceMistakeIds?.length ? `<span class="chip warn">${Number(topic.sourceMistakeIds.length)} 错题</span>` : ""}
                ${topic.completedCount ? `<span class="chip good">已复盘 ${Number(topic.completedCount)}</span>` : ""}
              </div>
              <h4>${escapeHtml(topic.title || "综合复盘")}</h4>
              <p>${escapeHtml(topic.sourceLocation || "暂无资料定位")}</p>
            </div>
          </div>
          <div class="doc-meta">${reasons}</div>
          ${concepts ? `<div class="concept-strip">${concepts}</div>` : ""}
          <div class="plan-body">
            <section><strong>冲刺动作</strong><ol>${actions}</ol></section>
            ${formulas ? `<section><strong>公式入口</strong><ul>${formulas}</ul></section>` : ""}
          </div>
          ${pitfalls ? `<div class="cram-pitfall-box"><strong>易错检查</strong><ul>${pitfalls}</ul></div>` : ""}
          ${evidence ? `<div class="source-ref-list">${evidence}</div>` : ""}
          <div class="question-actions">
            <button class="primary-button complete-cram-session" type="button"><i data-lucide="check-circle-2"></i>标记完成</button>
          </div>
        </article>`;
      })
      .join("");

    const formulaCards = (pack.formulas || [])
      .slice(0, 8)
      .map((formula) => `<article class="cram-mini-card">
        <div class="question-meta">
          <span class="chip">${escapeHtml(formula.topicTitle || "综合")}</span>
        </div>
        <h4>${escapeHtml(formula.name || "公式")}</h4>
        <div class="cram-formula">${renderFormula(formula.expression || "")}</div>
        <p>${escapeHtml(formula.conditions || "")}</p>
        ${(formula.commonMisuses || []).length ? `<ul>${formula.commonMisuses.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
        ${renderSourceRefs(formula.sourceRefs || [], 1)}
      </article>`)
      .join("");

    const pitfallCards = (pack.pitfalls || [])
      .slice(0, 8)
      .map((item) => `<article class="cram-mini-card">
        <div class="question-meta">
          <span class="chip ${item.source === "未掌握错题" ? "warn" : ""}">${escapeHtml(item.source || "易错")}</span>
          <span class="chip">${escapeHtml(item.topicTitle || "综合")}</span>
        </div>
        <p>${escapeHtml(item.text || "")}</p>
        ${renderSourceRefs(item.sourceRefs || [], 1)}
      </article>`)
      .join("");

    const mistakeCards = (pack.mistakeQueue || [])
      .slice(0, 6)
      .map((mistake) => `<article class="cram-mini-card">
        <div class="question-meta">
          <span class="chip ${mistake.mastered ? "good" : "warn"}">${mistake.mastered ? "已掌握" : "未掌握"}</span>
          <span class="chip">${escapeHtml(mistake.topicTitle || "错题")}</span>
        </div>
        <h4>${escapeHtml(mistake.question || "错题")}</h4>
        <p>${escapeHtml(mistake.reason || "")}</p>
      </article>`)
      .join("");

    const drillCards = (pack.drillQuestions || [])
      .slice(0, 6)
      .map((question, index) => `<article class="cram-question" data-cram-question-index="${index}">
        <div class="question-meta">
          <span class="chip">第 ${index + 1} 题</span>
          <span class="chip">${escapeHtml(typeLabel(question.question_type || question.type))}</span>
          <span class="chip">${escapeHtml(question.difficulty || "medium")}</span>
        </div>
        <p>${renderInlineText(question.question_text || question.stem || "")}</p>
        <button class="secondary-button show-cram-answer" type="button"><i data-lucide="book-open-check"></i>查看答案</button>
        <div class="answer-panel">${renderRichParagraphs(question.answer || "暂无参考答案。")}</div>
      </article>`)
      .join("");

    const warnings = (pack.warnings || []).slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    target.className = "cram-output";
    target.innerHTML = `<section class="cram-hero">
      <div>
        <span class="map-label">考前冲刺包</span>
        <h3>${escapeHtml(pack.title || "考前冲刺包")}</h3>
        <p>本次统计 ${Number(scope.documentCount || 0)} 份资料、${Number(scope.unitCount || 0)} 个片段、${Number(scope.mistakeCount || 0)} 条错题和 ${Number(scope.sessionCount || 0)} 条复盘记录。</p>
      </div>
      <div class="cram-stats">${statCards}</div>
    </section>
    <section class="cram-timeline">
      <div>
        <h4>今日执行顺序</h4>
        <p>${Number(summary.estimatedMinutes || 0)} 分钟 · ${Number(summary.focusTopicCount || 0)} 个专题 · ${Number(summary.drillQuestionCount || 0)} 道限时题</p>
      </div>
      <ol>${timeline}</ol>
    </section>
    ${warnings ? `<section class="cram-warning"><strong>解析提示</strong><ul>${warnings}</ul></section>` : ""}
    <section class="cram-section">
      <div class="section-heading"><h3>优先专题</h3><span class="muted">按资料频次、错题和复盘记录排序</span></div>
      <div class="cram-topic-grid">${focusCards || '<article class="item-card"><p class="muted">还没有可排序专题。</p></article>'}</div>
    </section>
    <section class="cram-two-col">
      <div>
        <div class="section-heading"><h3>必背公式</h3></div>
        <div class="cram-mini-grid">${formulaCards || '<article class="cram-mini-card"><p class="muted">未识别到公式。</p></article>'}</div>
      </div>
      <div>
        <div class="section-heading"><h3>易错清单</h3></div>
        <div class="cram-mini-grid">${pitfallCards || '<article class="cram-mini-card"><p class="muted">未识别到易错点。</p></article>'}</div>
      </div>
    </section>
    <section class="cram-two-col">
      <div>
        <div class="section-heading"><h3>错题回炉</h3></div>
        <div class="cram-mini-grid">${mistakeCards || '<article class="cram-mini-card"><p class="muted">暂无错题。</p></article>'}</div>
      </div>
      <div>
        <div class="section-heading">
          <h3>限时题</h3>
          <button class="secondary-button use-cram-drill" type="button"><i data-lucide="pencil-ruler"></i>放入刷题区</button>
        </div>
        <div class="cram-question-list">${drillCards || '<article class="cram-mini-card"><p class="muted">暂无可用题目。</p></article>'}</div>
      </div>
    </section>`;
    renderMathIn(target);
    iconRefresh();
  }

  function renderSessionList(sessions) {
    const list = $("#session-list");
    if (!sessions.length) {
      list.innerHTML = '<article class="item-card"><p class="muted">完成计划项后，这里会记录复盘历史。</p></article>';
      return;
    }
    list.innerHTML = sessions
      .slice(0, 8)
      .map((session) => `<article class="item-card session-card" data-session-id="${session.id}">
        <div class="item-title-row">
          <div>
            <h4>${escapeHtml(session.topicTitle || "复盘记录")}</h4>
            <p class="muted">${escapeHtml(session.chapterTitle || "未关联章节")}</p>
          </div>
          <div class="record-actions">
            <span class="chip good">${formatDateTime(session.completedAt || session.createdAt)}</span>
            <button class="danger-icon-button delete-session" type="button" title="删除复盘记录" aria-label="删除复盘记录"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
        <div class="doc-meta">
          <span class="chip">${Number(session.durationMinutes || 0)} 分钟</span>
          <span class="chip">${(session.sourceDocumentIds || []).length} 资料</span>
          <span class="chip">${(session.sourceMistakeIds || []).length} 错题</span>
        </div>
        ${session.notes ? `<p>${escapeHtml(session.notes)}</p>` : ""}
      </article>`)
      .join("");
  }

  function renderSettings() {
    const settings = state.data?.settings || {};
    $$('input[name="provider"]').forEach((radio) => {
      radio.checked = radio.value === (settings.provider || "local");
    });
    $("#api-base-url").value = settings.apiBaseUrl || "";
    renderApiModelSelect(settings.model || "");
    $("#api-key").placeholder = settings.apiKey ? "已保存，留空不修改" : "留空表示不使用 API";
    $("#clear-api-key").checked = false;
    const status = $("#api-connection-status");
    if (status && !status.dataset.pinned) {
      status.className = "settings-status muted";
      status.textContent = settings.apiKey ? "已保存 API Key，可检测模型或测试连接。" : "先填写 Base URL 和 API Key，然后检测模型。";
    }
  }

  function renderApiModelSelect(selectedModel = "") {
    const select = $("#api-model");
    if (!select) return;
    const existing = Array.from(new Set([...state.apiModels.map((model) => model.id), selectedModel].filter(Boolean)));
    select.innerHTML = existing.length
      ? existing.map((modelId) => `<option value="${escapeHtml(modelId)}">${escapeHtml(modelId)}</option>`).join("")
      : '<option value="">请先检测模型</option>';
    select.value = selectedModel && existing.includes(selectedModel) ? selectedModel : existing[0] || "";
    select.disabled = !existing.length;
  }

  function apiSettingsPayload() {
    return {
      provider: $('input[name="provider"]:checked')?.value || "local",
      apiBaseUrl: $("#api-base-url").value,
      model: $("#api-model").value,
      apiKey: $("#api-key").value,
      clearApiKey: $("#clear-api-key").checked,
    };
  }

  function setApiStatus(message, type = "muted") {
    const status = $("#api-connection-status");
    if (!status) return;
    status.dataset.pinned = "true";
    status.className = `settings-status ${type}`;
    status.textContent = message;
  }

  async function refreshApiModels() {
    const button = $("#refresh-api-models");
    button.disabled = true;
    button.innerHTML = '<i data-lucide="loader-circle"></i>检测中';
    setApiStatus("正在读取 API 提供的模型列表...", "muted");
    try {
      const data = await api("/api/settings/models", {
        method: "POST",
        body: JSON.stringify(apiSettingsPayload()),
      });
      state.apiModels = data.models || [];
      renderApiModelSelect(data.selectedModel || $("#api-model").value);
      setApiStatus(`检测成功：找到 ${state.apiModels.length} 个模型。请选择模型后保存。`, "good");
      toast("模型列表已更新");
    } catch (error) {
      setApiStatus(error.message, "bad");
      toast(error.message);
    } finally {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="refresh-cw"></i>检测模型';
      iconRefresh();
    }
  }

  async function testApiConnection() {
    const button = $("#test-api-connection");
    button.disabled = true;
    button.innerHTML = '<i data-lucide="loader-circle"></i>测试中';
    setApiStatus("正在测试选中模型的 Chat Completions 连接...", "muted");
    try {
      const data = await api("/api/settings/test", {
        method: "POST",
        body: JSON.stringify(apiSettingsPayload()),
      });
      state.apiModels = data.models || state.apiModels;
      renderApiModelSelect(data.selectedModel || $("#api-model").value);
      setApiStatus(data.message || "API 连接成功。", "good");
      toast("API 连接成功");
    } catch (error) {
      setApiStatus(error.message, "bad");
      toast(error.message);
    } finally {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="plug-zap"></i>测试连接';
      iconRefresh();
    }
  }

  function renderMarkdown(target, markdown) {
    if (window.marked) {
      target.innerHTML = window.marked.parse(markdown || "");
    } else {
      target.innerHTML = `<pre>${escapeHtml(markdown || "")}</pre>`;
    }
    renderMathIn(target);
  }

  const MATH_DELIMITER_PATTERN = /(\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$\$[\s\S]+?\$\$|\$[^$\n]+\$)/g;
  const FRONTEND_GREEK_ALIASES = [
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
  ];

  const FRONTEND_SYMBOLS = new Map([
    ["σ", "\\sigma"],
    ["ε", "\\varepsilon"],
    ["τ", "\\tau"],
    ["γ", "\\gamma"],
    ["θ", "\\theta"],
    ["φ", "\\varphi"],
    ["ϕ", "\\varphi"],
    ["ω", "\\omega"],
    ["Ω", "\\Omega"],
    ["μ", "\\mu"],
    ["ν", "\\nu"],
    ["π", "\\pi"],
    ["Δ", "\\Delta"],
    ["δ", "\\delta"],
    ["ψ", "\\psi"],
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

  function renderMathIn(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!hasMathDelimiter(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (parent?.closest("code, pre, textarea, .math-formula")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const fragment = document.createDocumentFragment();
      const segments = splitMathSegments(node.nodeValue);
      if (segments.length === 1 && !segments[0].math) continue;
      for (const segment of segments) {
        if (segment.math) {
          const wrapper = document.createElement("span");
          wrapper.className = `math-formula${segment.display ? " math-display" : ""}`;
          const normalized = normalizeFormulaForDisplay(segment.value);
          wrapper.title = normalized;
          wrapper.innerHTML = texToHtml(normalized);
          fragment.appendChild(wrapper);
        } else if (segment.value) {
          fragment.appendChild(document.createTextNode(segment.value));
        }
      }
      node.parentNode.replaceChild(fragment, node);
    }
  }

  function hasMathDelimiter(value) {
    return /(?:\\\(|\\\[|\$)/.test(String(value || ""));
  }

  function splitMathSegments(value) {
    const text = String(value || "");
    const segments = [];
    let lastIndex = 0;
    for (const match of text.matchAll(MATH_DELIMITER_PATTERN)) {
      if (match.index > lastIndex) segments.push({ math: false, value: text.slice(lastIndex, match.index) });
      segments.push(mathSegmentFromDelimiter(match[0]));
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) segments.push({ math: false, value: text.slice(lastIndex) });
    return segments.length ? segments : [{ math: false, value: text }];
  }

  function mathSegmentFromDelimiter(value) {
    const raw = String(value || "");
    if (raw.startsWith("$$") && raw.endsWith("$$")) return { math: true, display: true, value: raw.slice(2, -2).trim() };
    if (raw.startsWith("\\[") && raw.endsWith("\\]")) return { math: true, display: true, value: raw.slice(2, -2).trim() };
    if (raw.startsWith("\\(") && raw.endsWith("\\)")) return { math: true, display: false, value: raw.slice(2, -2).trim() };
    if (raw.startsWith("$") && raw.endsWith("$")) return { math: true, display: false, value: raw.slice(1, -1).trim() };
    return { math: false, value: raw };
  }

  function renderFormula(value, options = {}) {
    const normalized = normalizeFormulaForDisplay(String(value || "").replace(/^\$|\$$/g, ""));
    if (!normalized) return "";
    const className = `math-formula${options.display ? " math-display" : ""}`;
    return `<span class="${className}" title="${escapeAttribute(normalized)}">${texToHtml(normalized)}</span>`;
  }

  function normalizeFormulaForDisplay(value) {
    let expression = compactText(value)
      .replace(/^\\\(|\\\)$/g, "")
      .replace(/^\\\[|\\\]$/g, "")
      .replace(/^\${1,2}|\${1,2}$/g, "")
      .replace(/[：]/g, ":")
      .replace(/[（]/g, "(")
      .replace(/[）]/g, ")")
      .replace(/\bF\s+N\b/g, "F_N")
      .replace(/\bFN\b/g, "F_N")
      .replace(/\bP\s*cr\b/gi, "P_{cr}")
      .replace(/\bM\s*max\b/gi, "M_{\\max}")
      .replace(/<=/g, "\\le")
      .replace(/>=/g, "\\ge")
      .replace(/!=/g, "\\ne")
      .replace(/->/g, "\\to")
      .replace(/→/g, "\\to");
    for (const [char, replacement] of FRONTEND_SYMBOLS.entries()) {
      expression = expression.split(char).join(replacement);
    }
    for (const [word, replacement] of FRONTEND_GREEK_ALIASES) {
      expression = replaceUnescapedWord(expression, word, replacement);
    }
    expression = expression
      .replace(/\bA\s+F_N\s*=\s*\\sigma\b/gi, "\\sigma = F_N / A")
      .replace(/\bF_N\s+A\s*=\s*\\sigma\b/gi, "\\sigma = F_N / A")
      .replace(/\\sigma\s*=\s*F_N\s+A\b/gi, "\\sigma = F_N / A")
      .replace(/\\sigma\s*=\s*\(?\s*F_N\s*\)?\s*\/\s*\(?\s*A\s*\)?/gi, "\\sigma = F_N / A")
      .replace(/\\sigma\s*=\s*\(?\s*F\s*\)?\s*\/\s*\(?\s*A\s*\)?/gi, "\\sigma = F / A")
      .replace(/\bM([xy])\b/g, "M $1")
      .replace(/\bF([Ll])\b/g, "F $1")
      .replace(/\bl\s*0\b/g, "l_0")
      .replace(/\bdfrac\b/g, "frac")
      .replace(/\btfrac\b/g, "frac")
      .replace(/(\\?[A-Za-z]+|[A-Z])_([A-Za-z0-9,]+|\\[A-Za-z]+)(?![}])/g, "$1_{$2}")
      .replace(/(\\?[A-Za-z]+|[A-Z])\^([A-Za-z0-9]+|\\[A-Za-z]+)(?![}])/g, "$1^{$2}")
      .replace(/_\{max\}/gi, "_{\\max}")
      .replace(/_\{min\}/gi, "_{\\min}");
    expression = normalizeSimpleDisplayFraction(expression);
    return expression
      .replace(/\s*([=<>])\s*/g, " $1 ")
      .replace(/\s*(\\le|\\ge|\\ne|\\approx|\\to|\\pm)\s*/g, " $1 ")
      .replace(/\{\s+/g, "{")
      .replace(/\s+\}/g, "}")
      .replace(/\}(?=[A-Za-z\\])/g, "} ")
      .replace(/\s+([,.;，。；])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function normalizeSimpleDisplayFraction(value) {
    const expression = String(value || "");
    const comparison = expression.match(/^(.*?)\s*(=|\\le|\\ge|\\approx|<|>)\s*(.*?)$/);
    if (comparison) {
      return `${comparison[1].trim()} ${comparison[2]} ${normalizeSimpleDisplayFraction(comparison[3].trim())}`;
    }
    const fraction = expression.match(/^(.+?)\s*\/\s*(.+)$/);
    if (!fraction) return expression;
    const numerator = stripDisplayDelimiters(fraction[1]);
    const denominator = stripDisplayDelimiters(fraction[2]);
    if (!numerator || !denominator || /[+\-=<>]/.test(numerator) || /[+\-=<>]/.test(denominator)) return expression;
    return `\\frac{${numerator}}{${denominator}}`;
  }

  function stripDisplayDelimiters(value) {
    return String(value || "")
      .trim()
      .replace(/^\((.*)\)$/u, "$1")
      .trim();
  }

  function replaceUnescapedWord(value, word, replacement) {
    const pattern = new RegExp(`(^|[^\\\\A-Za-z])\\b${word}(?=\\b|_)`, "g");
    return String(value || "").replace(pattern, (_, prefix) => `${prefix}${replacement}`);
  }

  function texToHtml(tex) {
    const parser = new TexParser(tex || "");
    return parser.parseExpression();
  }

  class TexParser {
    constructor(input) {
      this.input = input;
      this.index = 0;
    }

    parseExpression(stopChar = "") {
      const parts = [];
      while (this.index < this.input.length) {
        const char = this.input[this.index];
        if (stopChar && char === stopChar) break;
        if (char === "\\") parts.push(this.parseCommand());
        else if (char === "^" || char === "_") parts.push(this.parseDetachedScript(char));
        else if (char === "{") {
          this.index += 1;
          const inner = this.parseExpression("}");
          if (this.input[this.index] === "}") this.index += 1;
          parts.push(inner);
        } else if (char === "}") {
          break;
        } else {
          this.index += 1;
          parts.push(this.decorateToken(escapeHtml(char)));
        }
      }
      return this.attachScripts(parts.join(""));
    }

    parseCommand() {
      this.index += 1;
      const start = this.index;
      while (/[A-Za-z]/.test(this.input[this.index] || "")) this.index += 1;
      const name = this.input.slice(start, this.index);
      if (!name) {
        const symbol = this.input[this.index] || "";
        this.index += 1;
        if (symbol === "," || symbol === " ") return '<span class="thin-space"></span>';
        if (symbol === "%") return "%";
        return escapeHtml(symbol);
      }
      if (name === "frac") {
        const numerator = this.parseGroup();
        const denominator = this.parseGroup();
        return `<span class="math-frac"><span>${numerator}</span><span>${denominator}</span></span>`;
      }
      if (name === "sqrt") {
        const degree = this.parseOptionalBracket();
        return `<span class="math-root">${degree ? `<sup>${degree}</sup>` : ""}√<span>${this.parseGroup()}</span></span>`;
      }
      if (name === "left" || name === "right" || name === "big" || name === "Big" || name === "bigg" || name === "Bigg") return this.parseDelimiter();
      if (name === "ddot") return `<span class="math-accent">${this.parseGroup()}<span>¨</span></span>`;
      if (name === "dot") return `<span class="math-accent">${this.parseGroup()}<span>˙</span></span>`;
      if (name === "hat") return `<span class="math-accent">${this.parseGroup()}<span>^</span></span>`;
      if (name === "vec" || name === "overrightarrow") return `<span class="math-accent">${this.parseGroup()}<span>→</span></span>`;
      if (name === "bar") return `<span class="math-overline">${this.parseGroup()}</span>`;
      if (name === "overline") return `<span class="math-overline">${this.parseGroup()}</span>`;
      if (name === "mathrm" || name === "mathbf" || name === "operatorname" || name === "text") return `<span class="math-text">${this.parseGroup()}</span>`;
      if (name === "int") return "∫";
      if (name === "sum") return "∑";
      if (name === "prod") return "∏";
      if (name === "max") return "max";
      if (name === "min") return "min";
      if (name === "pm") return "±";
      if (name === "mp") return "∓";
      if (name === "le" || name === "leq") return "≤";
      if (name === "ge" || name === "geq") return "≥";
      if (name === "ne" || name === "neq") return "≠";
      if (name === "equiv") return "≡";
      if (name === "approx") return "≈";
      if (name === "to" || name === "rightarrow") return "→";
      if (name === "leftarrow") return "←";
      if (name === "infty") return "∞";
      if (name === "partial") return "∂";
      if (name === "nabla") return "∇";
      if (name === "times") return "×";
      if (name === "cdot") return "·";
      if (name === "div") return "÷";
      if (name === "circ" || name === "degree") return "°";
      if (name === "parallel") return "∥";
      if (name === "perp") return "⊥";
      if (name === "propto") return "∝";
      if (name === "therefore") return "∴";
      if (name === "because") return "∵";
      if (name === "ldots" || name === "cdots" || name === "dots") return "…";
      if (name === "sigma_s") return "σ<sub>s</sub>";
      if (name === "sigma_b") return "σ<sub>b</sub>";
      if (["sin", "cos", "tan", "cot", "sec", "csc", "lim", "ln", "log"].includes(name)) return name;
      if (name === "quad" || name === "qquad") return '<span class="thin-space"></span><span class="thin-space"></span>';
      if (name === ",") return '<span class="thin-space"></span>';
      if (name === "%") return "%";
      if (DELIMITER_SYMBOLS[name]) return escapeHtml(DELIMITER_SYMBOLS[name]);
      return escapeHtml(TEX_SYMBOLS[name] || `\\${name}`);
    }

    parseGroup() {
      this.skipSpaces();
      if (this.input[this.index] !== "{") {
        const char = this.input[this.index] || "";
        this.index += 1;
        return escapeHtml(char);
      }
      this.index += 1;
      const inner = this.parseExpression("}");
      if (this.input[this.index] === "}") this.index += 1;
      return inner;
    }

    parseDelimiter() {
      this.skipSpaces();
      if (this.input[this.index] === "\\") {
        this.index += 1;
        const start = this.index;
        while (/[A-Za-z]/.test(this.input[this.index] || "")) this.index += 1;
        return escapeHtml(DELIMITER_SYMBOLS[this.input.slice(start, this.index)] || "");
      }
      const delimiter = this.input[this.index] || "";
      this.index += 1;
      return delimiter === "." ? "" : escapeHtml(delimiter);
    }

    parseDetachedScript(kind) {
      this.index += 1;
      const value = this.parseGroup();
      return kind === "^" ? `<sup>${value}</sup>` : `<sub>${value}</sub>`;
    }

    parseOptionalBracket() {
      this.skipSpaces();
      if (this.input[this.index] !== "[") return "";
      this.index += 1;
      const parts = [];
      while (this.index < this.input.length && this.input[this.index] !== "]") {
        parts.push(this.parseExpression("]"));
      }
      if (this.input[this.index] === "]") this.index += 1;
      return parts.join("");
    }

    attachScripts(html) {
      return html
        .replace(/(<span class="math-frac">[\s\S]*?<\/span>)_\{([^{}]+)\}/g, '$1<sub>$2</sub>')
        .replace(/((?:<span[^>]*>[\s\S]*?<\/span>)|[A-Za-zΑ-ωσσετγθφωΩμνπΔδψ∫∑\]\)])_\{([^{}]+)\}/g, "$1<sub>$2</sub>")
        .replace(/((?:<span[^>]*>[\s\S]*?<\/span>)|[A-Za-zΑ-ωσσετγθφωΩμνπΔδψ∫∑\]\)])\^(\d|[A-Za-z])/g, "$1<sup>$2</sup>")
        .replace(/((?:<span[^>]*>[\s\S]*?<\/span>)|[A-Za-zΑ-ωσσετγθφωΩμνπΔδψ∫∑\]\)])\^\{([^{}]+)\}/g, "$1<sup>$2</sup>");
    }

    decorateToken(token) {
      if (token === " ") return " ";
      return token;
    }

    skipSpaces() {
      while (/\s/.test(this.input[this.index] || "")) this.index += 1;
    }
  }

  const TEX_SYMBOLS = {
    Delta: "Δ",
    alpha: "α",
    beta: "β",
    delta: "δ",
    epsilon: "ε",
    varepsilon: "ε",
    gamma: "γ",
    lambda: "λ",
    mu: "μ",
    nu: "ν",
    omega: "ω",
    Omega: "Ω",
    phi: "φ",
    varphi: "φ",
    pi: "π",
    psi: "ψ",
    rho: "ρ",
    sigma: "σ",
    tau: "τ",
    theta: "θ",
  };

  const DELIMITER_SYMBOLS = {
    lbrace: "{",
    rbrace: "}",
    lceil: "⌈",
    rceil: "⌉",
    lfloor: "⌊",
    rfloor: "⌋",
    langle: "⟨",
    rangle: "⟩",
    lvert: "|",
    rvert: "|",
    vert: "|",
    Vert: "‖",
    };

  function renderKnowledgeMap(map) {
    const target = $("#knowledge-map");
    if (map?.cardDeck?.cards?.length) {
      renderKnowledgeCardDeck(map, target);
      return;
    }
    if (map?.nodes?.length) {
      renderGraphMindMap(map, target);
      return;
    }
    if (!map?.topics?.length) {
      target.className = "knowledge-map empty-state";
      target.textContent = "还没有足够内容生成知识地图。";
      return;
    }
    target.className = "knowledge-map";
    const keywordChips = (map.keywords || [])
      .slice(0, 12)
      .map((word) => `<span>${escapeHtml(word)}</span>`)
      .join("");
    const topicCards = map.topics
      .map((topic, index) => {
        const concepts = (topic.concepts || [])
          .slice(0, 6)
          .map((item) => `<li>${renderTextWithInlineMath(item)}</li>`)
          .join("");
        const formulas = (topic.formulas || [])
          .slice(0, 4)
          .map((item) => `<li>${renderFormula(item)}</li>`)
          .join("");
        const checks = (topic.checks || [])
          .slice(0, 3)
          .map((item) => `<li>${renderTextWithInlineMath(item)}</li>`)
          .join("");
        const evidence = renderEvidenceItems(topic.evidence || [], 2);
        return `<article class="mind-node tone-${escapeHtml(topic.tone || "teal")}" style="--node-index:${index}">
          <div class="node-title">
            <span class="node-icon"><i data-lucide="${escapeHtml(topic.icon || "circle-dot")}"></i></span>
            <div>
              <h4>${escapeHtml(topic.title)}</h4>
              <small>命中 ${Number(topic.score || 0)} 处资料线索</small>
            </div>
          </div>
          <div class="node-grid">
            ${concepts ? `<section><strong>概念</strong><ul>${concepts}</ul></section>` : ""}
            ${formulas ? `<section><strong>公式</strong><ul>${formulas}</ul></section>` : ""}
            ${checks ? `<section><strong>检查点</strong><ul>${checks}</ul></section>` : ""}
          </div>
          ${evidence ? `<div class="node-evidence">${evidence}</div>` : ""}
        </article>`;
      })
      .join("");
    const relationships = (map.relationships || [])
      .map((item) => `<li>${renderTextWithInlineMath(item)}</li>`)
      .join("");
    const pitfalls = (map.pitfalls || [])
      .slice(0, 5)
      .map((item) => `<li>${renderTextWithInlineMath(item)}</li>`)
      .join("");

    target.innerHTML = `<section class="map-header">
      <div class="map-center">
        <span class="map-label">知识地图</span>
        <h3>${escapeHtml(map.title || "当前科目")}</h3>
        <div class="keyword-strip">${keywordChips}</div>
      </div>
      <div class="map-side">
        <h4>概念关系</h4>
        <ul>${relationships || "<li>先把概念、公式、适用条件和题型串起来。</li>"}</ul>
      </div>
    </section>
    <section class="mind-grid">${topicCards}</section>
    <section class="review-lanes">
      <article>
        <h4>通用解题流程</h4>
        <ol>${(map.workflow || []).map((item) => `<li>${renderTextWithInlineMath(item)}</li>`).join("")}</ol>
      </article>
      <article>
        <h4>高频易错点</h4>
        <ul>${pitfalls}</ul>
      </article>
    </section>`;
    iconRefresh();
  }

  function renderKnowledgeCardDeck(map, target = $("#knowledge-map")) {
    const deck = map.cardDeck || {};
    const cards = deck.cards || [];
    if (!cards.length) {
      renderGraphMindMap(map, target);
      return;
    }

    const lanes = deck.lanes?.length
      ? deck.lanes
      : [
          {
            id: "all",
            title: "知识卡片",
            description: "按概念、公式、题型和易错点聚合。",
            cards,
          },
        ];
    const stats = deck.stats || {};
    const statChips = [
      ["layers", `${cards.length}`, "卡片"],
      ["network", `${Number(stats.concepts || 0)}`, "概念"],
      ["sigma", `${Number(stats.formulas || 0)}`, "公式"],
      ["file-question", `${Number(stats.problems || 0)}`, "题型"],
      ["alert-triangle", `${Number(stats.mistakes || 0)}`, "易错"],
    ]
      .map(
        ([icon, value, label]) => `<span>
          <i data-lucide="${escapeAttribute(icon)}"></i>
          <strong>${escapeHtml(value)}</strong>
          <em>${escapeHtml(label)}</em>
        </span>`,
      )
      .join("");
    const lanesHtml = lanes
      .map((lane) => {
        const laneCards = (lane.cards || []).map(renderKnowledgeCard).join("");
        return `<section class="knowledge-lane lane-${escapeAttribute(lane.id || "all")}">
          <div class="lane-head">
            <div>
              <span class="lane-kicker">${escapeHtml(lane.title || "知识卡片")}</span>
              <h4>${escapeHtml(lane.description || "")}</h4>
            </div>
            <strong>${Number((lane.cards || []).length)} 张</strong>
          </div>
          <div class="knowledge-card-grid">${laneCards}</div>
        </section>`;
      })
      .join("");
    const connections = renderKnowledgeConnections(deck.key_connections || [], map);
    const visualPlan = renderKnowledgeVisualPlan(deck.visual_plan || {}, deck, map);

    target.className = "knowledge-map knowledge-card-board";
    target.innerHTML = `${visualPlan || `<section class="knowledge-hero">
      <div class="knowledge-hero-copy">
        <span class="map-label">知识地图</span>
        <h3>${escapeHtml(deck.title || map.course?.name || "当前科目")}</h3>
        <p>期末复习卡片</p>
      </div>
      <div class="map-stats-panel">
        <div class="card-stat-grid">${statChips}</div>
      </div>
    </section>`}
    ${lanesHtml}
    ${connections}
    <details class="export-panel">
      <summary>结构图谱 / Mermaid</summary>
      <div class="compact-graph-list">${renderCompactGraphConnections(map)}</div>
      <pre>${escapeHtml(map.mermaid || "")}</pre>
    </details>`;
    renderMathIn(target);
    iconRefresh();
  }

  function renderKnowledgeVisualPlan(plan, deck, map) {
    const stats = deck.stats || {};
    const statChips = [
      ["layers", `${Number(stats.cards || deck.cards?.length || 0)}`, "卡片"],
      ["network", `${Number(stats.concepts || 0)}`, "概念"],
      ["sigma", `${Number(stats.formulas || 0)}`, "公式"],
      ["file-question", `${Number(stats.problems || 0)}`, "题型"],
      ["alert-triangle", `${Number(stats.mistakes || 0)}`, "易错"],
    ]
      .map(
        ([icon, value, label]) => `<span>
          <i data-lucide="${escapeAttribute(icon)}"></i>
          <strong>${escapeHtml(value)}</strong>
          <em>${escapeHtml(label)}</em>
        </span>`,
      )
      .join("");
    const leadCards = (plan.lead_cards || [])
      .slice(0, 4)
      .map((card) => {
        const badges = (card.badges || []).slice(0, 3).map((badge) => `<span>${escapeHtml(badge)}</span>`).join("");
        const formula = card.formula ? `<div class="visual-card-formula">${renderFormula(card.formula)}</div>` : "";
        return `<article class="visual-lead-card tone-${escapeAttribute(card.tone || card.kind || "concept")}">
          <div class="visual-card-icon"><i data-lucide="${escapeAttribute(card.icon || "network")}"></i></div>
          <div class="visual-card-copy">
            <small>${escapeHtml(card.kind_label || "知识卡")}</small>
            <h4>${renderTextWithInlineMath(card.title || "知识卡片")}</h4>
            ${formula || `<p>${renderTextWithInlineMath(card.summary || "")}</p>`}
            ${badges ? `<div class="visual-card-badges">${badges}</div>` : ""}
          </div>
        </article>`;
      })
      .join("");
    const pathItems = (plan.study_path || [])
      .slice(0, 4)
      .map(
        (item, index) => `<li class="tone-${escapeAttribute(item.tone || item.id || "concept")}">
          <span>${index + 1}</span>
          <div>
            <small>${escapeHtml(item.label || "")}</small>
            <strong>${renderTextWithInlineMath(item.title || "")}</strong>
            <p>${renderTextWithInlineMath(item.description || "")}</p>
          </div>
        </li>`,
      )
      .join("");
    const concepts = (plan.concept_cloud || [])
      .slice(0, 8)
      .map((item) => `<span>${renderTextWithInlineMath(item)}</span>`)
      .join("");
    const formulas = (plan.formula_highlights || [])
      .slice(0, 3)
      .map((item) => `<li>${renderFormula(item)}</li>`)
      .join("");

    return `<section class="knowledge-visual">
      <div class="knowledge-visual-main">
        <div class="knowledge-hero-copy">
          <span class="map-label">知识图片</span>
          <h3>${escapeHtml(plan.title || deck.title || map.course?.name || "当前科目")}</h3>
          <p>${escapeHtml(plan.subtitle || "按考点、公式、题型和易错点生成复习视觉卡片。")}</p>
        </div>
        <div class="visual-lead-grid">${leadCards}</div>
      </div>
      <aside class="knowledge-visual-side">
        <div class="card-stat-grid">${statChips}</div>
        ${pathItems ? `<ol class="visual-study-path">${pathItems}</ol>` : ""}
        ${concepts || formulas ? `<div class="visual-quick-panel">
          ${concepts ? `<section><strong>概念云</strong><div class="visual-concepts">${concepts}</div></section>` : ""}
          ${formulas ? `<section><strong>公式亮点</strong><ul>${formulas}</ul></section>` : ""}
        </div>` : ""}
      </aside>
    </section>`;
  }

  function renderKnowledgeCard(card) {
    const badges = (card.badges || [])
      .slice(0, 5)
      .map((badge) => `<span class="chip ${badge.includes("错") || badge.includes("风险") ? "warn" : badge.includes("高频") || badge.includes("重点") ? "good" : ""}">${escapeHtml(badge)}</span>`)
      .join("");
    const concepts = (card.concepts || [])
      .slice(0, 8)
      .map((item) => `<span>${renderTextWithInlineMath(item)}</span>`)
      .join("");
    const formulas = (card.formulas || [])
      .slice(0, 4)
      .map((item) => `<li>${renderFormula(item)}</li>`)
      .join("");
    const checks = (card.checks || [])
      .slice(0, 5)
      .map((item) => `<li>${renderTextWithInlineMath(item)}</li>`)
      .join("");
    const practice = (card.practice || [])
      .slice(0, 4)
      .map((item) => `<li>${renderTextWithInlineMath(item)}</li>`)
      .join("");
    const mistakes = (card.mistakes || [])
      .slice(0, 4)
      .map((item) => `<li>${renderTextWithInlineMath(item)}</li>`)
      .join("");
    const refs = renderSourceRefs(card.source_refs || [], 2);
    const primaryFormula = card.primary_formula ? `<div class="formula-display">${renderFormula(card.primary_formula)}</div>` : "";
    const bodySections = [
      concepts ? `<section class="detail-block concept-block"><strong>关联概念</strong><div class="concept-strip">${concepts}</div></section>` : "",
      formulas ? `<section class="detail-block formula-block"><strong>公式</strong><ul class="formula-list">${formulas}</ul></section>` : "",
      checks ? `<section class="detail-block action-block"><strong>检查点</strong><ul>${checks}</ul></section>` : "",
      practice ? `<section class="detail-block practice-block"><strong>典型题入口</strong><ul>${practice}</ul></section>` : "",
      mistakes ? `<section class="detail-block mistake-block"><strong>易错提醒</strong><ul>${mistakes}</ul></section>` : "",
    ].filter(Boolean);

    return `<article class="knowledge-card tone-${escapeAttribute(card.tone || card.kind || "concept")}" data-card-id="${escapeAttribute(card.card_id || "")}">
      <div class="knowledge-card-accent"></div>
      <div class="knowledge-card-head">
        <span class="node-icon"><i data-lucide="${escapeAttribute(card.icon || "network")}"></i></span>
        <div>
          <div class="knowledge-card-meta">
            <span class="chip">${escapeHtml(card.kind_label || "知识卡")}</span>
            ${badges}
          </div>
          <h4>${renderTextWithInlineMath(card.title || "知识卡片")}</h4>
          ${card.subtitle ? `<p>${renderTextWithInlineMath(card.subtitle)}</p>` : ""}
        </div>
      </div>
      ${primaryFormula}
      ${card.summary ? `<div class="knowledge-card-summary"><span>核心</span><p>${renderTextWithInlineMath(card.summary)}</p></div>` : ""}
      ${bodySections.length ? `<div class="knowledge-card-body">${bodySections.join("")}</div>` : ""}
      ${
        refs
          ? `<details class="knowledge-card-source">
            <summary><i data-lucide="map-pin"></i><span>资料定位</span></summary>
            <div class="node-evidence">${refs}</div>
          </details>`
          : ""
      }
    </article>`;
  }

  function renderKnowledgeConnections(connections, map) {
    const items = (connections || [])
      .slice(0, 6)
      .map((item) => `<li>
        <span>${renderTextWithInlineMath(item.from || "")}</span>
        <strong>${escapeHtml(relationLabel(item.relation))}</strong>
        <span>${renderTextWithInlineMath(item.to || "")}</span>
      </li>`)
      .join("");
    if (!items && !(map.edges || []).length) return "";
    return `<section class="knowledge-connections">
      <div class="section-heading"><h3>关键连接</h3></div>
      <ul>${items || renderCompactGraphConnections(map)}</ul>
    </section>`;
  }

  function renderCompactGraphConnections(map) {
    const nodes = map.nodes || [];
    return (map.edges || [])
      .slice(0, 8)
      .map((edge) => {
        const from = nodes.find((node) => node.id === edge.from_id);
        const to = nodes.find((node) => node.id === edge.to_id);
        return `<li><span>${renderTextWithInlineMath(cleanDisplayTitle(from?.label || edge.from_id))}</span> <strong>${escapeHtml(relationLabel(edge.relation))}</strong> <span>${renderTextWithInlineMath(cleanDisplayTitle(to?.label || edge.to_id))}</span></li>`;
      })
      .join("");
  }

  function renderGraphMindMap(map, target = $("#knowledge-map")) {
    const nodes = map.nodes || [];
    const edges = map.edges || [];
    if (!nodes.length) {
      target.className = "knowledge-map empty-state";
      target.textContent = "还没有足够内容生成知识图谱。";
      return;
    }
    const typeLabels = {
      chapter: "章节",
      concept: "概念",
      formula: "公式",
      theorem_or_rule: "规则",
      example: "例题",
      homework_problem: "作业",
      mistake_point: "易错",
      exam_focus: "重点",
    };
    const edgeList = edges
      .slice(0, 18)
      .map((edge) => {
        const from = nodes.find((node) => node.id === edge.from_id);
        const to = nodes.find((node) => node.id === edge.to_id);
        return `<li><span>${renderTextWithInlineMath(cleanDisplayTitle(from?.label || edge.from_id))}</span> <strong>${escapeHtml(relationLabel(edge.relation))}</strong> <span>${renderTextWithInlineMath(cleanDisplayTitle(to?.label || edge.to_id))}</span></li>`;
      })
      .join("");
    const displayNodes = compactGraphNodes(nodes);
    const nodeCards = displayNodes
      .slice(0, 48)
      .map((node) => {
        const refs = renderSourceRefs(node.source_refs || [], 2);
        const badges = (node.badges || [])
          .map((badge) => `<span class="chip ${badge.includes("错") ? "warn" : "good"}">${escapeHtml(badge)}</span>`)
          .join("");
        const formula = node.formula || (node.type === "formula" ? node.summary : "");
        const summary = node.type === "formula" ? formulaSummary(node) : cleanEvidenceText(node.summary || "");
        return `<article class="graph-node type-${escapeHtml(node.type)}" data-node-id="${escapeAttribute(node.id)}">
          <div class="graph-node-head">
            <div class="question-meta">
              <span class="chip">${escapeHtml(typeLabels[node.type] || node.type)}</span>
              <span class="chip">${escapeHtml(difficultyLabel(node.difficulty || "medium"))}</span>
              <span class="chip ${node.exam_focus?.level === "high" ? "good" : ""}">${escapeHtml(focusLabel(node.exam_focus?.level || "low"))}</span>
              ${badges}
            </div>
            <h4>${renderTextWithInlineMath(cleanDisplayTitle(node.label))}</h4>
          </div>
          ${formula ? `<div class="formula-display">${renderFormula(formula)}</div>` : ""}
          ${summary ? `<p>${renderTextWithInlineMath(summary)}</p>` : ""}
          ${refs ? `<div class="node-evidence">${refs}</div>` : ""}
        </article>`;
      })
      .join("");
    target.className = "knowledge-map";
    target.innerHTML = `<section class="map-header">
      <div class="map-center">
        <span class="map-label">知识图谱</span>
        <h3>${escapeHtml(map.course?.name || "当前科目")}</h3>
        <div class="keyword-strip">
          <span>${nodes.length} 节点</span>
          <span>${edges.length} 关系</span>
          <span>${displayNodes.length} 卡片</span>
        </div>
      </div>
      <div class="map-side">
        <h4>关键连接</h4>
        <ul>${edgeList || "<li>暂无足够关系。</li>"}</ul>
      </div>
    </section>
    <section class="graph-grid">${nodeCards}</section>
    <details class="export-panel">
      <summary>导出 Mermaid</summary>
      <pre>${escapeHtml(map.mermaid || "")}</pre>
    </details>`;
    iconRefresh();
  }

  function cleanDisplayTitle(value) {
    return compactText(value)
      .replace(/^考试重点[：:]\s*/, "")
      .replace(/\s*[-－–—]\s*/g, "-")
      .replace(/\s*[、,.，．]\s*/g, "、")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanEvidenceText(value) {
    const text = compactText(value)
      .replace(/^unknown$/i, "")
      .replace(/TaoFM-\s*/gi, "")
      .replace(/\b\d{4}\/\d{1,2}\/\d{1,2}\b/g, "")
      .replace(/材料力学/g, "")
      .replace(/\s+\d{1,3}\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "";
    if (text.length <= 150) return text;
    const parts = text.split(/(?<=[。；;!?！？])\s+/).filter(Boolean);
    const useful = parts.find((part) => /特点|外力|轴线|变形|公式|条件|轴力|应力|伸长|缩短|截面/.test(part)) || parts[0] || text;
    return useful.length > 120 ? `${useful.slice(0, 119)}…` : useful;
  }

  function renderTextWithInlineMath(value) {
    const text = cleanEvidenceText(value) || compactText(value);
    return renderInlineText(text);
  }

  function formulaSummary(node) {
    const text = cleanEvidenceText(node.summary || "");
    if (!text || text === cleanEvidenceText(node.formula || "")) return "";
    return text;
  }

  function difficultyLabel(value) {
    return {
      basic: "基础",
      medium: "中等",
      hard: "较难",
      comprehensive: "综合",
    }[value] || value || "中等";
  }

  function focusLabel(value) {
    return {
      high: "高频",
      medium: "重点",
      low: "一般",
    }[value] || value || "一般";
  }

  function relationLabel(value) {
    return {
      belongs_to: "属于",
      depends_on: "依赖",
      tested_by: "考察",
      uses_formula: "使用",
      causes_mistake: "易错",
      contrasts_with: "对比",
      similar_to: "相关",
    }[value] || value || "关联";
  }

  function compactGraphNodes(nodes = []) {
    const priority = {
      chapter: 0,
      exam_focus: 1,
      formula: 2,
      theorem_or_rule: 3,
      concept: 4,
      mistake_point: 5,
      example: 6,
      homework_problem: 7,
    };
    const seen = new Set();
    return [...nodes]
      .sort((a, b) => (priority[a.type] ?? 9) - (priority[b.type] ?? 9))
      .filter((node) => {
        const key = ["concept", "exam_focus"].includes(node.type)
          ? `${node.type}:${cleanDisplayTitle(node.label)}`
          : `${node.type}:${node.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function renderQuiz(questions) {
    const list = $("#quiz-list");
    renderQuizQuality(state.currentQuizEvaluation);
    if (!questions.length) {
      list.innerHTML = '<article class="item-card"><p class="muted">还没有生成题目。</p></article>';
      return;
    }
    list.innerHTML = questions
      .map((q, index) => {
        const options = (q.options || [])
          .map(
            (option, optionIndex) => `<li>
              <span>${String.fromCharCode(65 + optionIndex)}</span>
              <p>${renderInlineText(option)}</p>
            </li>`,
          )
          .join("");
        const refs = renderSourceRefs(q.source_refs || [], 2);
        const steps = (q.step_by_step_solution || [])
          .map((step) => `<li>${escapeHtml(step)}</li>`)
          .join("");
        const mistakes = (q.common_mistakes || [])
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("");
        const rubric = (q.grading_rubric || [])
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("");
        const tags = (q.tags || [])
          .slice(0, 6)
          .map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`)
          .join("");
        return `<article class="item-card question-card" data-question-index="${index}">
          <div class="question-card-head">
            <div class="question-meta">
              <span class="chip">第 ${index + 1} 题</span>
              <span class="chip">${escapeHtml(typeLabel(q.question_type || q.type))}</span>
              <span class="chip">${escapeHtml(q.difficulty || "中等")}</span>
              <span class="chip">${Number(q.estimated_time || 5)} 分钟</span>
            </div>
            ${tags ? `<div class="doc-meta">${tags}</div>` : ""}
          </div>
          <div class="question-stem">${renderInlineText(q.question_text || q.stem || "")}</div>
          ${options ? `<ol class="question-options">${options}</ol>` : ""}
          <textarea class="user-answer" placeholder="写下你的答案或思路"></textarea>
          <div class="question-actions">
            <button class="secondary-button show-answer" type="button"><i data-lucide="book-open-check"></i>查看答案</button>
            <button class="secondary-button save-mistake" type="button"><i data-lucide="bookmark-plus"></i>加入错题</button>
            <button class="secondary-button mark-question" type="button" data-status="known"><i data-lucide="check"></i>会</button>
            <button class="secondary-button mark-question" type="button" data-status="unknown"><i data-lucide="circle-help"></i>不会</button>
            <button class="secondary-button mark-question" type="button" data-status="mistake"><i data-lucide="alert-triangle"></i>易错</button>
            <button class="danger-button delete-question" type="button"><i data-lucide="trash-2"></i>删除</button>
          </div>
          <div class="answer-panel">
            <section class="answer-section">
              <strong>参考答案</strong>
              ${renderRichParagraphs(q.answer || "暂无参考答案。")}
            </section>
            ${
              steps
                ? `<section class="answer-section"><strong>解题步骤</strong><ol>${steps}</ol></section>`
                : q.explanation
                  ? `<section class="answer-section"><strong>解析</strong>${renderRichParagraphs(q.explanation)}</section>`
                  : ""
            }
            ${mistakes ? `<section class="answer-section"><strong>常见错误</strong><ul>${mistakes}</ul></section>` : ""}
            ${rubric ? `<section class="answer-section"><strong>评分规则</strong><ul>${rubric}</ul></section>` : ""}
            ${refs ? `<section class="answer-section answer-source"><strong>资料来源</strong><div class="node-evidence">${refs}</div></section>` : ""}
          </div>
        </article>`;
      })
      .join("");
    renderMathIn(list);
    iconRefresh();
  }

  function renderPlainParagraphs(value) {
    const parts = String(value || "")
      .split(/\n{2,}|\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean);
    const paragraphs = parts.length ? parts : [""];
    return paragraphs.map((part) => `<p>${escapeHtml(part)}</p>`).join("");
  }

  function renderRichParagraphs(value) {
    const parts = String(value || "")
      .split(/\n{2,}|\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean);
    const paragraphs = parts.length ? parts : [""];
    return paragraphs.map((part) => `<p>${renderInlineText(part)}</p>`).join("");
  }

  function renderInlineText(value) {
    return splitMathSegments(String(value || ""))
      .map((part) => {
        if (part.math) return renderFormula(part.value, { display: part.display });
        return renderPlainInlineMath(part.value);
      })
      .join("");
  }

  function renderPlainInlineMath(value) {
    const segments = [];
    let rest = String(value || "");
    const formulaPattern =
      /(\\(?:dfrac|tfrac|frac)\{[^{}]+\}\{[^{}]+\}|\\sqrt(?:\[[^\]]+\])?\{[^{}]+\}|(?:\\[A-Za-z]+|[σσετγθφωΩμνΔδψA-Za-z])(?:[\s_{}^A-Za-z0-9\\+\-*/=<>≈≤≥().,，;；·×±]){0,90}(?:=|≤|≥|≈|≠|<|>|\/|\\le|\\ge|\\ne|\\approx)(?:[\s_{}^A-Za-z0-9\\+\-*/=<>≈≤≥().,，;；·×±σσετγθφωΩμνΔδψ]){1,120})/u;
    while (rest) {
      const match = rest.match(formulaPattern);
      if (!match || match.index === undefined) {
        segments.push(escapeHtml(rest));
        break;
      }
      const before = rest.slice(0, match.index);
      const matched = match[0];
      const raw = matched.replace(/[，,;；。]+$/u, "");
      const trailing = matched.slice(raw.length);
      if (before) segments.push(escapeHtml(before));
      if (isLikelyFormulaText(raw)) segments.push(renderFormula(raw));
      else segments.push(escapeHtml(raw));
      if (trailing) segments.push(escapeHtml(trailing));
      rest = rest.slice(match.index + matched.length);
    }
    return segments.join("");
  }

  function isLikelyFormulaText(value) {
    const text = String(value || "").trim();
    if (!text) return false;
    if (/\\(?:frac|dfrac|tfrac|sqrt|sigma|varepsilon|tau|Delta|theta|varphi|omega|pi|le|ge|ne|approx)/.test(text)) return true;
    if (/[=<>≤≥≈≠/]/.test(text) && /[A-Za-zσσετγθφωΩμνΔδψ]/u.test(text)) return true;
    return false;
  }

  function typeLabel(type) {
    return {
      choice: "选择",
      blank: "填空",
      short: "简答",
      calculation: "计算",
      concept_understanding: "概念理解",
      formula_application: "公式应用",
      derivation_proof: "推导/证明",
      mistake_diagnosis: "易错诊断",
      exam_practice: "考试题",
      textbook_exercise: "教材习题",
      variant: "变式",
      comprehensive: "综合",
      subjective_recall: "主观复述",
    }[type] || type || "题目";
  }

  function questionSourceDocumentIds(question) {
    return [
      ...new Set([
        ...(question?.sourceDocumentIds || []),
        ...((question?.source_refs || []).map((ref) => ref.document_id).filter(Boolean)),
      ]),
    ];
  }

  function renderQuizQuality(evaluation) {
    const target = $("#quiz-quality");
    if (!target) return;
    if (!evaluation) {
      target.className = "quality-panel empty-state";
      target.textContent = "生成题目后显示质量评估。";
      return;
    }
    const checks = evaluation.checks || {};
    const typeCounts = Object.entries(evaluation.summary?.type_counts || {})
      .map(([type, count]) => `<span class="chip">${escapeHtml(typeLabel(type))} ${count}</span>`)
      .join("");
    const issues = [...(evaluation.issues || []), ...(evaluation.warnings || [])]
      .slice(0, 5)
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    target.className = `quality-panel level-${escapeHtml(evaluation.level || "partial")}`;
    target.innerHTML = `<div>
      <span class="map-label">题集质量</span>
      <h4>${Number(evaluation.score || 0)} / 100 · ${escapeHtml(evaluation.level || "partial")}</h4>
      <div class="doc-meta">${typeCounts}</div>
    </div>
    <div class="quality-checks">
      <span class="${checks.source_refs ? "ok" : "bad"}">来源</span>
      <span class="${checks.type_diversity ? "ok" : "bad"}">题型</span>
      <span class="${checks.difficulty_distribution ? "ok" : "bad"}">难度</span>
      <span class="${checks.answer_and_steps ? "ok" : "bad"}">答案步骤</span>
      <span class="${checks.duplicate_questions ? "ok" : "bad"}">重复检测</span>
      <span class="${checks.comprehensive_question ? "ok" : "bad"}">综合题</span>
    </div>
    ${issues ? `<ul>${issues}</ul>` : ""}`;
  }

  async function generateReviewPlan() {
    if (!state.currentCourseId) return toast("请先选择科目");
    $("#planner-status").textContent = "正在生成复习计划...";
    const nextTarget = $("#planner-next");
    nextTarget.className = "planner-next loading-state";
    nextTarget.textContent = "正在结合资料、错题和复盘记录排序...";
    try {
      const data = await api("/api/generate/plan", {
        method: "POST",
        body: JSON.stringify({
          courseId: state.currentCourseId,
          documentIds: selectedDocumentIds(),
          limit: 6,
          examDate: $("#plan-exam-date")?.value || "",
          dailyMinutes: $("#plan-daily-minutes")?.value || 90,
          goal: $("#plan-goal")?.value || "高分",
          crammingMode: Boolean($("#plan-cramming")?.checked),
        }),
      });
      state.currentCourseModel = data.courseModel || state.currentCourseModel;
      state.currentPlan = data.plan;
      renderPlanner();
      $("#planner-status").textContent = "已按资料线索、错题和完成记录生成";
    } catch (error) {
      $("#planner-status").textContent = "";
      nextTarget.className = "planner-next empty-state";
      nextTarget.textContent = "生成失败，请检查资料是否已导入。";
      toast(error.message);
    }
  }

  async function generateCramPackView() {
    if (!state.currentCourseId) return toast("请先选择科目");
    const target = $("#cram-output");
    $("#cram-status").textContent = "正在统计资料、错题和复盘记录...";
    target.className = "cram-output loading-state";
    target.textContent = "正在按科目汇总资料信号，并计算考前优先级...";
    try {
      const data = await api("/api/generate/cram-pack", {
        method: "POST",
        body: JSON.stringify({
          courseId: state.currentCourseId,
          documentIds: selectedDocumentIds(),
          totalMinutes: $("#cram-total-minutes")?.value || 90,
          questionCount: $("#cram-question-count")?.value || 10,
        }),
      });
      state.currentCourseModel = data.courseModel || state.currentCourseModel;
      state.currentCramPack = data.cramPack;
      renderCramPack();
      $("#cram-status").textContent = "已生成本地统计冲刺包";
    } catch (error) {
      $("#cram-status").textContent = "";
      target.className = "cram-output empty-state";
      target.textContent = "生成失败，请检查资料是否已导入并包含可抽取文本。";
      toast(error.message);
    }
  }

  async function completePlanSession(index, button) {
    const plan = state.currentPlan?.courseId === state.currentCourseId ? state.currentPlan : null;
    const item = plan?.items?.[index];
    if (!item) return;
    button.disabled = true;
    button.innerHTML = '<i data-lucide="loader-circle"></i>记录中...';
    iconRefresh();
    try {
      const data = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          courseId: state.currentCourseId,
          topicId: item.id,
          topicTitle: item.title,
          chapterTitle: item.chapterTitle,
          durationMinutes: item.durationMinutes,
          sourceDocumentIds: item.sourceDocumentIds || [],
          sourceMistakeIds: item.sourceMistakeIds || [],
        }),
      });
      markPlanItemCompleted(item, data.session);
      state.currentCramPack = null;
      renderPlanner();
      renderCramPack();
      toast("已记录本次复盘");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="check-circle-2"></i>标记完成';
      iconRefresh();
    }
  }

  function markPlanItemCompleted(item, session) {
    item.completedCount = Number(item.completedCount || 0) + 1;
    item.lastCompletedAt = session.completedAt || session.createdAt;
    item.completedRecently = true;
    item.priorityScore = Math.max(1, Number(item.priorityScore || 1) - 14);
    item.reason = ["刚完成一次复盘"];
    if (state.currentPlan?.summary) {
      state.currentPlan.summary.completedSessionCount = Number(state.currentPlan.summary.completedSessionCount || 0) + 1;
    }
    const next = (state.currentPlan?.items || []).find((entry) => !entry.completedRecently);
    state.currentPlan.nextReview = next || item;
  }

  async function completeCramSession(index, button) {
    const pack = state.currentCramPack?.courseId === state.currentCourseId ? state.currentCramPack : null;
    const item = pack?.focusTopics?.[index];
    if (!item) return;
    button.disabled = true;
    button.innerHTML = '<i data-lucide="loader-circle"></i>记录中...';
    iconRefresh();
    try {
      const data = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          courseId: state.currentCourseId,
          topicId: item.id,
          topicTitle: item.title,
          chapterTitle: item.title,
          durationMinutes: item.durationMinutes,
          sourceDocumentIds: item.sourceDocumentIds || [],
          sourceMistakeIds: item.sourceMistakeIds || [],
          notes: "来自考前冲刺包",
        }),
      });
      item.completedCount = Number(item.completedCount || 0) + 1;
      item.lastCompletedAt = data.session?.completedAt || data.session?.createdAt;
      if (pack.scope) pack.scope.sessionCount = Number(pack.scope.sessionCount || 0) + 1;
      state.currentPlan = null;
      renderCramPack();
      renderPlanner();
      toast("已记录冲刺复盘");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="check-circle-2"></i>标记完成';
      iconRefresh();
    }
  }

  function bindEvents() {
    $("#course-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = $("#course-name");
      const name = input.value.trim();
      if (!name) return toast("请输入科目名称");
      const data = await api("/api/courses", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      state.currentCourseId = data.course.id;
      state.selectedDocumentIds.clear();
      state.editingCourseId = null;
      state.editingDocumentId = null;
      state.previewDocumentId = null;
      state.previewUnitIndex = 0;
      state.currentPlan = null;
      state.currentCramPack = null;
      input.value = "";
      render();
      toast("科目已创建");
    });

    $("#course-list").addEventListener("click", (event) => {
      const item = event.target.closest("[data-course-id]");
      if (!item) return;
      const courseId = item.dataset.courseId;

      if (event.target.closest(".edit-course")) {
        state.editingCourseId = state.editingCourseId === courseId ? null : courseId;
        renderCourses();
        iconRefresh();
        return;
      }

      if (event.target.closest(".cancel-edit-course")) {
        state.editingCourseId = null;
        renderCourses();
        iconRefresh();
        return;
      }

      if (event.target.closest(".delete-course")) {
        const course = (state.data?.courses || []).find((item) => item.id === courseId);
        if (!course) return;
        const docCount = courseDocuments(courseId).length;
        const mistakeCount = courseMistakes(courseId).length;
        const details = [docCount ? `${docCount} 份资料` : "", mistakeCount ? `${mistakeCount} 条错题` : ""]
          .filter(Boolean)
          .join("、");
        const message = `删除科目“${course.name}”？${details ? `将同时删除${details}和本地上传文件。` : "该科目当前没有资料或错题。"}`;
        if (!window.confirm(message)) return;
        api(`/api/courses/${encodeURIComponent(courseId)}`, { method: "DELETE" })
          .then(() => {
            if (state.currentCourseId === courseId) {
              state.currentCourseId = (state.data?.courses || [])[0]?.id || null;
              state.selectedDocumentIds = new Set(courseDocuments().map((doc) => doc.id));
              state.previewDocumentId = null;
              state.previewUnitIndex = 0;
              state.currentPlan = null;
              state.currentCramPack = null;
            }
            if (state.editingCourseId === courseId) state.editingCourseId = null;
            toast("科目已删除");
          })
          .catch((error) => toast(error.message));
        return;
      }

      if (!event.target.closest(".course-button")) return;
      state.currentCourseId = courseId;
      state.selectedDocumentIds = new Set(courseDocuments().map((doc) => doc.id));
      state.editingCourseId = null;
      state.editingDocumentId = null;
      state.previewDocumentId = null;
      state.previewUnitIndex = 0;
      state.currentPlan = null;
      state.currentCramPack = null;
      render();
    });

    $("#course-list").addEventListener("submit", async (event) => {
      const form = event.target.closest(".course-edit-form");
      if (!form) return;
      event.preventDefault();
      const courseId = form.dataset.courseId;
      const name = $(".course-name-input", form).value.trim();
      if (!name) return toast("科目名称不能为空");
      try {
        state.editingCourseId = null;
        await api(`/api/courses/${encodeURIComponent(courseId)}`, {
          method: "PATCH",
          body: JSON.stringify({ name }),
        });
        toast("科目名称已修改");
      } catch (error) {
        state.editingCourseId = courseId;
        toast(error.message);
      }
    });

    $$(".tab-button").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeTab = button.dataset.tab;
        $$(".tab-button").forEach((item) => item.classList.toggle("active", item === button));
        $$(".view").forEach((view) => view.classList.remove("active-view"));
        $(`#view-${state.activeTab}`).classList.add("active-view");
        iconRefresh();
      });
    });

    document.addEventListener("click", (event) => {
      const button = event.target.closest(".source-ref-button");
      if (!button) return;
      jumpToSourceRef({
        document_id: button.dataset.docId,
        unit_index: Number(button.dataset.unitIndex || 0),
        locator_label: button.querySelector("small")?.textContent || "",
        excerpt: button.dataset.sourceExcerpt || "",
      });
      iconRefresh();
    });

    $("#file-input").addEventListener("change", () => {
      const files = $("#file-input").files;
      $("#upload-note").textContent = files.length ? `${files.length} 个文件已选择，点击导入资料。` : "资料按科目保存在本机项目目录，不会自动上传到外部服务。";
    });

    $("#upload-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.currentCourseId) return toast("请先新建或选择科目");
      const input = $("#file-input");
      if (!input.files.length) return toast("请选择要导入的文件");
      const form = new FormData();
      form.append("courseId", state.currentCourseId);
      for (const file of input.files) form.append("files", file);
      $("#upload-note").textContent = "正在解析资料，PDF 可能需要一点时间。";
      const data = await api("/api/upload", { method: "POST", body: form });
      for (const doc of data.imported || []) state.selectedDocumentIds.add(doc.id);
      if (data.imported?.[0]) {
        state.previewDocumentId = data.imported[0].id;
        state.previewUnitIndex = 0;
      }
      state.currentPlan = null;
      state.currentCramPack = null;
      input.value = "";
      $("#upload-note").textContent = "导入完成。";
      render();
      toast(`已导入 ${data.imported?.length || 0} 个文件`);
    });

    $("#text-import-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.currentCourseId) return toast("请先新建或选择科目");
      const nameInput = $("#text-import-name");
      const textInput = $("#text-import-content");
      const originalName = nameInput.value.trim() || "纯文字例题.txt";
      const text = textInput.value.trim();
      if (!text) return toast("请输入要导入的纯文字例题");
      $("#upload-note").textContent = "正在导入纯文字例题。";
      const data = await api("/api/text-examples", {
        method: "POST",
        body: JSON.stringify({
          courseId: state.currentCourseId,
          originalName,
          text,
        }),
      });
      const doc = data.document || data.imported?.[0];
      if (doc) {
        state.selectedDocumentIds.add(doc.id);
        state.previewDocumentId = doc.id;
        state.previewUnitIndex = 0;
      }
      nameInput.value = "";
      textInput.value = "";
      $("#upload-note").textContent = "纯文字例题已导入。";
      state.currentCramPack = null;
      render();
      toast("纯文字例题已导入");
    });

    $("#document-list").addEventListener("change", (event) => {
      const checkbox = event.target.closest(".doc-check");
      if (!checkbox) return;
      const card = event.target.closest("[data-doc-id]");
      if (checkbox.checked) state.selectedDocumentIds.add(card.dataset.docId);
      else state.selectedDocumentIds.delete(card.dataset.docId);
      state.currentPlan = null;
      state.currentCramPack = null;
      renderDocuments();
      renderPlanner();
      renderCramPack();
      iconRefresh();
    });

    $("#document-list").addEventListener("click", (event) => {
      const id = event.target.closest("[data-doc-id]")?.dataset.docId;
      if (!id) return;
      if (event.target.closest(".preview-doc")) {
        const doc = courseDocuments().find((item) => item.id === id);
        showPreview(doc);
      }
      if (event.target.closest(".edit-doc")) {
        state.editingDocumentId = state.editingDocumentId === id ? null : id;
        renderDocuments();
        iconRefresh();
      }
      if (event.target.closest(".cancel-edit-doc")) {
        state.editingDocumentId = null;
        renderDocuments();
        iconRefresh();
      }
      if (event.target.closest(".delete-doc")) {
        const doc = courseDocuments().find((item) => item.id === id);
        if (!doc || !window.confirm(`删除资料“${doc.originalName}”？此操作会同时删除本地上传文件。`)) return;
        const wasSelected = state.selectedDocumentIds.has(id);
        const wasEditing = state.editingDocumentId === id;
        const wasPreviewing = state.previewDocumentId === id;
        const previousPreviewIndex = state.previewUnitIndex;
        state.selectedDocumentIds.delete(id);
        if (state.editingDocumentId === id) state.editingDocumentId = null;
        if (state.previewDocumentId === id) {
          state.previewDocumentId = null;
          state.previewUnitIndex = 0;
        }
        api(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" })
          .then(() => {
            state.currentPlan = null;
            state.currentCramPack = null;
            renderPlanner();
            renderCramPack();
            toast("资料已删除");
          })
          .catch((error) => {
            if (wasSelected) state.selectedDocumentIds.add(id);
            if (wasEditing) state.editingDocumentId = id;
            if (wasPreviewing) {
              state.previewDocumentId = id;
              state.previewUnitIndex = previousPreviewIndex;
            }
            toast(error.message);
          });
      }
    });

    $("#doc-outline").addEventListener("click", async (event) => {
      const deleteButton = event.target.closest(".delete-unit");
      if (deleteButton) {
        const docId = deleteButton.dataset.docId;
        const unitIndex = Number(deleteButton.dataset.unitIndex);
        const doc = courseDocuments().find((item) => item.id === docId);
        const unit = documentUnits(doc)[unitIndex];
        if (!doc || !unit) return;
        const label = unit.label || `片段 ${unitIndex + 1}`;
        if (!window.confirm(`删除“${label}”？这会从该资料的抽取文本中移除这个片段。`)) return;
        state.previewDocumentId = docId;
        state.previewUnitIndex = Math.max(0, unitIndex - 1);
        state.currentPlan = null;
        state.currentCramPack = null;
        try {
          await api(`/api/documents/${encodeURIComponent(docId)}/units/${unitIndex}`, { method: "DELETE" });
          renderPlanner();
          renderCramPack();
          toast("片段已删除");
        } catch (error) {
          toast(error.message);
        }
        return;
      }

      const button = event.target.closest("[data-doc-id][data-unit-index]");
      if (!button) return;
      const doc = courseDocuments().find((item) => item.id === button.dataset.docId);
      if (!doc) return;
      showPreview(doc, Number(button.dataset.unitIndex));
      iconRefresh();
    });

    $("#document-list").addEventListener("submit", async (event) => {
      const form = event.target.closest(".doc-edit-form");
      if (!form) return;
      event.preventDefault();
      const id = form.dataset.docId;
      const doc = courseDocuments().find((item) => item.id === id);
      if (!doc) return;
      const originalName = $(".doc-name-input", form).value.trim();
      const text = $(".doc-text-input", form).value;
      if (!originalName) return toast("资料名称不能为空");
      try {
        state.editingDocumentId = null;
        await api(`/api/documents/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ originalName, text }),
        });
        state.currentPlan = null;
        state.currentCramPack = null;
        renderPlanner();
        renderCramPack();
        toast("资料已修改");
      } catch (error) {
        state.editingDocumentId = id;
        toast(error.message);
      }
    });

    $("#select-all-docs").addEventListener("click", () => {
      const docs = courseDocuments();
      const allSelected = docs.every((doc) => state.selectedDocumentIds.has(doc.id));
      state.selectedDocumentIds = new Set(allSelected ? [] : docs.map((doc) => doc.id));
      state.currentPlan = null;
      state.currentCramPack = null;
      renderDocuments();
      renderPlanner();
      renderCramPack();
      iconRefresh();
    });

    $("#generate-summary").addEventListener("click", async () => {
      if (!state.currentCourseId) return toast("请先选择科目");
      $("#summary-status").textContent = "正在生成知识地图...";
      const mapTarget = $("#knowledge-map");
      mapTarget.className = "knowledge-map loading-state";
      mapTarget.textContent = "正在梳理概念、公式和题型关系...";
      const output = $("#summary-output");
      output.classList.remove("empty-state");
      output.textContent = "";
      try {
        const data = await api("/api/generate/summary", {
          method: "POST",
          body: JSON.stringify({
            courseId: state.currentCourseId,
            documentIds: selectedDocumentIds(),
          }),
        });
        state.currentCourseModel = data.courseModel || null;
        state.currentMindMap = data.mindMap || null;
        renderKnowledgeMap(data.mindMap || data.knowledgeMap);
        renderMarkdown(output, data.warning ? `> ${data.warning}\n\n${data.markdown}` : data.markdown);
        $("#summary-status").textContent = data.provider === "api" ? "由 API 生成" : "由本地规则生成";
      } catch (error) {
        $("#summary-status").textContent = "";
        mapTarget.className = "knowledge-map empty-state";
        mapTarget.textContent = "生成失败，请检查资料是否已导入。";
        toast(error.message);
      }
    });

    $("#generate-plan").addEventListener("click", generateReviewPlan);
    $("#generate-cram").addEventListener("click", generateCramPackView);

    $("#cram-output").addEventListener("click", (event) => {
      const answerButton = event.target.closest(".show-cram-answer");
      if (answerButton) {
        const card = answerButton.closest(".cram-question");
        $(".answer-panel", card)?.classList.toggle("visible");
        return;
      }

      if (event.target.closest(".use-cram-drill")) {
        const pack = state.currentCramPack?.courseId === state.currentCourseId ? state.currentCramPack : null;
        if (!pack?.drillQuestions?.length) return toast("冲刺包里暂时没有限时题");
        state.currentQuiz = pack.drillQuestions;
        state.currentQuizEvaluation = null;
        renderQuiz(state.currentQuiz);
        $$(".tab-button").find((item) => item.dataset.tab === "quiz")?.click();
        $("#quiz-status").textContent = "已从冲刺包导入限时题";
        return;
      }

      const completeButton = event.target.closest(".complete-cram-session");
      if (!completeButton) return;
      const card = completeButton.closest("[data-cram-topic-index]");
      completeCramSession(Number(card?.dataset.cramTopicIndex), completeButton);
    });

    $("#planner-grid").addEventListener("click", (event) => {
      const deleteButton = event.target.closest(".delete-plan-item");
      if (deleteButton) {
        const card = event.target.closest("[data-plan-index]");
        const index = Number(card?.dataset.planIndex);
        if (!state.currentPlan?.items?.[index]) return;
        state.currentPlan.items.splice(index, 1);
        state.currentPlan.nextReview = state.currentPlan.items[0] || null;
        renderPlanner();
        toast("计划项已删除");
        return;
      }

      const button = event.target.closest(".complete-session");
      if (!button) return;
      const card = event.target.closest("[data-plan-index]");
      completePlanSession(Number(card?.dataset.planIndex), button);
    });

    $("#session-list").addEventListener("click", async (event) => {
      const button = event.target.closest(".delete-session");
      if (!button) return;
      const card = event.target.closest("[data-session-id]");
      const sessionId = card?.dataset.sessionId;
      if (!sessionId) return;
      if (!window.confirm("删除这条复盘记录？")) return;
      try {
        await api(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
        state.currentPlan = null;
        state.currentCramPack = null;
        renderPlanner();
        renderCramPack();
        toast("复盘记录已删除");
      } catch (error) {
        toast(error.message);
      }
    });

    $("#generate-quiz").addEventListener("click", async () => {
      if (!state.currentCourseId) return toast("请先选择科目");
      $("#quiz-status").textContent = "正在生成题目...";
      const types = $$('input[name="quiz-type"]:checked').map((input) => input.value);
      try {
        const data = await api("/api/generate/quiz", {
          method: "POST",
          body: JSON.stringify({
            courseId: state.currentCourseId,
            documentIds: selectedDocumentIds(),
            count: $("#quiz-count").value,
            difficulty: $("#quiz-difficulty").value,
            types,
          }),
        });
        state.currentQuiz = data.questions || [];
        state.currentQuizEvaluation = data.evaluation || null;
        state.currentCourseModel = data.courseModel || state.currentCourseModel;
        renderQuiz(state.currentQuiz);
        $("#quiz-status").textContent = data.warning
          ? `API 不可用，已回退本地规则：${data.warning}`
          : data.provider === "api"
            ? "由 API 生成"
            : "由本地规则生成";
      } catch (error) {
        $("#quiz-status").textContent = "";
        toast(error.message);
      }
    });

    $("#quiz-list").addEventListener("click", async (event) => {
      const card = event.target.closest(".question-card");
      if (!card) return;
      const index = Number(card.dataset.questionIndex);
      const question = state.currentQuiz[index];
      if (event.target.closest(".delete-question")) {
        state.currentQuiz.splice(index, 1);
        renderQuiz(state.currentQuiz);
        $("#quiz-status").textContent = state.currentQuiz.length ? `已删除第 ${index + 1} 题` : "题目已清空";
        toast("题目已删除");
        return;
      }
      if (!question) return;
      if (event.target.closest(".show-answer")) {
        $(".answer-panel", card).classList.toggle("visible");
      }
      const markButton = event.target.closest(".mark-question");
      if (markButton) {
        await api(`/api/questions/${encodeURIComponent(question.question_id || question.id)}/progress`, {
          method: "POST",
          body: JSON.stringify({
            courseId: state.currentCourseId,
            status: markButton.dataset.status,
            notes: $(".user-answer", card).value,
          }),
        });
        toast(`已标记：${markButton.textContent.trim()}`);
      }
      if (event.target.closest(".save-mistake")) {
        await api("/api/mistakes", {
          method: "POST",
          body: JSON.stringify({
            courseId: state.currentCourseId,
            question: question.question_text || question.stem,
            answer: question.answer,
            explanation: question.explanation || (question.step_by_step_solution || []).join("\n"),
            sourceDocumentIds: questionSourceDocumentIds(question),
            userAnswer: $(".user-answer", card).value,
          }),
        });
        state.currentPlan = null;
        state.currentCramPack = null;
        renderPlanner();
        renderCramPack();
        toast("已加入错题本");
      }
    });

    $("#ask-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const question = $("#ask-input").value.trim();
      if (!question) return toast("请输入问题");
      const output = $("#ask-output");
      output.classList.remove("empty-state");
      output.textContent = "正在检索资料...";
      try {
        const data = await api("/api/ask", {
          method: "POST",
          body: JSON.stringify({
            courseId: state.currentCourseId,
            documentIds: selectedDocumentIds(),
            question,
          }),
        });
        renderMarkdown(output, data.warning ? `> ${data.warning}\n\n${data.answer}` : data.answer);
      } catch (error) {
        toast(error.message);
      }
    });

    $("#mistake-list").addEventListener("change", async (event) => {
      const input = event.target.closest(".mastered-check");
      if (!input) return;
      await api(`/api/mistakes/${input.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ mastered: input.checked }),
      });
      state.currentPlan = null;
      state.currentCramPack = null;
      renderPlanner();
      renderCramPack();
      toast(input.checked ? "已标记掌握" : "已取消掌握标记");
    });

    $("#mistake-list").addEventListener("click", async (event) => {
      const deleteButton = event.target.closest(".delete-mistake");
      if (deleteButton) {
        const card = event.target.closest("[data-mistake-id]");
        const mistakeId = card?.dataset.mistakeId;
        if (!mistakeId) return;
        if (!window.confirm("删除这条错题？相关复盘记录里的引用也会移除。")) return;
        try {
          await api(`/api/mistakes/${encodeURIComponent(mistakeId)}`, { method: "DELETE" });
          state.currentPlan = null;
          state.currentCramPack = null;
          renderPlanner();
          renderCramPack();
          toast("错题已删除");
        } catch (error) {
          toast(error.message);
        }
        return;
      }

      const button = event.target.closest(".similar-question");
      if (!button) return;
      const card = event.target.closest("[data-mistake-id]");
      const mistakeId = card?.dataset.mistakeId;
      if (!mistakeId) return;
      button.disabled = true;
      button.textContent = "生成中...";
      try {
        const data = await api("/api/generate/similar", {
          method: "POST",
          body: JSON.stringify({ mistakeId, count: 4 }),
        });
        state.currentQuiz = data.questions || [];
        state.currentQuizEvaluation = data.evaluation || null;
        renderQuiz(state.currentQuiz);
        $$(".tab-button").find((item) => item.dataset.tab === "quiz")?.click();
        $("#quiz-status").textContent = data.warning
          ? `API 不可用，已回退本地规则：${data.warning}`
          : data.provider === "api"
            ? "已由 API 生成同类题"
            : "已由本地规则生成同类题";
        toast("同类题已生成");
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
        button.innerHTML = '<i data-lucide="copy-plus"></i>生成同类题';
        iconRefresh();
      }
    });

    $("#refresh-api-models").addEventListener("click", refreshApiModels);
    $("#test-api-connection").addEventListener("click", testApiConnection);

    $("#settings-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify(apiSettingsPayload()),
      });
      $("#api-key").value = "";
      setApiStatus("设置已保存。生成类功能会使用当前选择的模型。", "good");
      toast("设置已保存");
    });
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "刚刚";
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  async function boot() {
    bindEvents();
    const data = await api("/api/state");
    state.data = data;
    keepValidCourse();
    render();
  }

  boot().catch((error) => {
    toast(error.message);
    console.error(error);
  });
})();
