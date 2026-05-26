const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { hashPassword } = require("./auth-service.cjs");

function defaultWebAuthPath() {
  const homeDir = process.env.API_COURSE_TUTOR_HOME || os.userInfo().homedir || os.homedir();
  return path.join(homeDir, ".codex", "stem-review-studio", "web-auth.json");
}

function passwordFromEnv() {
  return String(process.env.API_COURSE_TUTOR_WEB_PASSWORD || process.env.WEB_PASSWORD || "").trim();
}

function createWebAuthConfig(password) {
  const passwordSalt = crypto.randomBytes(16).toString("hex");
  return {
    version: 1,
    passwordHash: hashPassword(password, passwordSalt),
    passwordSalt,
    sessionSecret: crypto.randomBytes(32).toString("hex"),
    createdAt: new Date().toISOString(),
  };
}

function normalizeWebAuthConfig(config) {
  if (!config || typeof config !== "object") return null;
  if (!config.passwordHash || !config.passwordSalt || !config.sessionSecret) return null;
  return {
    version: 1,
    passwordHash: String(config.passwordHash),
    passwordSalt: String(config.passwordSalt),
    sessionSecret: String(config.sessionSecret),
    createdAt: config.createdAt || "",
  };
}

function loadWebAuthConfig(filePath = defaultWebAuthPath()) {
  const envPassword = passwordFromEnv();
  if (envPassword) return createWebAuthConfig(envPassword);
  try {
    return normalizeWebAuthConfig(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

async function ensureWebAuthConfig({ filePath = defaultWebAuthPath(), password = "" } = {}) {
  const envPassword = passwordFromEnv();
  const explicitPassword = String(password || envPassword || "").trim();
  try {
    const existing = normalizeWebAuthConfig(JSON.parse(await fsp.readFile(filePath, "utf8")));
    if (existing && !explicitPassword) return { config: existing, filePath, password: "", created: false };
  } catch {
    // Create a new local config below.
  }
  const finalPassword = explicitPassword || crypto.randomBytes(9).toString("base64url");
  const config = createWebAuthConfig(finalPassword);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    await fsp.chmod(filePath, 0o600);
  } catch {
    // Ignore platforms that do not support chmod semantics for this file.
  }
  return { config, filePath, password: finalPassword, created: true };
}

module.exports = {
  createWebAuthConfig,
  defaultWebAuthPath,
  ensureWebAuthConfig,
  loadWebAuthConfig,
  passwordFromEnv,
};
