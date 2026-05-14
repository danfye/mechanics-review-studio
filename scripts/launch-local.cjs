const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PORTS = [4173, 4174, 4175, 4176, 4177, 4178];
const HOST = "127.0.0.1";

function requestJson(port, pathname) {
  return new Promise((resolve) => {
    const request = http.get({ host: HOST, port, path: pathname, timeout: 500 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode !== 200) return resolve(null);
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    request.on("error", () => resolve(null));
    request.on("timeout", () => {
      request.destroy();
      resolve(null);
    });
  });
}

function probePort(port) {
  return new Promise((resolve) => {
    const request = http.get({ host: HOST, port, path: "/", timeout: 500 }, (response) => {
      response.resume();
      resolve({ free: false });
    });
    request.on("error", () => resolve({ free: true }));
    request.on("timeout", () => {
      request.destroy();
      resolve({ free: false });
    });
  });
}

function openBrowser(url) {
  const platform = process.platform;
  if (platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  else if (platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

async function findExistingApp() {
  for (const port of PORTS) {
    const state = await requestJson(port, "/api/state");
    if (state && state.workspace && Array.isArray(state.courses)) return port;
  }
  return null;
}

async function findFreePort() {
  for (const port of PORTS) {
    const result = await probePort(port);
    if (result.free) return port;
  }
  return null;
}

async function main() {
  const existingPort = await findExistingApp();
  if (existingPort) {
    const url = `http://${HOST}:${existingPort}`;
    console.log(`复习台已经在运行，正在打开 ${url}`);
    openBrowser(url);
    return;
  }

  const port = await findFreePort();
  if (!port) {
    console.error("4173-4178 端口都不可用，请关闭其他本地服务后再试。");
    process.exit(1);
  }

  const url = `http://${HOST}:${port}`;
  console.log(`正在启动复习台：${url}`);

  const child = spawn(process.execPath, ["server.cjs"], {
    cwd: ROOT,
    env: { ...process.env, HOST, PORT: String(port) },
    stdio: "inherit",
  });

  child.on("exit", (code) => process.exit(code || 0));
  setTimeout(() => openBrowser(url), 900);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
