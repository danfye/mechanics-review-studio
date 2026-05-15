const crypto = require("node:crypto");

const DEFAULT_API_CACHE_TTL_MS = 1000 * 60 * 10;
const DEFAULT_API_TIMEOUT_MS = 1000 * 45;
const DEFAULT_API_CACHE_LIMIT = 24;

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

function createChatApiClient(options = {}) {
  const apiResponseCache = new Map();
  const cacheTtlMs = Number(options.cacheTtlMs || DEFAULT_API_CACHE_TTL_MS);
  const timeoutMs = Number(options.timeoutMs || DEFAULT_API_TIMEOUT_MS);
  const cacheLimit = Number(options.cacheLimit || DEFAULT_API_CACHE_LIMIT);

  function cachedApiResponse(key) {
    const hit = apiResponseCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.createdAt > cacheTtlMs) {
      apiResponseCache.delete(key);
      return null;
    }
    return hit.content;
  }

  function storeApiResponse(key, content) {
    apiResponseCache.set(key, { content, createdAt: Date.now() });
    while (apiResponseCache.size > cacheLimit) {
      const oldestKey = apiResponseCache.keys().next().value;
      apiResponseCache.delete(oldestKey);
    }
  }

  async function callChatApi(settings, messages, responseFormat, requestOptions = {}) {
    if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
      throw new Error("请先在设置中填写 API Base URL、模型名和 API Key。");
    }
    const url = apiRequestUrl(settings, "/chat/completions");
    const key = requestOptions.cache !== false ? apiCacheKey(settings, messages, responseFormat) : "";
    if (key) {
      const cached = cachedApiResponse(key);
      if (cached !== null) return cached;
    }
    const body = {
      model: settings.model,
      messages,
      temperature: requestOptions.temperature ?? 0.2,
    };
    if (requestOptions.maxTokens) body.max_tokens = requestOptions.maxTokens;
    if (responseFormat) body.response_format = responseFormat;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(requestOptions.timeoutMs || timeoutMs));
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

  return {
    callChatApi,
    testApiConnection,
  };
}

module.exports = {
  createChatApiClient,
  normalizeApiBaseUrl,
  apiRequestUrl,
  resolveApiSettings,
  fetchJsonFromApi,
  normalizeModelList,
  listApiModels,
};
