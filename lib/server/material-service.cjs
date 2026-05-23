const path = require("node:path");

function createMaterialService({ fsp, runtimeRequire, uploadDir }) {
  let pdfjsPromise = null;

  function safeFileName(name) {
    const ext = path.extname(name || "").toLowerCase();
    const base = path.basename(name || "upload", ext);
    const cleaned = base
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90);
    return `${cleaned || "upload"}${ext}`;
  }

  function materialKind(originalName = "", mimeType = "") {
    const ext = path.extname(originalName).toLowerCase();
    const mime = String(mimeType || "").toLowerCase();
    if (ext === ".pptx") return "pptx";
    if (ext === ".pdf") return "pdf";
    if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext) || /^image\/(?:png|jpe?g|webp)$/.test(mime)) return "image";
    if (ext === ".txt" || ext === ".md" || mime.startsWith("text/")) return "text";
    return "file";
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u0000/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function splitTextUnits(textValue) {
    const text = normalizeText(textValue);
    if (!text) return [];
    const chunks = text.split(/\n\s*\n/).map(normalizeText).filter(Boolean);
    if (chunks.length > 1) {
      return chunks.slice(0, 80).map((chunk, index) => ({
        label: `片段 ${index + 1}`,
        text: chunk,
      }));
    }
    return [{ label: "全文", text }];
  }

  function decodeXml(value) {
    return String(value || "")
      .replace(/_x000D_/g, "\n")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function slideNumber(name) {
    return Number(/slide(\d+)\.xml$/i.exec(name)?.[1] || 0);
  }

  function extractSlideText(xml) {
    const texts = [];
    for (const match of String(xml || "").matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)) {
      const text = decodeXml(match[1]);
      if (text) texts.push(text);
    }
    for (const match of String(xml || "").matchAll(/\b(?:descr|title)="([^"]+)"/g)) {
      const text = decodeXml(match[1]);
      if (text && !/^Picture\s+\d+$/i.test(text)) texts.push(text);
    }
    return normalizeText([...new Set(texts)].join("\n"));
  }

  function normalizePptxRelTarget(baseDir, target) {
    return path.posix.normalize(path.posix.join(baseDir, target)).replace(/^\/+/, "");
  }

  async function pptxImageRefs(zip, slideFileName) {
    const number = slideNumber(slideFileName);
    const relFile = zip.file(`ppt/slides/_rels/slide${number}.xml.rels`);
    if (!relFile) return [];
    const relXml = await relFile.async("text");
    const refs = [];
    for (const match of relXml.matchAll(/<Relationship\b[^>]*Type="[^"]*\/image"[^>]*Target="([^"]+)"/gi)) {
      const target = decodeXml(match[1] || "");
      const mediaPath = normalizePptxRelTarget("ppt/slides", target);
      if (zip.file(mediaPath)) refs.push({ path: mediaPath, name: path.basename(mediaPath) });
    }
    return refs;
  }

  async function extractPptx(buffer) {
    const JSZip = runtimeRequire("jszip");
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = zip.file(/^ppt\/slides\/slide\d+\.xml$/).sort((a, b) => slideNumber(a.name) - slideNumber(b.name));
    const units = [];
    for (const file of slideFiles) {
      const number = slideNumber(file.name);
      const text = extractSlideText(await file.async("text"));
      const imageRefs = await pptxImageRefs(zip, file.name);
      if (text || imageRefs.length) {
        units.push({
          label: `第 ${number} 页`,
          text,
          imageRefs,
          imageCount: imageRefs.length,
        });
      }
    }
    return {
      text: normalizeText(units.map((unit) => `## ${unit.label}\n${unit.text}`).join("\n\n")),
      units,
      warning: units.length ? "" : "PPTX 未抽取到可读文本，将主要依赖 API 视觉/附件能力。",
    };
  }

  async function getPdfJs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import(runtimeRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
    }
    return pdfjsPromise;
  }

  async function extractPdf(buffer) {
    const pdfjs = await getPdfJs();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      disableFontFace: true,
      isEvalSupported: false,
      isImageDecoderSupported: false,
      isOffscreenCanvasSupported: false,
      useSystemFonts: false,
      verbosity: pdfjs.VerbosityLevel?.ERRORS ?? 0,
    }).promise;
    const units = [];
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index);
      const content = await page.getTextContent();
      const text = normalizeText(content.items.map((item) => item.str || "").join(" "));
      if (text) units.push({ label: `第 ${index} 页`, text });
    }
    return {
      text: normalizeText(units.map((unit) => `## ${unit.label}\n${unit.text}`).join("\n\n")),
      units,
      warning: units.length ? "" : "PDF 未抽取到可读文本，若是扫描件将依赖 API 视觉能力。",
    };
  }

  async function extractMaterial(buffer, originalName, mimeType = "") {
    const kind = materialKind(originalName, mimeType);
    if (kind === "pptx") return { kind, ...(await extractPptx(buffer)) };
    if (kind === "pdf") return { kind, ...(await extractPdf(buffer)) };
    if (kind === "text") {
      const text = normalizeText(buffer.toString("utf8"));
      return { kind, text, units: splitTextUnits(text), warning: "" };
    }
    if (kind === "image") {
      return { kind, text: "", units: [], warning: "图片已保存。解题或教学时会作为视觉输入交给 API 读取。" };
    }
    return { kind, text: "", units: [], warning: "暂不支持该文件类型的本地文本解析，但原文件已保存。" };
  }

  async function saveUploadedFile(file) {
    const originalName = file.filename || "upload";
    const storedName = `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeFileName(originalName)}`;
    await fsp.mkdir(uploadDir, { recursive: true });
    await fsp.writeFile(path.join(uploadDir, storedName), file.data);
    return storedName;
  }

  function uploadPath(storedName) {
    const filePath = path.normalize(path.join(uploadDir, storedName || ""));
    const relative = path.relative(uploadDir, filePath);
    if (!storedName || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("文件路径无效。");
    return filePath;
  }

  return {
    extractMaterial,
    materialKind,
    saveUploadedFile,
    uploadPath,
  };
}

module.exports = {
  createMaterialService,
};
