const http = require("node:http");
const { spawn } = require("node:child_process");

const ports = [4173, 4174, 4175, 4176, 4177, 4178];

function probe(port) {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/", timeout: 400 }, (response) => {
      response.resume();
      resolve(false);
    });
    request.on("error", () => resolve(true));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

function openBrowser(url) {
  const platform = process.platform;
  if (platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  else if (platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

(async () => {
  const port = (await Promise.all(ports.map(async (item) => ((await probe(item)) ? item : null)))).find(Boolean);
  if (!port) {
    console.error("4173-4178 端口都不可用，请关闭其他本地服务后再试。");
    process.exit(1);
  }

  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.cjs"], {
    cwd: __dirname,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: "inherit",
  });

  child.on("exit", (code) => process.exit(code || 0));
  setTimeout(() => openBrowser(url), 900);
})();
