(() => {
  const state = {
    data: null,
    currentCourseId: null,
    activeIntent: "teach_materials",
    busy: false,
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: options.body instanceof FormData ? options.headers || {} : { "content-type": "application/json", ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
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

  function course() {
    return (state.data?.courses || []).find((item) => item.id === state.currentCourseId) || state.data?.courses?.[0] || null;
  }

  function courseMaterials() {
    return (state.data?.materials || []).filter((item) => item.courseId === state.currentCourseId);
  }

  function courseMessages() {
    return (state.data?.messages || []).filter((item) => item.courseId === state.currentCourseId);
  }

  function courseArtifacts() {
    return (state.data?.artifacts || []).filter((item) => item.courseId === state.currentCourseId);
  }

  function setData(data) {
    state.data = data;
    if (!state.currentCourseId || !data.courses.some((item) => item.id === state.currentCourseId)) {
      state.currentCourseId = data.courses[0]?.id || null;
    }
  }

  function render() {
    renderCourses();
    renderMaterials();
    renderSettings();
    renderApiState();
    renderChat();
    renderArtifacts();
    iconRefresh();
  }

  function renderApiState() {
    const active = course();
    $("#course-title").textContent = active?.name || "先新建科目";
    $("#api-state-label").textContent = state.data?.apiConfigured ? `API 已连接 · ${state.data.settings.model || "未选择模型"}` : "API 未配置";
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
        (item) => `<article class="material-card">
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
    const messages = courseMessages();
    if (!messages.length) {
      log.innerHTML = `<article class="welcome-card">
        <span>开始</span>
        <h3>把课件、作业图和复习目标都交给一个助教</h3>
        <p>先在左侧导入资料，然后选择一个任务或直接提问。当前科目全部资料会默认进入上下文。</p>
      </article>`;
      return;
    }
    log.innerHTML = messages
      .map((message) => {
        const isAssistant = message.role === "assistant";
        const body = isAssistant ? markdown(message.text || "") : `<p>${escapeHtml(message.text || "")}</p>`;
        const actions = isAssistant && message.nextActions?.length
          ? `<div class="next-actions">${message.nextActions.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`
          : "";
        return `<article class="message ${isAssistant ? "assistant" : "user"}">
          <div class="message-meta">${isAssistant ? escapeHtml(message.title || "助教") : "你"} · ${intentLabel(message.intent)}</div>
          <div class="message-body">${body}</div>
          ${actions}
        </article>`;
      })
      .join("");
    log.scrollTop = log.scrollHeight;
    const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    renderSources(lastAssistant?.sourceRefs || []);
  }

  function markdown(value) {
    if (window.marked) return window.marked.parse(String(value || ""));
    return `<p>${escapeHtml(value)}</p>`;
  }

  function intentLabel(intent) {
    if (intent === "solve_homework") return "作业解题";
    if (intent === "final_review") return "期末复习";
    return "课件教学";
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
          <p>${escapeHtml(ref.excerpt || "")}</p>
        </article>`,
      )
      .join("");
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
          ${artifact.body ? `<p>${escapeHtml(artifact.body).slice(0, 220)}</p>` : ""}
          ${artifact.items?.length ? `<ul>${artifact.items.slice(0, 5).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
        </article>`,
      )
      .join("");
  }

  function artifactTypeLabel(type) {
    return { lesson: "教学", solution: "解题", review_plan: "复习计划", drill_set: "练习", memory_card: "记忆卡" }[type] || "档案";
  }

  async function loadState() {
    setData(await api("/api/state"));
    render();
  }

  async function createCourse(event) {
    event.preventDefault();
    const name = $("#course-name").value.trim();
    if (!name) return;
    const data = await api("/api/courses", { method: "POST", body: JSON.stringify({ name }) });
    setData(data.state);
    state.currentCourseId = data.course.id;
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
      $("#settings-panel").hidden = false;
      return toast("请先完成 API 配置");
    }
    const message = $("#chat-input").value.trim();
    if (!message) return;
    setBusy(true, "助教正在生成...");
    try {
      const data = await api("/api/assistant/messages", {
        method: "POST",
        body: JSON.stringify({ courseId: state.currentCourseId, intent: state.activeIntent, message }),
      });
      setData(data.state);
      $("#chat-input").value = "";
      render();
    } finally {
      setBusy(false);
    }
  }

  function setBusy(value, label = "") {
    state.busy = value;
    $("#send-message").disabled = value || !state.data?.apiConfigured;
    $("#send-message").innerHTML = value ? `<i data-lucide="loader-circle"></i>${escapeHtml(label || "处理中")}` : '<i data-lucide="send"></i>发送';
    iconRefresh();
  }

  async function refreshModels() {
    const apiBaseUrl = $("#api-base-url").value.trim();
    const apiKey = $("#api-key").value.trim();
    setSettingsStatus("正在检测模型...");
    const data = await api("/api/settings/models", {
      method: "POST",
      body: JSON.stringify({ apiBaseUrl, apiKey, model: $("#api-model").value }),
    });
    const select = $("#api-model");
    select.innerHTML = data.models.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.id)}</option>`).join("");
    if (data.selectedModel) select.value = data.selectedModel;
    setSettingsStatus(`检测成功：${data.models.length} 个模型。`);
  }

  async function testApi() {
    setSettingsStatus("正在测试连接...");
    const data = await api("/api/settings/test", {
      method: "POST",
      body: JSON.stringify(settingsPayload()),
    });
    if (data.models?.length) {
      $("#api-model").innerHTML = data.models.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.id)}</option>`).join("");
      $("#api-model").value = data.selectedModel || $("#api-model").value;
    }
    setSettingsStatus(data.message || "API 连接成功。");
  }

  async function saveSettings(event) {
    event.preventDefault();
    const data = await api("/api/settings", { method: "POST", body: JSON.stringify(settingsPayload()) });
    setData(data.state);
    $("#api-key").value = "";
    setSettingsStatus("设置已保存。");
    render();
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

  function setSettingsStatus(message) {
    $("#settings-status").textContent = message;
  }

  function bindEvents() {
    $("#course-form").addEventListener("submit", createCourse);
    $("#material-form").addEventListener("submit", uploadMaterials);
    $("#chat-form").addEventListener("submit", sendMessage);
    $("#settings-toggle").addEventListener("click", () => {
      $("#settings-panel").hidden = !$("#settings-panel").hidden;
    });
    $("#refresh-models").addEventListener("click", () => refreshModels().catch((error) => setSettingsStatus(error.message)));
    $("#test-api").addEventListener("click", () => testApi().catch((error) => setSettingsStatus(error.message)));
    $("#settings-form").addEventListener("submit", (event) => saveSettings(event).catch((error) => setSettingsStatus(error.message)));
    $("#course-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-course-id]");
      if (!button) return;
      state.currentCourseId = button.dataset.courseId;
      render();
    });
    $$(".intent-button").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeIntent = button.dataset.intent;
        $$(".intent-button").forEach((item) => item.classList.toggle("active", item === button));
        $("#chat-input").focus();
      });
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

  bindEvents();
  startHeartbeat();
  loadState().catch((error) => toast(error.message));
})();
