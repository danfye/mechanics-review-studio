const http = require("node:http");

function request(path, method = "GET", body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        hostname: "localhost",
        port: Number(process.env.PORT || 4173),
        path,
        method,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": payload.length,
              ...headers,
            }
          : headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(text) });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, data: text });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  let cookie = "";
  const authStatus = await request("/auth/status");
  if (authStatus.status === 200 && authStatus.data?.enabled) {
    const password = process.env.API_COURSE_TUTOR_WEB_PASSWORD || process.env.WEB_PASSWORD;
    if (!password) throw new Error("auth is enabled; set API_COURSE_TUTOR_WEB_PASSWORD for smoke test");
    const unauthenticated = await request("/api/state");
    if (unauthenticated.status !== 401) throw new Error(`unauthenticated state was not blocked: ${unauthenticated.status}`);
    const login = await request("/auth/login", "POST", { password });
    if (login.status !== 200) throw new Error(`login failed: ${login.status}`);
    cookie = Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"][0].split(";")[0] : "";
    if (!cookie) throw new Error("login did not set a session cookie");
    console.log("auth ok");
  }
  const authHeaders = cookie ? { cookie } : {};
  const page = await request("/", "GET", null, authHeaders);
  if (page.status !== 200 || !String(page.data).includes("API 课程助教")) {
    throw new Error(`page failed: ${page.status}`);
  }
  console.log("page ok");
  const state = await request("/api/state", "GET", null, authHeaders);
  if (state.status !== 200) throw new Error(`state failed: ${state.status}`);
  if (state.data.version !== 2 || !Array.isArray(state.data.courses) || !Array.isArray(state.data.materials)) {
    throw new Error(`unexpected state shape: ${JSON.stringify(state.data).slice(0, 240)}`);
  }
  console.log("state ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
