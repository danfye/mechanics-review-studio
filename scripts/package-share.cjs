const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createRuntimeRequire } = require("../lib/server/runtime-require.cjs");
const { createDbTemplate } = require("../server.cjs");
const { createMacApp } = require("./create-macos-app.cjs");

const ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const PACKAGE_NAME = "api-course-tutor-share";
const STAGING_DIR = path.join(DIST_DIR, PACKAGE_NAME);
const ZIP_PATH = path.join(DIST_DIR, `${PACKAGE_NAME}.zip`);
const APP_NAME = "API 课程助教";

const FILES_TO_COPY = [
  "server.cjs",
  "package.json",
  "README.md",
  "FEATURE_SUMMARY.md",
  "scripts/launch-local.cjs",
  "scripts/launch-web.cjs",
];

const DIRS_TO_COPY = [
  "lib",
  "public",
  "samples",
];

const FRIEND_README = `# API 课程助教体验版

这是一个本地运行、API 驱动的课程助教。没有 API 配置时不会生成教学或解题内容。

## 启动方式

### macOS

优先双击 \`API 课程助教.app\`，也可以双击 \`启动-API课程助教.command\`。如果系统提示无法打开，可以右键该文件，选择“打开”。
如果仍提示某个 \`.node\` 文件无法验证，请把整个文件夹移到“应用程序”或“桌面”后重新解压；新版体验包默认不再安装这类 PDF 渲染用的可选原生模块。

### Windows

双击 \`启动-API课程助教.bat\`。

启动后浏览器会打开：

\`\`\`text
http://127.0.0.1:4173
\`\`\`

如果 4173 端口被占用，脚本会自动尝试 4174、4175、4176、4177、4178。

## 个人网页访问

如果想在外网浏览器访问，macOS 可以双击 \`API 课程助教网页访问.app\`，也可以双击 \`网页登录-API课程助教.command\`。Windows 可以双击 \`网页登录-API课程助教.bat\`。

第一次启动会生成网页登录密码并显示在终端里；启动成功后终端会输出 Cloudflare 的 \`https://...trycloudflare.com\` 临时地址。电脑和启动窗口必须保持运行，外网网页才可以访问。

如果提示没有 \`cloudflared\`，请先安装 Cloudflare Tunnel 客户端。macOS 可运行：

\`\`\`bash
brew install cloudflared
\`\`\`

## 需要的环境

电脑需要先安装 Node.js 20 或更高版本。下载地址：

https://nodejs.org/

## 数据说明

- 数据库：\`data/db.json\`
- 上传资料：\`data/uploads/\`
- API Key：保存在用户目录 \`~/.codex/stem-review-studio/api-key.json\`，不会写进体验包项目数据库。

想重置体验数据时，关闭启动窗口后删除 \`data/db.json\`、\`data/uploads/\` 和 \`data/logs/\` 里的文件，再重新启动即可。
`;

const START_MAC = `#!/bin/zsh
cd "$(dirname "$0")"
if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine . >/dev/null 2>&1 || true
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先安装 Node.js 20 或更高版本：https://nodejs.org/"
  read "unused?按回车退出..."
  exit 1
fi
node scripts/launch-local.cjs
`;

const START_WEB_MAC = `#!/bin/zsh
cd "$(dirname "$0")"
if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine . >/dev/null 2>&1 || true
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先安装 Node.js 20 或更高版本：https://nodejs.org/"
  read "unused?按回车退出..."
  exit 1
fi
node scripts/launch-web.cjs
`;

const START_WIN = `@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。请先安装 Node.js 20 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)
node scripts\\launch-local.cjs
pause
`;

const START_WEB_WIN = `@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。请先安装 Node.js 20 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)
node scripts\\launch-web.cjs
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
        const stat = await fsp.stat(sourcePath);
        zip.file(`${PACKAGE_NAME}/${nextZipPath}`, await fsp.readFile(sourcePath), {
          unixPermissions: stat.mode & 0o777,
        });
      }
    }
  }

  await addDirectory(STAGING_DIR, "");
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", platform: "UNIX" });
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
  await writeText("启动-API课程助教.command", START_MAC, 0o755);
  await writeText("启动-API课程助教.bat", START_WIN);
  await writeText("网页登录-API课程助教.command", START_WEB_MAC, 0o755);
  await writeText("网页登录-API课程助教.bat", START_WEB_WIN);

  await installProductionDependencies();
  if (process.platform === "darwin") {
    await createMacApp({
      root: STAGING_DIR,
      distDir: STAGING_DIR,
      appName: APP_NAME,
      bundleIdentifier: "local.api-course-tutor.share.launcher",
      portable: true,
    });
    await createMacApp({
      root: STAGING_DIR,
      distDir: STAGING_DIR,
      appName: "API 课程助教网页访问",
      bundleIdentifier: "local.api-course-tutor.share.web-launcher",
      launcherCommand: "scripts/launch-web.cjs",
      terminal: true,
      portable: true,
    });
  }
  await makeZip();

  console.log(`体验包目录：${STAGING_DIR}`);
  console.log(`体验包压缩文件：${ZIP_PATH}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
