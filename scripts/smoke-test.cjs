const http = require("node:http");

function request(path, method = "GET", body) {
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
            }
          : undefined,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode, data: JSON.parse(text) });
          } catch {
            resolve({ status: res.statusCode, data: text });
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
  const page = await request("/");
  if (page.status !== 200 || !String(page.data).includes("力学复习台")) {
    throw new Error(`page failed: ${page.status}`);
  }
  console.log("page ok");
  const state = await request("/api/state");
  if (state.status !== 200) throw new Error(`state failed: ${state.status}`);
  console.log("state ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
