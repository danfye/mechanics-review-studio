const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PORTS = [4173, 4174, 4175, 4176, 4177, 4178];
const HOST = "127.0.0.1";
const LOG_DIR = path.join(ROOT, "data", "logs");
const LOG_FILE = path.join(LOG_DIR, "launcher.log");

function findNodeBinary() {
  const candidates = [
    process.execPath,
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
    path.join(process.env.HOME || "", ".nvm", "current", "bin", "node"),
    path.join(process.env.HOME || "", ".volta", "bin", "node"),
    path.join(process.env.HOME || "", ".fnm", "node-versions", "current", "installation", "bin", "node"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Try the next common install path.
    }
  }
  return process.execPath;
}

function appendLog(message) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Logging should never prevent the app from opening.
  }
}

function notify(title, message, critical = false) {
  appendLog(`${title}: ${message}`);
  if (process.platform !== "darwin") return;
  const script = `display alert ${JSON.stringify(title)} message ${JSON.stringify(message)}${critical ? " as critical" : ""}`;
  spawnSync("osascript", ["-e", script], { stdio: "ignore" });
}

function fail(title, message) {
  console.error(`${title}：${message}`);
  notify(title, `${message}\n\n日志位置：${LOG_FILE}`, true);
  process.exit(1);
}

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
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "darwin" ? [url] : platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", (error) => appendLog(`browser open failed: ${error.message || String(error)}`));
    child.unref();
    appendLog(`browser open requested: ${url}`);
  } catch (error) {
    appendLog(`browser open failed: ${error.message || String(error)}`);
  }
}

async function waitForApp(port, timeoutMs = 7000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await requestJson(port, "/api/state");
    if (isCompatibleAppState(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function isCompatibleAppState(state) {
  return Boolean(
    state &&
      state.version === 2 &&
      Array.isArray(state.courses) &&
      state.settings &&
      state.settings.provider === "api" &&
      Object.prototype.hasOwnProperty.call(state, "apiConfigured"),
  );
}

async function findExistingApp() {
  for (const port of PORTS) {
    const state = await requestJson(port, "/api/state");
    if (isCompatibleAppState(state)) return port;
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
  appendLog(`launcher start: root=${ROOT}`);
  if (!fs.existsSync(path.join(ROOT, "server.cjs"))) {
    fail("项目文件不完整", "没有找到 server.cjs。请确认应用文件夹没有被拆开或移动。");
  }
  if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
    fail("依赖未安装", "没有找到 node_modules。请先在项目目录运行 npm install，或重新生成体验包。");
  }

  const existingPort = await findExistingApp();
  if (existingPort) {
    const url = `http://${HOST}:${existingPort}`;
    console.log(`API 课程助教已经在运行，正在打开 ${url}`);
    appendLog(`existing app found: ${url}`);
    openBrowser(url);
    return;
  }

  const port = await findFreePort();
  if (!port) {
    fail("端口不可用", "4173-4178 端口都不可用，请关闭其他本地服务后再试。");
  }

  const url = `http://${HOST}:${port}`;
  console.log(`正在启动 API 课程助教：${url}`);
  appendLog(`starting server: ${url}`);

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFd = fs.openSync(LOG_FILE, "a");
  const stdio = process.stdout.isTTY ? "inherit" : ["ignore", logFd, logFd];

  const nodeBin = findNodeBinary();
  appendLog(`using node: ${nodeBin}`);
  const child = spawn(nodeBin, ["server.cjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
      HOST,
      PORT: String(port),
      APP_LAUNCHED_BY_WRAPPER: "1",
    },
    stdio,
  });

  child.on("error", (error) => {
    fail("启动失败", error.message || String(error));
  });
  child.on("exit", (code) => {
    appendLog(`server exit: code=${code ?? 0}`);
    if (code) notify("API 课程助教已退出", `服务进程异常退出，退出码：${code}\n\n日志位置：${LOG_FILE}`, true);
    process.exit(code || 0);
  });
  const state = await waitForApp(port);
  if (!state) {
    fail("启动失败", `服务已启动但没有在 ${url} 返回可用状态。`);
  }
  appendLog(`server ready: ${url}`);
  openBrowser(url);
}

main().catch((error) => {
  fail("启动失败", error.message || String(error));
});
