const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const APP_NAME = "理工科复习台";
const APP_DIR = path.join(DIST_DIR, `${APP_NAME}.app`);
const CONTENTS_DIR = path.join(APP_DIR, "Contents");
const MACOS_DIR = path.join(CONTENTS_DIR, "MacOS");
const RESOURCES_DIR = path.join(CONTENTS_DIR, "Resources");

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>launcher</string>
  <key>CFBundleIdentifier</key>
  <string>local.stem-review.launcher</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
</dict>
</plist>
`;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

const LAUNCHER = `#!/bin/zsh
PROJECT_DIR=${shellQuote(ROOT)}
cd "$PROJECT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "未检测到 Node.js" message "请先安装 Node.js 20 或更高版本：https://nodejs.org/" as critical' >/dev/null 2>&1 || true
  exit 1
fi

exec node scripts/launch-local.cjs
`;

async function main() {
  if (process.platform !== "darwin") {
    console.error("macOS .app 只能在 macOS 上生成。");
    process.exit(1);
  }

  await fsp.rm(APP_DIR, { recursive: true, force: true });
  await fsp.mkdir(MACOS_DIR, { recursive: true });
  await fsp.mkdir(RESOURCES_DIR, { recursive: true });
  await fsp.writeFile(path.join(CONTENTS_DIR, "Info.plist"), PLIST);
  await fsp.writeFile(path.join(MACOS_DIR, "launcher"), LAUNCHER, { mode: 0o755 });
  await fsp.chmod(path.join(MACOS_DIR, "launcher"), 0o755);

  spawnSync("xattr", ["-dr", "com.apple.quarantine", APP_DIR], { stdio: "ignore" });
  console.log(`macOS 应用已生成：${APP_DIR}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
