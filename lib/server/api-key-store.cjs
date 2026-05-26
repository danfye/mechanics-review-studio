const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

function normalizeApiKey(value) {
  return String(value || "").trim();
}

function defaultApiKeyPath() {
  const homeDir = process.env.API_COURSE_TUTOR_HOME || os.userInfo().homedir || os.homedir();
  return path.join(homeDir, ".codex", "stem-review-studio", "api-key.json");
}

function createApiKeyStore({ filePath = defaultApiKeyPath() } = {}) {
  let cachedApiKey;
  let cacheLoaded = false;

  function readFromDisk() {
    if (cacheLoaded) return cachedApiKey || "";
    cacheLoaded = true;
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      cachedApiKey = normalizeApiKey(parsed?.apiKey || parsed?.key || parsed);
    } catch {
      cachedApiKey = "";
    }
    return cachedApiKey || "";
  }

  function getApiKey() {
    return readFromDisk();
  }

  function hasApiKey() {
    return Boolean(getApiKey());
  }

  async function saveApiKey(apiKey) {
    const value = normalizeApiKey(apiKey);
    cachedApiKey = value;
    cacheLoaded = true;
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, JSON.stringify({ apiKey: value }, null, 2), { mode: 0o600 });
    try {
      await fsp.chmod(filePath, 0o600);
    } catch {
      // Ignore platforms that do not support chmod semantics for this file.
    }
    return value;
  }

  async function clearApiKey() {
    cachedApiKey = "";
    cacheLoaded = true;
    try {
      await fsp.unlink(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return {
    filePath,
    getApiKey,
    hasApiKey,
    saveApiKey,
    clearApiKey,
  };
}

module.exports = {
  createApiKeyStore,
  defaultApiKeyPath,
  normalizeApiKey,
};
