const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { ensureWebAuthConfig, defaultWebAuthPath, passwordFromEnv } = require("../lib/server/web-auth-config.cjs");

const HOST = "127.0.0.1";
const PORTS = [4173, 4174, 4175, 4176, 4177, 4178];
const RUNTIME_DIR = path.join(os.tmpdir(), "api-course-tutor-web");
const STATE_PATH = path.join(RUNTIME_DIR, "state.json");
const LOCK_PATH = path.join(RUNTIME_DIR, "launch.lock");

function commandExists(command) {
  const result = spawnSync("/bin/zsh", ["-lc", `command -v ${command}`], { stdio: "ignore" });
  return result.status === 0;
}

function alertMac(title, message) {
  if (process.platform !== "darwin") return;
  spawnSync("osascript", ["-e", `display alert ${JSON.stringify(title)} message ${JSON.stringify(message)} as critical`], { stdio: "ignore" });
}

function openBrowser(url) {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "darwin" ? [url] : platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch (error) {
    console.error(`打开浏览器失败：${error.message || error}`);
  }
}

async function readRuntimeState() {
  try {
    return JSON.parse(await fsp.readFile(STATE_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function writeRuntimeState(state) {
  await fsp.mkdir(RUNTIME_DIR, { recursive: true });
  await fsp.writeFile(STATE_PATH, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
}

async function removeRuntimeState() {
  await fsp.rm(STATE_PATH, { force: true });
}

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock() {
  await fsp.mkdir(RUNTIME_DIR, { recursive: true });
  try {
    const handle = await fsp.open(LOCK_PATH, "wx");
    await handle.writeFile(String(process.pid));
    await handle.close();
    return true;
  } catch {
    try {
      const lockedPid = Number((await fsp.readFile(LOCK_PATH, "utf8")).trim());
      if (!processAlive(lockedPid)) {
        await fsp.rm(LOCK_PATH, { force: true });
        return acquireLock();
      }
    } catch {
      await fsp.rm(LOCK_PATH, { force: true }).catch(() => {});
      return acquireLock();
    }
    return false;
  }
}

async function releaseLock() {
  try {
    if (fs.existsSync(LOCK_PATH) && fs.readFileSync(LOCK_PATH, "utf8").trim() === String(process.pid)) {
      await fsp.rm(LOCK_PATH, { force: true });
    }
  } catch {
    // Best effort only.
  }
}

async function tryReuseRunningTunnel() {
  const state = await readRuntimeState();
  if (!state?.url || !processAlive(state.launcherPid)) return false;
  console.log(`检测到网页访问正在运行：${state.url}`);
  if (!(await waitForPublicUrl(state.url, { quiet: true, timeoutMs: 12000 }))) {
    console.log("已有外网地址暂时不可访问，将重新创建 Tunnel。");
    return false;
  }
  console.log(`网页访问已经可用：${state.url}`);
  openBrowser(state.url);
  return true;
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, HOST);
  });
}

function requestUrl(baseUrl, pathname, { timeoutMs = 800 } = {}) {
  const client = baseUrl.startsWith("https:") ? require("node:https") : require("node:http");
  return new Promise((resolve, reject) => {
    const req = client.get(`${baseUrl}${pathname}`, { timeout: timeoutMs }, (response) => {
      response.resume();
      response.on("end", () => resolve({ status: response.statusCode }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

async function waitForPublicUrl(url, { quiet = false, timeoutMs = 30000 } = {}) {
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    try {
      const response = await requestUrl(url, "/login", { timeoutMs: 5000 });
      if (response.status === 200) return true;
      if (!quiet) console.log(`外网地址还未就绪：HTTP ${response.status}，继续等待...`);
    } catch (error) {
      if (!quiet && (attempt === 1 || attempt % 3 === 0)) {
        console.log(`外网地址还未就绪：${error.message || "连接失败"}，继续等待...`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

function requestJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port, path: pathname, timeout: 800 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch {
          resolve({ status: response.statusCode, data: null });
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

async function findPort() {
  for (const port of PORTS) {
    if (await portFree(port)) return port;
  }
  throw new Error(`端口 ${PORTS.join(", ")} 都被占用。`);
}

async function waitForServer(port) {
  const deadline = Date.now() + 12000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await requestJson(port, "/auth/status");
      if (response.status === 200 && response.data?.enabled) return;
      lastError = new Error(`unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw lastError || new Error("服务启动超时。");
}

function startServer(port) {
  return spawn(process.execPath, ["server.cjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST,
      PORT: String(port),
      API_COURSE_TUTOR_AUTH_REQUIRED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function startCloudflared(port) {
  const child = spawn("cloudflared", ["tunnel", "--url", `http://${HOST}:${port}`], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}

function pipeOutput(child, label, onUrl) {
  const handle = (chunk) => {
    const text = chunk.toString();
    const match = text.match(/https:\/\/[-a-zA-Z0-9.]+\.trycloudflare\.com/);
    if (match) {
      const url = match[0];
      console.log("");
      console.log(`外网 HTTPS 地址：${url}`);
      console.log("正在确认外网地址可访问，稍后自动打开浏览器。关闭本窗口后网页会停止访问。");
      console.log("");
      writeRuntimeState({ launcherPid: process.pid, tunnelPid: child.pid, appPid: activeServerPid, url }).catch(() => {});
      waitForPublicUrl(url).then((ready) => {
        if (!ready) {
          console.error("外网地址长时间未就绪。请稍后重新双击网页访问图标。");
          return;
        }
        console.log(`外网地址已可访问：${url}`);
        openBrowser(url);
      });
      if (onUrl) onUrl(url);
    }
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      console.log(`[${label}] ${line}`);
    }
  };
  child.stdout?.on("data", handle);
  child.stderr?.on("data", handle);
}

function stopAll(children) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

let activeServerPid = null;

async function main() {
  if (await tryReuseRunningTunnel()) return;
  const locked = await acquireLock();
  if (!locked) {
    console.log("网页访问正在启动中，请稍等几秒。");
    await new Promise((resolve) => setTimeout(resolve, 2500));
    if (await tryReuseRunningTunnel()) return;
    console.log("没有找到已启动的网页地址，将继续尝试新启动。");
  }

  const auth = await ensureWebAuthConfig({ filePath: defaultWebAuthPath() });
  if (auth.created) {
    console.log(`网页登录密码已保存到：${auth.filePath}`);
    console.log(`本次网页登录密码：${auth.password}`);
  } else {
    console.log(`使用已有网页登录配置：${auth.filePath}`);
  }
  if (passwordFromEnv()) console.log("已使用环境变量中的网页登录密码更新本机配置。");

  if (!commandExists("cloudflared")) {
    const message = [
      "未找到 Cloudflare Tunnel 客户端 cloudflared。",
      "",
      "请先安装：",
      "  brew install cloudflared",
      "",
      "安装后再运行 npm run web，或重新双击“API 课程助教网页访问.app”。",
    ].join("\n");
    console.error(message);
    alertMac("未找到 cloudflared", "请先在终端运行：brew install cloudflared\n\n安装后重新打开网页访问图标。");
    process.exit(1);
  }

  const port = await findPort();
  const children = [];
  const server = startServer(port);
  activeServerPid = server.pid;
  children.push(server);
  pipeOutput(server, "app");
  server.once("exit", (code) => {
    if (code !== 0) console.error(`应用服务已退出，状态码：${code}`);
  });
  await waitForServer(port);
  console.log(`本机服务：http://${HOST}:${port}`);

  let attempts = 0;
  const startTunnelWithRetry = () => {
    attempts += 1;
    let tunnelReady = false;
    console.log(`正在创建 Cloudflare Tunnel...（第 ${attempts} 次）`);
    const tunnel = startCloudflared(port);
    children.push(tunnel);
    tunnel.once("error", (error) => {
      console.error(error.message || error);
    });
    tunnel.once("exit", (code) => {
      if (tunnelReady || code === 0 || code === null) return;
      if (attempts < 4) {
        console.error(`Cloudflare Tunnel 创建失败，状态码：${code}。3 秒后重试。`);
        setTimeout(startTunnelWithRetry, 3000);
        return;
      }
      console.error(`Cloudflare Tunnel 连续创建失败，状态码：${code}。请稍后重新双击网页访问图标。`);
      stopAll(children);
      process.exit(code || 1);
    });
    pipeOutput(tunnel, "cloudflared", () => {
      tunnelReady = true;
    });
  };
  startTunnelWithRetry();

  process.on("SIGINT", () => {
    removeRuntimeState().catch(() => {});
    releaseLock().catch(() => {});
    stopAll(children);
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    removeRuntimeState().catch(() => {});
    releaseLock().catch(() => {});
    stopAll(children);
    process.exit(0);
  });

  process.on("exit", () => {
    try {
      if (fs.existsSync(LOCK_PATH) && fs.readFileSync(LOCK_PATH, "utf8").trim() === String(process.pid)) {
        fs.rmSync(LOCK_PATH, { force: true });
      }
    } catch {
      // Best effort only.
    }
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
