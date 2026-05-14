const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createRuntimeRequire } = require("../lib/server/runtime-require.cjs");
const { createDbTemplate } = require("../lib/server/repository.cjs");

const ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const PACKAGE_NAME = "mechanics-review-studio-share";
const STAGING_DIR = path.join(DIST_DIR, PACKAGE_NAME);
const ZIP_PATH = path.join(DIST_DIR, `${PACKAGE_NAME}.zip`);

const FILES_TO_COPY = [
  "server.cjs",
  "package.json",
  "README.md",
  "FEATURE_SUMMARY.md",
  "scripts/launch-local.cjs",
];

const DIRS_TO_COPY = [
  "lib",
  "public",
  "samples",
];

const FRIEND_README = `# 力学复习台体验版

这是一个本地运行的复习小工具。资料、错题和设置都保存在本文件夹里的 \`data/\`，默认不会上传到外部服务。

## 启动方式

### macOS

双击 \`启动-力学复习台.command\`。如果系统提示无法打开，可以右键该文件，选择“打开”。
如果仍提示某个 \`.node\` 文件无法验证，请把整个文件夹移到“应用程序”或“桌面”后重新解压；新版体验包默认不再安装这类 PDF 渲染用的可选原生模块。

### Windows

双击 \`启动-力学复习台.bat\`。

启动后浏览器会打开：

\`\`\`text
http://127.0.0.1:4173
\`\`\`

如果 4173 端口被占用，脚本会自动尝试 4174、4175、4176、4177、4178。

## 需要的环境

电脑需要先安装 Node.js 20 或更高版本。下载地址：

https://nodejs.org/

## 数据说明

- 数据库：\`data/db.json\`
- 上传资料：\`data/uploads/\`

想重置体验数据时，关闭启动窗口后删除 \`data/db.json\` 和 \`data/uploads/\` 里的文件，再重新启动即可。
`;

const START_JS = `const http = require("node:http");
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

  const url = \`http://127.0.0.1:\${port}\`;
  const child = spawn(process.execPath, ["server.cjs"], {
    cwd: __dirname,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: "inherit",
  });

  child.on("exit", (code) => process.exit(code || 0));
  setTimeout(() => openBrowser(url), 900);
})();
`;

const START_MAC = `#!/bin/zsh
cd "$(dirname "$0")"
if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine . >/dev/null 2>&1 || true
fi
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先安装 Node.js 20 或更高版本：https://nodejs.org/"
  read "unused?按回车退出..."
  exit 1
fi
node start.js
`;

const START_WIN = `@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。请先安装 Node.js 20 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)
node start.js
pause
`;

async function removeIfExists(targetPath) {
  await fsp.rm(targetPath, { recursive: true, force: true });
}

async function copyPath(source, target) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.cp(source, target, {
    recursive: true,
    filter: (currentSource) => !currentSource.includes(`${path.sep}node_modules${path.sep}`),
  });
}

async function writeText(relativePath, content, mode) {
  const targetPath = path.join(STAGING_DIR, relativePath);
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.writeFile(targetPath, content);
  if (mode) await fsp.chmod(targetPath, mode);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} 执行失败。`);
  }
}

async function installProductionDependencies() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npmCommand, ["install", "--omit=dev", "--omit=optional", "--ignore-scripts"], STAGING_DIR);
}

async function makeZip() {
  const runtimeRequire = createRuntimeRequire(ROOT);
  const JSZip = runtimeRequire("jszip");
  const zip = new JSZip();

  async function addDirectory(directoryPath, zipPath) {
    const entries = await fsp.readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = path.join(directoryPath, entry.name);
      const nextZipPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await addDirectory(sourcePath, nextZipPath);
      } else if (entry.isFile()) {
        zip.file(`${PACKAGE_NAME}/${nextZipPath}`, await fsp.readFile(sourcePath));
      }
    }
  }

  await addDirectory(STAGING_DIR, "");
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fsp.writeFile(ZIP_PATH, buffer);
}

async function main() {
  await fsp.mkdir(DIST_DIR, { recursive: true });
  await removeIfExists(STAGING_DIR);
  await removeIfExists(ZIP_PATH);
  await fsp.mkdir(STAGING_DIR, { recursive: true });

  for (const file of FILES_TO_COPY) {
    await copyPath(path.join(ROOT, file), path.join(STAGING_DIR, file));
  }
  for (const dir of DIRS_TO_COPY) {
    if (fs.existsSync(path.join(ROOT, dir))) {
      await copyPath(path.join(ROOT, dir), path.join(STAGING_DIR, dir));
    }
  }

  await fsp.mkdir(path.join(STAGING_DIR, "data", "uploads"), { recursive: true });
  await fsp.writeFile(path.join(STAGING_DIR, "data", "db.json"), JSON.stringify(createDbTemplate(), null, 2));
  await writeText("README_FOR_FRIENDS.md", FRIEND_README);
  await writeText("start.js", START_JS);
  await writeText("启动-力学复习台.command", START_MAC, 0o755);
  await writeText("启动-力学复习台.bat", START_WIN);

  await installProductionDependencies();
  await makeZip();

  console.log(`体验包目录：${STAGING_DIR}`);
  console.log(`体验包压缩文件：${ZIP_PATH}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
