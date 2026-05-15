const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

const DEFAULT_ROOT = path.join(__dirname, "..");
const DEFAULT_DIST_DIR = path.join(DEFAULT_ROOT, "dist");
const DEFAULT_APP_NAME = "理工科复习台";

function plist(appName, bundleIdentifier) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>${appName}</string>
  <key>CFBundleExecutable</key>
  <string>launcher</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleIdentifier}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${appName}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.2.0</string>
  <key>CFBundleVersion</key>
  <string>2</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
</dict>
</plist>
`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function launcherScript(root, portable) {
  const projectDirLine = portable
    ? 'PROJECT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"'
    : `PROJECT_DIR=${shellQuote(root)}`;
  return `#!/bin/zsh
${projectDirLine}
cd "$PROJECT_DIR" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
NODE_BIN=""
for candidate in \
  "/opt/homebrew/bin/node" \
  "/usr/local/bin/node" \
  "$HOME/.nvm/current/bin/node" \
  "$HOME/.volta/bin/node" \
  "$HOME/.fnm/node-versions/current/installation/bin/node"
do
  if [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done

if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(/bin/zsh -lc 'command -v node' 2>/dev/null || true)"
fi

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  osascript -e 'display alert "未检测到 Node.js" message "请先安装 Node.js 20 或更高版本：https://nodejs.org/" as critical' >/dev/null 2>&1 || true
  exit 1
fi

exec "$NODE_BIN" scripts/launch-local.cjs
`;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function writePixel(buffer, width, x, y, color) {
  if (x < 0 || x >= width || y < 0 || y >= width) return;
  const offset = (y * width + x) * 4;
  buffer[offset] = color[0];
  buffer[offset + 1] = color[1];
  buffer[offset + 2] = color[2];
  buffer[offset + 3] = color[3];
}

function fillRect(buffer, width, x, y, rectWidth, rectHeight, color) {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let column = x; column < x + rectWidth; column += 1) {
      writePixel(buffer, width, column, row, color);
    }
  }
}

function fillRoundedRect(buffer, width, x, y, rectWidth, rectHeight, radius, color) {
  const x2 = x + rectWidth - 1;
  const y2 = y + rectHeight - 1;
  for (let row = y; row <= y2; row += 1) {
    for (let column = x; column <= x2; column += 1) {
      const cornerX = column < x + radius ? x + radius : column > x2 - radius ? x2 - radius : column;
      const cornerY = row < y + radius ? y + radius : row > y2 - radius ? y2 - radius : row;
      if ((column - cornerX) ** 2 + (row - cornerY) ** 2 <= radius ** 2) {
        writePixel(buffer, width, column, row, color);
      }
    }
  }
}

function fillCircle(buffer, width, centerX, centerY, radius, color) {
  for (let row = centerY - radius; row <= centerY + radius; row += 1) {
    for (let column = centerX - radius; column <= centerX + radius; column += 1) {
      if ((column - centerX) ** 2 + (row - centerY) ** 2 <= radius ** 2) {
        writePixel(buffer, width, column, row, color);
      }
    }
  }
}

function drawIconImage(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / 1024;
  const p = (value) => Math.round(value * scale);
  fillRoundedRect(pixels, size, p(96), p(96), p(832), p(832), p(180), [24, 102, 120, 255]);
  fillRoundedRect(pixels, size, p(150), p(136), p(724), p(752), p(130), [246, 250, 247, 255]);
  fillRoundedRect(pixels, size, p(220), p(218), p(584), p(84), p(30), [38, 126, 150, 255]);
  fillRect(pixels, size, p(270), p(382), p(484), p(34), [62, 91, 98, 255]);
  fillRect(pixels, size, p(270), p(482), p(340), p(34), [62, 91, 98, 255]);
  fillRect(pixels, size, p(270), p(582), p(484), p(34), [62, 91, 98, 255]);
  fillCircle(pixels, size, p(760), p(624), p(106), [231, 120, 67, 255]);
  fillRect(pixels, size, p(710), p(610), p(100), p(28), [255, 255, 255, 255]);
  fillRect(pixels, size, p(746), p(574), p(28), p(100), [255, 255, 255, 255]);
  return pixels;
}

function pngBuffer(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const pixels = drawIconImage(size);
  const rows = [];
  for (let row = 0; row < size; row += 1) {
    rows.push(Buffer.from([0]));
    rows.push(pixels.subarray(row * size * 4, (row + 1) * size * 4));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function makeIcon(resourcesDir) {
  const iconsetDir = path.join(resourcesDir, "AppIcon.iconset");
  await fsp.rm(iconsetDir, { recursive: true, force: true });
  await fsp.mkdir(iconsetDir, { recursive: true });

  const sizes = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];

  for (const [fileName, size] of sizes) {
    await fsp.writeFile(path.join(iconsetDir, fileName), pngBuffer(size));
  }

  const result = spawnSync("iconutil", ["-c", "icns", iconsetDir, "-o", path.join(resourcesDir, "AppIcon.icns")], {
    stdio: "ignore",
  });
  await fsp.rm(iconsetDir, { recursive: true, force: true });
  if (result.status !== 0) {
    throw new Error("生成 macOS 图标失败：未能调用 iconutil。");
  }
}

async function createMacApp(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  const distDir = path.resolve(options.distDir || DEFAULT_DIST_DIR);
  const appName = options.appName || DEFAULT_APP_NAME;
  const bundleIdentifier = options.bundleIdentifier || "local.stem-review.launcher";
  const portable = Boolean(options.portable);
  const appDir = path.join(distDir, `${appName}.app`);
  const contentsDir = path.join(appDir, "Contents");
  const macosDir = path.join(contentsDir, "MacOS");
  const resourcesDir = path.join(contentsDir, "Resources");

  await fsp.rm(appDir, { recursive: true, force: true });
  await fsp.mkdir(macosDir, { recursive: true });
  await fsp.mkdir(resourcesDir, { recursive: true });
  await fsp.writeFile(path.join(contentsDir, "Info.plist"), plist(appName, bundleIdentifier));
  await fsp.writeFile(path.join(macosDir, "launcher"), launcherScript(root, portable), { mode: 0o755 });
  await fsp.chmod(path.join(macosDir, "launcher"), 0o755);
  await makeIcon(resourcesDir);

  spawnSync("xattr", ["-dr", "com.apple.quarantine", appDir], { stdio: "ignore" });
  return appDir;
}

async function main() {
  if (process.platform !== "darwin") {
    console.error("macOS .app 只能在 macOS 上生成。");
    process.exit(1);
  }

  const appDir = await createMacApp();
  console.log(`macOS 应用已生成：${appDir}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { createMacApp };
