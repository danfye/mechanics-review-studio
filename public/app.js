(() => {
  const state = {
    data: null,
    currentCourseId: null,
    activeIntent: "teach_materials",
    settingsOpen: false,
    busy: false,
    settingsAction: "",
    apiCheck: {
      status: "unknown",
      message: "API 尚未测试。",
      model: "",
      checkedAt: 0,
    },
    pendingChat: null,
    selectedMaterialIds: [],
  };
  const STORAGE_KEY = "api-course-tutor:view";
  const VALID_INTENTS = new Set(["teach_materials", "solve_homework", "final_review"]);
  const API_CHECK_TTL_MS = 1000 * 60 * 10;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: options.body instanceof FormData ? options.headers || {} : { "content-type": "application/json", ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && data.authRequired) {
      window.location.href = "/login";
      throw new Error("请先登录。");
    }
    if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
    return data;
  }

  function iconRefresh() {
    if (window.lucide) window.lucide.createIcons();
  }

  function toast(message) {
    const target = $("#toast");
    target.textContent = message;
    target.classList.add("show");
    window.setTimeout(() => target.classList.remove("show"), 2600);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeMathDelimiters(value) {
    return String(value || "")
      .replace(/\\\[/g, "$$")
      .replace(/\\\]/g, "$$")
      .replace(/\\\(/g, "$")
      .replace(/\\\)/g, "$");
  }

  function renderMathIn(target) {
    if (!target) return;
    if (window.renderMathInElement) {
      window.renderMathInElement(target, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false },
        ],
        throwOnError: false,
        strict: "ignore",
        trust: false,
      });
    }
    renderMathFallback(target);
  }

  function renderMathFallback(target) {
    if (!window.katex) return;
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.includes("$")) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest("script, style, textarea, code, pre, .katex")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) replaceMathTextNode(node);
  }

  function replaceMathTextNode(node) {
    const text = node.nodeValue;
    const fragment = document.createDocumentFragment();
    let index = 0;
    const pattern = /\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$/g;
    for (const match of text.matchAll(pattern)) {
      if (match.index > index) fragment.append(document.createTextNode(text.slice(index, match.index)));
      const tex = match[1] || match[2] || "";
      const displayMode = Boolean(match[1]);
      const wrapper = document.createElement(displayMode ? "div" : "span");
      if (displayMode) wrapper.className = "katex-display-fallback";
      try {
        window.katex.render(tex, wrapper, {
          displayMode,
          throwOnError: false,
          strict: "ignore",
          trust: false,
        });
      } catch {
        wrapper.textContent = match[0];
      }
      fragment.append(wrapper);
      index = match.index + match[0].length;
    }
    if (index < text.length) fragment.append(document.createTextNode(text.slice(index)));
    node.replaceWith(fragment);
  }

  function refreshRichContent(root = document) {
    renderMathIn(root);
    iconRefresh();
  }

  function mathText(value) {
    return escapeHtml(normalizeMathDelimiters(value));
  }

  function course() {
    return (state.data?.courses || []).find((item) => item.id === state.currentCourseId) || state.data?.courses?.[0] || null;
  }

  function courseMaterials() {
    return (state.data?.materials || []).filter((item) => item.courseId === state.currentCourseId);
  }

  function selectedMaterials() {
    const selected = new Set(state.selectedMaterialIds);
    return courseMaterials().filter((item) => selected.has(item.id));
  }

  function courseMessages() {
    return (state.data?.messages || []).filter((item) => item.courseId === state.currentCourseId);
  }

  function courseArtifacts() {
    return (state.data?.artifacts || []).filter((item) => item.courseId === state.currentCourseId);
  }

  function readSavedView({ includeStorage = true } = {}) {
    const params = new URLSearchParams(window.location.search);
    let saved = {};
    if (includeStorage) {
      try {
        saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
      } catch {
        saved = {};
      }
    }
    const courseId = params.get("course") || saved.courseId || null;
    const intent = params.get("intent") || saved.intent || state.activeIntent;
    state.currentCourseId = courseId;
    state.activeIntent = VALID_INTENTS.has(intent) ? intent : "teach_materials";
    state.settingsOpen = params.get("settings") === "1" || Boolean(saved.settingsOpen);
  }

  function syncSavedView({ replace = false } = {}) {
    const params = new URLSearchParams(window.location.search);
    if (state.currentCourseId) params.set("course", state.currentCourseId);
    else params.delete("course");
    if (state.activeIntent && state.activeIntent !== "teach_materials") params.set("intent", state.activeIntent);
    else params.delete("intent");
    if (state.settingsOpen) params.set("settings", "1");
    else params.delete("settings");
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    if (nextUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history[replace ? "replaceState" : "pushState"]({}, "", nextUrl);
    }
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        courseId: state.currentCourseId,
        intent: state.activeIntent,
        settingsOpen: state.settingsOpen,
      }),
    );
  }

  function setCurrentCourse(courseId, options = {}) {
    state.currentCourseId = courseId;
    state.selectedMaterialIds = [];
    syncSavedView(options);
  }

  function setActiveIntent(intent, options = {}) {
    state.activeIntent = VALID_INTENTS.has(intent) ? intent : "teach_materials";
    syncSavedView(options);
    $$(".intent-button").forEach((item) => item.classList.toggle("active", item.dataset.intent === state.activeIntent));
  }

  function setSettingsOpen(open, options = {}) {
    state.settingsOpen = Boolean(open);
    $("#settings-panel").hidden = !state.settingsOpen;
    syncSavedView(options);
  }

  function setData(data) {
    state.data = data;
    if (!state.currentCourseId || !data.courses.some((item) => item.id === state.currentCourseId)) {
      setCurrentCourse(data.courses[0]?.id || null, { replace: true });
    }
    const available = new Set(courseMaterials().map((item) => item.id));
    state.selectedMaterialIds = state.selectedMaterialIds.filter((id) => available.has(id));
  }

  function render() {
    renderCourses();
    renderMaterials();
    renderSettings();
    renderApiState();
    renderChat();
    renderChatReferences();
    renderArtifacts();
    iconRefresh();
  }

  function renderApiState() {
    const active = course();
    const model = state.apiCheck.model || state.data?.settings?.model || "未选择模型";
    const status = state.apiCheck.status === "unknown" && !state.data?.apiConfigured ? "unconfigured" : state.apiCheck.status;
    const labelText = {
      unconfigured: "API 未配置",
      unknown: `API 已填写，等待测试 · ${model}`,
      checking: "API 正在测试...",
      ok: `API 已验证 · ${model}`,
      error: `API 测试失败 · ${state.apiCheck.message || "请检查设置"}`,
    }[status] || "API 状态未知";
    $("#course-title").textContent = active?.name || "先新建科目";
    $("#api-state-label").textContent = labelText;
    $("#api-state-label").className = `eyebrow api-state ${status}`;
    $("#setup-alert").hidden = Boolean(state.data?.apiConfigured);
    $("#send-message").disabled = !state.data?.apiConfigured || state.busy;
  }

  function renderCourses() {
    const list = $("#course-list");
    const courses = state.data?.courses || [];
    list.innerHTML = courses
      .map(
        (item) => `<button class="course-item${item.id === state.currentCourseId ? " active" : ""}" type="button" data-course-id="${escapeHtml(item.id)}">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${Number(item.stats?.materials || 0)} 份资料 · ${Number(item.stats?.artifacts || 0)} 张档案</span>
        </button>`,
      )
      .join("");
  }

  function renderMaterials() {
    const materials = courseMaterials();
    $("#material-count").textContent = String(materials.length);
    const list = $("#material-list");
    if (!materials.length) {
      list.className = "material-list empty-state";
      list.textContent = "还没有资料。";
      return;
    }
    list.className = "material-list";
    list.innerHTML = materials
      .map(
        (item) => `<article class="material-card" draggable="true" data-material-id="${escapeHtml(item.id)}" title="拖到对话框，指定本轮使用这份资料">
          <div>
            <strong>${escapeHtml(item.originalName)}</strong>
            <span>${escapeHtml(kindLabel(item.kind))} · ${Number(item.unitCount || 0)} 段 · ${Number(item.textLength || 0)} 字</span>
          </div>
          ${item.warning ? `<p>${escapeHtml(item.warning)}</p>` : ""}
        </article>`,
      )
      .join("");
  }

  function kindLabel(kind) {
    return { pptx: "PPT", pdf: "PDF", image: "图片", text: "文本" }[kind] || "文件";
  }

  function renderSettings() {
    const settings = state.data?.settings || {};
    $("#settings-panel").hidden = !state.settingsOpen;
    $("#api-base-url").value = settings.apiBaseUrl || "";
    ensureModelOption(settings.model || "");
    $("#api-model").value = settings.model || "";
    $("#api-key").placeholder = settings.apiKey ? "已保存，留空不修改" : "输入 API Key";
    $("#clear-api-key").checked = false;
  }

  function ensureModelOption(model) {
    const select = $("#api-model");
    const values = new Set($$("#api-model option").map((option) => option.value));
    if (model && !values.has(model)) select.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`);
    if (!select.options.length) select.insertAdjacentHTML("beforeend", '<option value="">先检测模型</option>');
  }

  function renderChat() {
    const log = $("#chat-log");
    const messages = [...courseMessages(), ...pendingMessages()];
    if (!messages.length) {
      log.innerHTML = `<article class="welcome-card">
        <span>开始</span>
        <h3>把课件、作业图/PDF 和复习目标都交给一个助教</h3>
        <p>左侧资料可以直接拖进对话框；未指定资料时，当前科目全部资料会默认进入上下文。</p>
      </article>`;
      return;
    }
    log.innerHTML = messages
      .map((message) => {
        const isAssistant = message.role === "assistant";
        const body = isAssistant ? markdown(message.text || "") : `<p>${escapeHtml(message.text || "")}</p>`;
        const refs = !isAssistant && message.materialRefs?.length ? renderMessageMaterialRefs(message.materialRefs) : "";
        const actions = isAssistant && message.nextActions?.length
          ? `<div class="next-actions">${message.nextActions.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`
          : "";
        const pending = message.pending ? " pending" : "";
        return `<article class="message ${isAssistant ? "assistant" : "user"}${pending}" aria-busy="${message.pending ? "true" : "false"}">
          <div class="message-meta">${isAssistant ? escapeHtml(message.title || "助教") : "你"} · ${intentLabel(message.intent)}</div>
          <div class="message-body">${body}</div>
          ${refs}
          ${actions}
        </article>`;
      })
      .join("");
    log.scrollTop = log.scrollHeight;
    const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    renderSources(lastAssistant?.sourceRefs || []);
    refreshRichContent(log);
  }

  function pendingMessages() {
    if (!state.pendingChat || state.pendingChat.courseId !== state.currentCourseId) return [];
    return [
      {
        role: "user",
        intent: state.pendingChat.intent,
        text: state.pendingChat.message,
        materialRefs: state.pendingChat.materialRefs,
        pending: true,
      },
      {
        role: "assistant",
        intent: state.pendingChat.intent,
        title: "助教",
        text: `<span class="thinking-line"><i data-lucide="loader-circle" class="spin"></i>${escapeHtml(state.pendingChat.stage || "模型正在组织答案...")}</span>`,
        pending: true,
      },
    ];
  }

  function markdown(value) {
    const normalized = normalizeMathDelimiters(value);
    if (window.marked) return window.marked.parse(normalized);
    return `<p>${escapeHtml(normalized)}</p>`;
  }

  function intentLabel(intent) {
    if (intent === "solve_homework") return "作业解题";
    if (intent === "final_review") return "期末复习";
    return "课件教学";
  }

  function renderMessageMaterialRefs(materialRefs = []) {
    return `<div class="message-refs">${materialRefs.map((item) => `<span><i data-lucide="paperclip"></i>${escapeHtml(item.originalName || "资料")}</span>`).join("")}</div>`;
  }

  function renderChatReferences() {
    const list = $("#chat-reference-list");
    const selected = selectedMaterials();
    if (!selected.length) {
      list.className = "chat-reference-list empty";
      list.innerHTML = '<span>可把左侧资料拖到这里，指定本轮使用的文件。</span>';
      return;
    }
    list.className = "chat-reference-list";
    list.innerHTML = selected
      .map(
        (item) => `<button class="reference-chip" type="button" data-remove-material-id="${escapeHtml(item.id)}" title="移除这份本轮引用">
          <i data-lucide="paperclip"></i>
          <span>${escapeHtml(item.originalName)}</span>
          <i data-lucide="x"></i>
        </button>`,
      )
      .join("");
  }

  function addMaterialReference(materialId) {
    const material = courseMaterials().find((item) => item.id === materialId);
    if (!material) return false;
    if (!state.selectedMaterialIds.includes(material.id)) state.selectedMaterialIds.push(material.id);
    renderChatReferences();
    iconRefresh();
    return true;
  }

  function renderSources(sourceRefs) {
    const list = $("#source-list");
    if (!sourceRefs.length) {
      list.className = "source-list empty-state";
      list.textContent = "回答中的资料引用会显示在这里。";
      return;
    }
    list.className = "source-list";
    list.innerHTML = sourceRefs
      .map(
        (ref) => `<article class="source-card">
          <strong>${escapeHtml(ref.file_name || ref.document_id || "资料")}</strong>
          <span>${escapeHtml(ref.unit_label || (Number.isInteger(ref.unit_index) ? `片段 ${ref.unit_index + 1}` : "来源片段"))}</span>
          <p>${mathText(ref.excerpt || "")}</p>
        </article>`,
      )
      .join("");
    refreshRichContent(list);
  }

  function renderArtifacts() {
    const artifacts = courseArtifacts();
    $("#artifact-count").textContent = String(artifacts.length);
    const list = $("#artifact-list");
    if (!artifacts.length) {
      list.className = "artifact-list empty-state";
      list.textContent = "助教回答后会沉淀教学、解题和复习卡片。";
      return;
    }
    list.className = "artifact-list";
    list.innerHTML = artifacts
      .slice(0, 18)
      .map(
        (artifact) => `<article class="artifact-card">
          <span>${escapeHtml(artifactTypeLabel(artifact.type))}</span>
          <strong>${escapeHtml(artifact.title)}</strong>
          ${artifact.body ? `<p class="artifact-body">${mathText(String(artifact.body).slice(0, 220))}</p>` : ""}
          ${artifact.items?.length ? `<ul>${artifact.items.slice(0, 5).map((item) => `<li>${mathText(item)}</li>`).join("")}</ul>` : ""}
        </article>`,
      )
      .join("");
    refreshRichContent(list);
  }

  function artifactTypeLabel(type) {
    return { lesson: "教学", solution: "解题", review_plan: "复习计划", drill_set: "练习", memory_card: "记忆卡" }[type] || "档案";
  }

  async function loadState({ testConnection = true } = {}) {
    setData(await api("/api/state"));
    await refreshAuthStatus();
    setActiveIntent(state.activeIntent, { replace: true });
    setSettingsOpen(state.settingsOpen, { replace: true });
    render();
    if (testConnection && state.data?.apiConfigured) autoTestApiConnection();
  }

  async function refreshAuthStatus() {
    const response = await fetch("/auth/status");
    const auth = await response.json().catch(() => ({}));
    $("#logout-button").hidden = !auth.enabled;
  }

  async function createCourse(event) {
    event.preventDefault();
    const name = $("#course-name").value.trim();
    if (!name) return;
    const data = await api("/api/courses", { method: "POST", body: JSON.stringify({ name }) });
    setData(data.state);
    setCurrentCourse(data.course.id);
    $("#course-name").value = "";
    render();
  }

  async function uploadMaterials(event) {
    event.preventDefault();
    const files = $("#material-input").files;
    if (!files.length) return toast("先选择资料文件");
    if (!state.currentCourseId) return toast("先新建科目");
    const form = new FormData();
    form.append("courseId", state.currentCourseId);
    [...files].forEach((file) => form.append("files", file));
    setBusy(true, "正在导入资料...");
    try {
      const data = await api("/api/materials", { method: "POST", body: form });
      setData(data.state);
      $("#material-input").value = "";
      toast(`已导入 ${data.imported.length} 份资料`);
      render();
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!state.data?.apiConfigured) {
      setSettingsOpen(true);
      return toast("请先完成 API 配置");
    }
    const message = $("#chat-input").value.trim();
    if (!message) return;
    const materialRefs = selectedMaterials().map((item) => ({
      id: item.id,
      originalName: item.originalName,
      kind: item.kind,
    }));
    const pending = {
      courseId: state.currentCourseId,
      intent: state.activeIntent,
      message,
      materialRefs,
      stage: "正在连接 API...",
    };
    state.pendingChat = pending;
    setBusy(true, "连接中...");
    render();
    try {
      await ensureApiConnection();
      pending.stage = materialRefs.length ? "正在读取拖入的资料..." : "正在读取当前科目资料...";
      setBusy(true, "读取资料...");
      render();
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      pending.stage = "模型正在组织答案...";
      setBusy(true, "思考中...");
      render();
      const data = await api("/api/assistant/messages", {
        method: "POST",
        body: JSON.stringify({
          courseId: state.currentCourseId,
          intent: state.activeIntent,
          message,
          materialIds: state.selectedMaterialIds,
        }),
      });
      setData(data.state);
      $("#chat-input").value = "";
      state.selectedMaterialIds = [];
      state.pendingChat = null;
      render();
    } catch (error) {
      state.pendingChat = null;
      render();
      toast(error.message);
      loadState({ testConnection: false }).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  function setBusy(value, label = "") {
    state.busy = value;
    $("#send-message").disabled = value || !state.data?.apiConfigured;
    $("#send-message").innerHTML = value ? `<i data-lucide="loader-circle" class="spin"></i>${escapeHtml(label || "处理中")}` : '<i data-lucide="send"></i>发送';
    iconRefresh();
  }

  async function refreshModels() {
    const apiBaseUrl = $("#api-base-url").value.trim();
    const apiKey = $("#api-key").value.trim();
    setSettingsAction("models");
    setSettingsStatus("正在检测模型...");
    try {
      const data = await api("/api/settings/models", {
        method: "POST",
        body: JSON.stringify({ apiBaseUrl, apiKey, model: $("#api-model").value }),
      });
      const select = $("#api-model");
      select.innerHTML = data.models.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.id)}</option>`).join("");
      if (data.selectedModel) select.value = data.selectedModel;
      setSettingsStatus(`检测成功：${data.models.length} 个模型。`);
      resetApiCheck("模型列表已更新，请测试连接。");
    } finally {
      setSettingsAction("");
    }
  }

  async function testApi({ silent = false, payload = null } = {}) {
    setSettingsAction("test");
    const requestPayload = payload || settingsPayload();
    setApiCheck({ status: "checking", message: "正在测试 API 连接...", model: requestPayload.model || state.data?.settings?.model || "" });
    if (!silent) setSettingsStatus("正在测试连接...");
    try {
      const data = await api("/api/settings/test", {
        method: "POST",
        body: JSON.stringify(requestPayload),
      });
      if (data.models?.length) {
        $("#api-model").innerHTML = data.models.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.id)}</option>`).join("");
        $("#api-model").value = data.selectedModel || $("#api-model").value;
      }
      setApiCheck({
        status: "ok",
        message: data.message || "API 连接成功。",
        model: data.selectedModel || $("#api-model").value.trim() || state.data?.settings?.model || "",
        checkedAt: Date.now(),
      });
      setSettingsStatus(data.message || "API 连接成功。");
      return data;
    } catch (error) {
      setApiCheck({
        status: "error",
        message: error.message || "API 连接测试失败。",
        model: requestPayload.model || state.data?.settings?.model || "",
        checkedAt: Date.now(),
      });
      if (!silent) setSettingsStatus(error.message);
      throw error;
    } finally {
      setSettingsAction("");
    }
  }

  async function ensureApiConnection() {
    if (apiCheckFresh()) return;
    await testApi({ silent: true, payload: savedSettingsPayload() });
  }

  function apiCheckFresh() {
    return state.apiCheck.status === "ok" && Date.now() - Number(state.apiCheck.checkedAt || 0) < API_CHECK_TTL_MS;
  }

  function autoTestApiConnection() {
    if (!state.data?.apiConfigured || state.apiCheck.status === "checking" || apiCheckFresh()) return;
    testApi({ silent: true, payload: savedSettingsPayload() }).catch((error) => {
      setSettingsStatus(error.message);
    });
  }

  function setApiCheck(next) {
    state.apiCheck = { ...state.apiCheck, ...next };
    renderApiState();
    iconRefresh();
  }

  function resetApiCheck(message = "API 配置已变化，等待测试。") {
    state.apiCheck = {
      status: "unknown",
      message,
      model: $("#api-model").value.trim() || state.data?.settings?.model || "",
      checkedAt: 0,
    };
    renderApiState();
  }

  async function saveSettings(event) {
    event.preventDefault();
    setSettingsAction("save");
    const data = await api("/api/settings", { method: "POST", body: JSON.stringify(settingsPayload()) });
    setData(data.state);
    $("#api-key").value = "";
    setSettingsStatus("设置已保存。");
    resetApiCheck("设置已保存，正在测试连接...");
    render();
    setSettingsAction("");
    if (state.data?.apiConfigured) autoTestApiConnection();
  }

  function settingsPayload() {
    return {
      provider: "api",
      apiBaseUrl: $("#api-base-url").value.trim(),
      model: $("#api-model").value.trim(),
      apiKey: $("#api-key").value.trim(),
      clearApiKey: $("#clear-api-key").checked,
    };
  }

  function savedSettingsPayload() {
    const settings = state.data?.settings || {};
    return {
      provider: "api",
      apiBaseUrl: settings.apiBaseUrl || "",
      model: settings.model || "",
    };
  }

  function setSettingsStatus(message) {
    $("#settings-status").textContent = message;
  }

  function setSettingsAction(action) {
    state.settingsAction = action;
    const refresh = $("#refresh-models");
    const test = $("#test-api");
    const save = $("#settings-form button[type='submit']");
    refresh.disabled = Boolean(action);
    test.disabled = Boolean(action);
    save.disabled = Boolean(action);
    refresh.innerHTML = action === "models" ? '<i data-lucide="loader-circle" class="spin"></i>检测中' : '<i data-lucide="refresh-cw"></i>检测';
    test.innerHTML = action === "test" ? '<i data-lucide="loader-circle" class="spin"></i>测试中' : '<i data-lucide="plug"></i>测试连接';
    save.innerHTML = action === "save" ? '<i data-lucide="loader-circle" class="spin"></i>保存中' : '<i data-lucide="save"></i>保存';
    iconRefresh();
  }

  function markSettingsChanged() {
    if (state.settingsAction) return;
    resetApiCheck("设置有变化，保存或测试后更新状态。");
  }

  function bindEvents() {
    $("#course-form").addEventListener("submit", createCourse);
    $("#material-form").addEventListener("submit", uploadMaterials);
    $("#chat-form").addEventListener("submit", sendMessage);
    $("#settings-toggle").addEventListener("click", () => {
      setSettingsOpen($("#settings-panel").hidden);
    });
    $("#logout-button").addEventListener("click", async () => {
      await fetch("/auth/logout", { method: "POST" }).catch(() => {});
      window.location.href = "/login";
    });
    $("#refresh-models").addEventListener("click", () => refreshModels().catch((error) => setSettingsStatus(error.message)));
    $("#test-api").addEventListener("click", () => testApi().catch((error) => setSettingsStatus(error.message)));
    $("#settings-form").addEventListener("submit", (event) => saveSettings(event).catch((error) => {
      setSettingsAction("");
      setSettingsStatus(error.message);
    }));
    $("#api-base-url").addEventListener("input", markSettingsChanged);
    $("#api-model").addEventListener("change", markSettingsChanged);
    $("#api-key").addEventListener("input", markSettingsChanged);
    $("#clear-api-key").addEventListener("change", markSettingsChanged);
    $("#course-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-course-id]");
      if (!button) return;
      setCurrentCourse(button.dataset.courseId);
      render();
    });
    $("#material-list").addEventListener("dragstart", (event) => {
      const card = event.target.closest("[data-material-id]");
      if (!card) return;
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/plain", card.dataset.materialId);
      event.dataTransfer.setData("application/x-api-course-material", card.dataset.materialId);
    });
    $("#material-list").addEventListener("dragend", (event) => {
      event.target.closest("[data-material-id]")?.classList.remove("dragging");
    });
    $("#chat-dropzone").addEventListener("dragover", (event) => {
      const types = Array.from(event.dataTransfer.types || []);
      if (!types.includes("application/x-api-course-material") && !types.includes("text/plain")) return;
      event.preventDefault();
      $("#chat-dropzone").classList.add("drag-over");
      event.dataTransfer.dropEffect = "copy";
    });
    $("#chat-dropzone").addEventListener("dragleave", (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove("drag-over");
    });
    $("#chat-dropzone").addEventListener("drop", (event) => {
      event.preventDefault();
      event.currentTarget.classList.remove("drag-over");
      const materialId = event.dataTransfer.getData("application/x-api-course-material") || event.dataTransfer.getData("text/plain");
      if (addMaterialReference(materialId)) $("#chat-input").focus();
    });
    $("#chat-reference-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-material-id]");
      if (!button) return;
      state.selectedMaterialIds = state.selectedMaterialIds.filter((id) => id !== button.dataset.removeMaterialId);
      renderChatReferences();
      iconRefresh();
    });
    $$(".intent-button").forEach((button) => {
      button.addEventListener("click", () => {
        setActiveIntent(button.dataset.intent);
        $("#chat-input").focus();
      });
    });
    window.addEventListener("popstate", () => {
      readSavedView({ includeStorage: false });
      if (state.data && !state.data.courses.some((item) => item.id === state.currentCourseId)) {
        state.currentCourseId = state.data.courses[0]?.id || null;
      }
      setActiveIntent(state.activeIntent, { replace: true });
      setSettingsOpen(state.settingsOpen, { replace: true });
      render();
    });
  }

  function startHeartbeat() {
    const beat = () => {
      fetch("/api/heartbeat", { method: "POST", keepalive: true }).catch(() => {});
    };
    beat();
    window.setInterval(beat, 3000);
    window.addEventListener("pagehide", beat);
  }

  readSavedView();
  bindEvents();
  startHeartbeat();
  loadState().catch((error) => toast(error.message));
})();
