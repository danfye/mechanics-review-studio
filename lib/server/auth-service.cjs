const crypto = require("node:crypto");

const COOKIE_NAME = "api_course_tutor_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password || ""), salt, 120000, 32, "sha256").toString("hex");
}

function constantEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signSession(secret, issuedAt, nonce) {
  return crypto.createHmac("sha256", secret).update(`${issuedAt}.${nonce}`).digest("hex");
}

function createAuthService({ enabled = false, config = null } = {}) {
  const authEnabled = Boolean(enabled);
  const passwordHash = config?.passwordHash || "";
  const passwordSalt = config?.passwordSalt || "";
  const sessionSecret = config?.sessionSecret || "";

  function isConfigured() {
    return Boolean(passwordHash && passwordSalt && sessionSecret);
  }

  function requireConfigured() {
    if (authEnabled && !isConfigured()) {
      throw new Error("网页登录保护已启用，但缺少密码配置。请使用 npm run web 启动或设置 WEB_PASSWORD。");
    }
  }

  function isEnabled() {
    return authEnabled;
  }

  function verifyPassword(password) {
    requireConfigured();
    return constantEqual(hashPassword(password, passwordSalt), passwordHash);
  }

  function createSessionCookie({ secure = false } = {}) {
    requireConfigured();
    const issuedAt = String(Date.now());
    const nonce = crypto.randomBytes(16).toString("hex");
    const signature = signSession(sessionSecret, issuedAt, nonce);
    const token = `${issuedAt}.${nonce}.${signature}`;
    const parts = [
      `${COOKIE_NAME}=${encodeURIComponent(token)}`,
      "HttpOnly",
      "SameSite=Lax",
      "Path=/",
      `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
  }

  function clearSessionCookie() {
    return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  }

  function isAuthenticated(req) {
    if (!authEnabled) return true;
    if (!isConfigured()) return false;
    const token = parseCookies(req.headers.cookie || "")[COOKIE_NAME];
    if (!token) return false;
    const parts = String(token).split(".");
    if (parts.length !== 3) return false;
    const [issuedAt, nonce, signature] = parts;
    const issuedMs = Number(issuedAt);
    if (!Number.isFinite(issuedMs) || Date.now() - issuedMs > SESSION_MAX_AGE_SECONDS * 1000) return false;
    return constantEqual(signSession(sessionSecret, issuedAt, nonce), signature);
  }

  return {
    clearSessionCookie,
    createSessionCookie,
    isAuthenticated,
    isEnabled,
    requireConfigured,
    verifyPassword,
  };
}

module.exports = {
  COOKIE_NAME,
  createAuthService,
  hashPassword,
};
