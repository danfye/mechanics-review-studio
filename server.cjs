const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRuntimeRequire } = require("./lib/server/runtime-require.cjs");
const { json, readBody } = require("./lib/server/http.cjs");
const { createApiKeyStore, normalizeApiKey } = require("./lib/server/api-key-store.cjs");
const { createChatApiClient, listApiModels, resolveApiSettings } = require("./lib/server/api-client.cjs");
const { createMaterialService } = require("./lib/server/material-service.cjs");
const { createAssistantService } = require("./lib/server/assistant-service.cjs");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "db.json");
const PUBLIC_DIR = path.join(ROOT, "public");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const AUTO_EXIT_ENABLED = process.env.APP_LAUNCHED_BY_WRAPPER === "1";
const AUTO_EXIT_GRACE_MS = 9000;
let lastHeartbeatAt = Date.now();
let autoExitTimer = null;

const runtimeRequire = createRuntimeRequire(ROOT);
const apiKeyStore = createApiKeyStore();
const { callChatApi, testApiConnection } = createChatApiClient({ timeoutMs: 90000, cacheLimit: 12 });
const materialService = createMaterialService({ fsp, runtimeRequire, uploadDir: UPLOAD_DIR });
const assistantService = createAssistantService({
  fsp,
  uploadPath: materialService.uploadPath,
  callChatApi,
});

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function createDbTemplate() {
  const createdAt = now();
  return {
    version: 2,
    courses: [{ id: "course_default", name: "我的课程", createdAt, updatedAt: createdAt }],
    materials: [],
    conversations: [{ id: "conv_default", courseId: "course_default", title: "我的课程 助教", createdAt, updatedAt: createdAt }],
    messages: [],
    artifacts: [],
    settings: {
      provider: "api",
      apiBaseUrl: "",
      model: "",
      apiKey: "",
    },
  };
}

function recordHeartbeat() {
  lastHeartbeatAt = Date.now();
}

function scheduleAutoExitCheck(server) {
  if (!AUTO_EXIT_ENABLED || autoExitTimer) return;
  autoExitTimer = setInterval(() => {
    if (Date.now() - lastHeartbeatAt < AUTO_EXIT_GRACE_MS) return;
    console.log("No browser heartbeat detected; shutting down API course tutor.");
    clearInterval(autoExitTimer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  }, 2500);
  autoExitTimer.unref();
}

async function ensureDataStore() {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  try {
    await fsp.access(DB_PATH);
  } catch {
    await writeRawDb(createDbTemplate());
  }
}

async function readRawDb() {
  await ensureDataStore();
  try {
    const parsed = JSON.parse(await fsp.readFile(DB_PATH, "utf8"));
    return normalizeDb(parsed);
  } catch {
    return createDbTemplate();
  }
}

function normalizeDb(db = {}) {
  const template = createDbTemplate();
  return {
    ...template,
    ...db,
    version: 2,
    courses: Array.isArray(db.courses) ? db.courses : [],
    materials: Array.isArray(db.materials) ? db.materials : [],
    conversations: Array.isArray(db.conversations) ? db.conversations : [],
    messages: Array.isArray(db.messages) ? db.messages : [],
    artifacts: Array.isArray(db.artifacts) ? db.artifacts : [],
    settings: {
      ...template.settings,
      ...(db.settings || {}),
      provider: "api",
      apiKey: "",
    },
  };
}

async function readDb() {
  const db = await readRawDb();
  db.settings.apiKey = apiKeyStore.getApiKey();
  return db;
}

async function writeRawDb(db) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

async function writeDb(db, options = {}) {
  const apiKey = normalizeApiKey(db.settings?.apiKey);
  if (apiKey) await apiKeyStore.saveApiKey(apiKey);
  else if (options.clearApiKey === true) await apiKeyStore.clearApiKey();
  const publicDb = normalizeDb({
    ...db,
    settings: {
      ...(db.settings || {}),
      provider: "api",
      apiKey: "",
    },
  });
  await writeRawDb(publicDb);
}

function publicState(db) {
  const apiConfigured = assistantService.apiReady(db.settings);
  const courses = db.courses.map((course) => {
    const materials = db.materials.filter((material) => material.courseId === course.id);
    const messages = db.messages.filter((message) => message.courseId === course.id);
    const artifacts = db.artifacts.filter((artifact) => artifact.courseId === course.id);
    return {
      ...course,
      stats: {
        materials: materials.length,
        images: materials.filter((material) => material.kind === "image").length,
        messages: messages.length,
        artifacts: artifacts.length,
        textLength: materials.reduce((sum, material) => sum + String(material.text || "").length, 0),
      },
    };
  });
  return {
    version: 2,
    apiConfigured,
    autoExit: AUTO_EXIT_ENABLED,
    settings: {
      provider: "api",
      apiBaseUrl: db.settings.apiBaseUrl || "",
      model: db.settings.model || "",
      apiKey: db.settings.apiKey ? "__SET__" : "",
    },
    courses,
    materials: db.materials.map((material) => ({
      id: material.id,
      courseId: material.courseId,
      originalName: material.originalName,
      kind: material.kind,
      mimeType: material.mimeType || "",
      size: Number(material.size || 0),
      textLength: String(material.text || "").length,
      unitCount: (material.units || []).length,
      warning: material.warning || "",
      createdAt: material.createdAt,
      updatedAt: material.updatedAt,
    })),
    conversations: db.conversations,
    messages: db.messages,
    artifacts: db.artifacts,
  };
}

async function readJson(req, maxBytes = 20 * 1024 * 1024) {
  const body = await readBody(req, maxBytes);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

function parseMultipart(buffer, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[1] || /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[2];
  if (!boundary) throw new Error("缺少 multipart boundary。");
  const marker = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = buffer.indexOf(marker);
  while (cursor !== -1) {
    cursor += marker.length;
    if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) break;
    if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) cursor += 2;
    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) break;
    const headerText = buffer.slice(cursor, headerEnd).toString("utf8");
    let next = buffer.indexOf(marker, headerEnd + 4);
    if (next === -1) next = buffer.length;
    let dataEnd = next;
    if (buffer[dataEnd - 2] === 13 && buffer[dataEnd - 1] === 10) dataEnd -= 2;
    const name = /name="([^"]+)"/i.exec(headerText)?.[1] || "";
    const filename = /filename="([^"]*)"/i.exec(headerText)?.[1] || "";
    const type = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() || "";
    const data = buffer.slice(headerEnd + 4, dataEnd);
    if (name) parts.push({ name, filename, type, data });
    cursor = next;
  }
  const fields = {};
  const files = [];
  for (const part of parts) {
    if (part.filename) files.push(part);
    else fields[part.name] = part.data.toString("utf8");
  }
  return { fields, files };
}

function getOrCreateDefaultCourse(db) {
  let course = db.courses[0];
  if (!course) {
    course = { id: id("course"), name: "我的课程", createdAt: now(), updatedAt: now() };
    db.courses.push(course);
  }
  return course;
}

function courseById(db, courseId) {
  if (courseId) return db.courses.find((course) => course.id === courseId) || null;
  return getOrCreateDefaultCourse(db);
}

async function handleMaterials(req, res, db) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) return json(res, 400, { error: "请使用 multipart/form-data 上传资料。" });
  const { fields, files } = parseMultipart(await readBody(req, 160 * 1024 * 1024), contentType);
  const course = courseById(db, fields.courseId);
  if (!course) return json(res, 404, { error: "没有找到该科目。" });
  if (!files.length) return json(res, 400, { error: "没有收到文件。" });
  const imported = [];
  for (const file of files) {
    const storedName = await materialService.saveUploadedFile(file);
    const extracted = await materialService.extractMaterial(file.data, file.filename, file.type);
    const material = {
      id: id("mat"),
      courseId: course.id,
      originalName: file.filename || "upload",
      storedName,
      kind: extracted.kind,
      mimeType: file.type || "",
      size: file.data.length,
      text: extracted.text || "",
      units: extracted.units || [],
      warning: extracted.warning || "",
      createdAt: now(),
      updatedAt: now(),
    };
    db.materials.unshift(material);
    imported.push(material);
  }
  course.updatedAt = now();
  await writeDb(db);
  return json(res, 200, { imported, state: publicState(await readDb()) });
}

async function handleAssistantMessage(req, res, db) {
  const body = await readJson(req);
  const course = courseById(db, body.courseId);
  if (!course) return json(res, 404, { error: "没有找到该科目。" });
  const text = String(body.message || "").trim();
  if (!text) return json(res, 400, { error: "消息不能为空。" });
  assistantService.assertApiReady(db.settings);
  const requestedMaterialIds = Array.isArray(body.materialIds)
    ? body.materialIds.map((materialId) => String(materialId || "").trim()).filter(Boolean)
    : [];
  const requestedMaterialIdSet = new Set(requestedMaterialIds);
  const availableMaterials = db.materials.filter((material) => material.courseId === course.id);
  const selectedMaterials = requestedMaterialIdSet.size
    ? availableMaterials.filter((material) => requestedMaterialIdSet.has(material.id))
    : availableMaterials;
  if (requestedMaterialIdSet.size && selectedMaterials.length !== requestedMaterialIdSet.size) {
    return json(res, 400, { error: "拖入的资料不属于当前科目或已经不存在。" });
  }
  let conversation = db.conversations.find((item) => item.courseId === course.id);
  if (!conversation) {
    conversation = { id: id("conv"), courseId: course.id, title: `${course.name} 助教`, createdAt: now(), updatedAt: now() };
    db.conversations.unshift(conversation);
  }
  const userMessage = {
    id: id("msg"),
    conversationId: conversation.id,
    courseId: course.id,
    role: "user",
    intent: assistantService.inferIntent(body),
    text,
    materialRefs: requestedMaterialIdSet.size
      ? selectedMaterials.map((material) => ({
        id: material.id,
        originalName: material.originalName,
        kind: material.kind,
      }))
      : [],
    createdAt: now(),
  };
  db.messages.push(userMessage);
  await writeDb(db);

  const freshDb = await readDb();
  const courseMaterials = freshDb.materials.filter((material) => material.courseId === course.id);
  const materials = requestedMaterialIdSet.size
    ? courseMaterials.filter((material) => requestedMaterialIdSet.has(material.id))
    : courseMaterials;
  const historyMessages = freshDb.messages.filter((message) => message.courseId === course.id);
  const artifacts = freshDb.artifacts.filter((artifact) => artifact.courseId === course.id);
  const result = await assistantService.runAssistant({
    settings: freshDb.settings,
    course,
    message: text,
    intent: body.intent,
    materials,
    messages: historyMessages,
    artifacts,
  });
  const assistantMessage = {
    id: id("msg"),
    conversationId: conversation.id,
    courseId: course.id,
    role: "assistant",
    intent: result.intent,
    title: result.title,
    text: result.answerMarkdown,
    sourceRefs: result.sourceRefs,
    nextActions: result.nextActions,
    createdAt: now(),
  };
  freshDb.messages.push(assistantMessage);
  const savedArtifacts = result.artifacts.map((artifact) => ({
    ...artifact,
    id: id("artifact"),
    courseId: course.id,
    messageId: assistantMessage.id,
    sourceRefs: result.sourceRefs,
    createdAt: now(),
    updatedAt: now(),
  }));
  freshDb.artifacts.unshift(...savedArtifacts);
  conversation.updatedAt = now();
  await writeDb(freshDb);
  return json(res, 200, {
    message: assistantMessage,
    artifacts: savedArtifacts,
    state: publicState(await readDb()),
  });
}

async function handleSettingsModels(req, res, db) {
  const body = await readJson(req);
  const settings = resolveApiSettings(db.settings, { ...body, provider: "api" });
  try {
    const models = await listApiModels(settings);
    return json(res, 200, { ok: true, models, selectedModel: settings.model && models.some((model) => model.id === settings.model) ? settings.model : models[0]?.id || "" });
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message || "模型列表获取失败。" });
  }
}

async function handleSettingsTest(req, res, db) {
  const body = await readJson(req);
  const settings = resolveApiSettings(db.settings, { ...body, provider: "api" });
  try {
    const models = await listApiModels(settings);
    const selectedModel = settings.model && models.some((model) => model.id === settings.model) ? settings.model : models[0]?.id || settings.model;
    await testApiConnection({ ...settings, model: selectedModel });
    return json(res, 200, { ok: true, message: "API 连接成功。", models, selectedModel });
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message || "API 连接测试失败。" });
  }
}

async function handleSettingsSave(req, res, db) {
  const body = await readJson(req);
  const settings = resolveApiSettings(db.settings, { ...body, provider: "api" });
  db.settings = { ...settings, provider: "api" };
  await writeDb(db, { clearApiKey: Boolean(body.clearApiKey) });
  return json(res, 200, { settings: publicState(await readDb()).settings, state: publicState(await readDb()) });
}

async function handleApi(req, res, pathname) {
  const db = await readDb();
  if (req.method === "POST" && pathname === "/api/heartbeat") {
    recordHeartbeat();
    return json(res, 200, { ok: true, autoExit: AUTO_EXIT_ENABLED });
  }
  if (req.method === "GET" && pathname === "/api/state") return json(res, 200, publicState(db));
  if (req.method === "POST" && pathname === "/api/courses") {
    const body = await readJson(req);
    const name = String(body.name || "").trim() || "我的课程";
    const course = { id: id("course"), name, createdAt: now(), updatedAt: now() };
    db.courses.unshift(course);
    await writeDb(db);
    return json(res, 200, { course, state: publicState(await readDb()) });
  }
  if (req.method === "POST" && pathname === "/api/materials") return handleMaterials(req, res, db);
  if (req.method === "POST" && pathname === "/api/assistant/messages") return handleAssistantMessage(req, res, db);
  if (req.method === "POST" && pathname === "/api/settings/models") return handleSettingsModels(req, res, db);
  if (req.method === "POST" && pathname === "/api/settings/test") return handleSettingsTest(req, res, db);
  if (req.method === "POST" && pathname === "/api/settings") return handleSettingsSave(req, res, db);
  return json(res, 404, { error: "未知 API。" });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

function streamFile(res, filePath, contentType = contentTypeFor(filePath)) {
  res.writeHead(200, { "content-type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

async function handleStatic(req, res, url) {
  if (url.pathname === "/vendor/lucide.js") return streamFile(res, runtimeRequire.resolve("lucide/dist/umd/lucide.js"), "text/javascript; charset=utf-8");
  if (url.pathname === "/vendor/marked.umd.js") return streamFile(res, runtimeRequire.resolve("marked/lib/marked.umd.js"), "text/javascript; charset=utf-8");
  if (url.pathname.startsWith("/uploads/")) {
    const storedName = decodeURIComponent(url.pathname.slice("/uploads/".length));
    return streamFile(res, materialService.uploadPath(storedName));
  }
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    await fsp.access(filePath);
    return streamFile(res, filePath);
  } catch {
    if (req.method === "GET" && !path.extname(url.pathname)) {
      return streamFile(res, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
    }
    res.writeHead(404);
    res.end("Not found");
  }
}

async function requestHandler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url.pathname);
    return await handleStatic(req, res, url);
  } catch (error) {
    return json(res, 500, { error: error.message || "服务器错误。" });
  }
}

if (require.main === module) {
  ensureDataStore()
    .then(() => {
      const server = http.createServer(requestHandler);
      server.listen(PORT, HOST, () => {
        scheduleAutoExitCheck(server);
        console.log(`API course tutor running at http://${HOST}:${PORT}`);
      });
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  createDbTemplate,
  materialService,
  publicState,
  requestHandler,
};
