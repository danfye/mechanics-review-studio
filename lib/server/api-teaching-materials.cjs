const nodePath = require("node:path");

function createApiTeachingMaterials({
  fsp,
  path = nodePath,
  runtimeRequire,
  storedUploadPath,
  makeUnitSourceRef,
  cleanApiSourceRefs,
  clampText,
  buildApiStudyContext,
  truncateForModel,
  imageMaxBytes = 4 * 1024 * 1024,
  imageInputLimit = 4,
}) {
  function canUseVisualDoc(doc = {}) {
    const type = String(doc.type || path.extname(doc.originalName || "").replace(".", "")).toLowerCase();
    const mimeType = String(doc.mimeType || "").toLowerCase();
    return ["png", "jpg", "jpeg", "webp"].includes(type) || /^image\/(?:png|jpe?g|webp)$/.test(mimeType);
  }

  async function imageInputForDoc(doc = {}) {
    if (!canUseVisualDoc(doc) || !doc.storedName) return null;
    if (Number(doc.size || 0) > imageMaxBytes) return skippedImage(doc, `图片超过 ${Math.round(imageMaxBytes / 1024 / 1024)}MB，已改用文本证据。`);
    try {
      const buffer = await fsp.readFile(storedUploadPath(doc.storedName));
      if (buffer.length > imageMaxBytes) return skippedImage(doc, `图片超过 ${Math.round(imageMaxBytes / 1024 / 1024)}MB，已改用文本证据。`);
      const ext = String(doc.type || path.extname(doc.originalName || "").replace(".", "")).toLowerCase();
      const mimeType = doc.mimeType || (ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png");
      return {
        name: doc.originalName || "图片资料",
        image_url: `data:${mimeType};base64,${buffer.toString("base64")}`,
      };
    } catch (error) {
      return skippedImage(doc, `无法读取图片原文件：${error.message}`);
    }
  }

  async function pptxImageInputsForDoc(doc = {}, limit = imageInputLimit) {
    if (String(doc.type || "").toLowerCase() !== "pptx" || !doc.storedName || limit <= 0) return [];
    try {
      const JSZip = runtimeRequire("jszip");
      const buffer = await fsp.readFile(storedUploadPath(doc.storedName));
      const zip = await JSZip.loadAsync(buffer);
      const imageUnits = (doc.units || []).filter((unit) => unit.imageRefs?.length);
      const inputs = [];
      for (const unit of imageUnits) {
        for (const imageRef of unit.imageRefs || []) {
          if (inputs.length >= limit) return inputs;
          const mediaFile = zip.file(imageRef.path);
          if (!mediaFile) continue;
          const imageBuffer = await mediaFile.async("nodebuffer");
          if (!imageBuffer.length || imageBuffer.length > imageMaxBytes) continue;
          inputs.push({
            name: `${doc.originalName || "PPTX"} / ${unit.label || "幻灯片"} / ${imageRef.name || "图片"}`,
            image_url: `data:${pptxImageMimeType(imageRef.name || imageRef.path)};base64,${imageBuffer.toString("base64")}`,
          });
        }
      }
      return inputs;
    } catch {
      return [];
    }
  }

  async function buildTeachingMaterials(courseModel = {}, docs = [], options = {}) {
    const imageLimit = Math.min(Number(options.imageLimit || imageInputLimit), imageInputLimit);
    const imageInputs = [];
    const imageWarnings = [];
    for (const doc of docs) {
      if (imageInputs.length >= imageLimit) break;
      const input = await imageInputForDoc(doc);
      if (!input) continue;
      if (input.skipped) {
        imageWarnings.push(`${input.name}：${input.reason}`);
        continue;
      }
      imageInputs.push(input);
    }
    if (imageInputs.length < imageLimit) {
      for (const doc of docs) {
        if (imageInputs.length >= imageLimit) break;
        imageInputs.push(...(await pptxImageInputsForDoc(doc, imageLimit - imageInputs.length)));
      }
    }

    const lowQualityDocs = (courseModel.documents || [])
      .filter((doc) => doc.parse_quality?.level === "weak" || Number(doc.parse_quality?.score || 0) < 45)
      .map((doc) => `${doc.file_name || "资料"}：${doc.parse_quality?.warnings?.join("；") || "可抽取文本较少"}`)
      .slice(0, 6);
    const extractedText = docs.map((doc) => extractedDocText(doc, options)).filter(Boolean).join("\n\n");
    return {
      imageInputs,
      imageWarnings,
      text: truncateForModel(
        [
          "## 结构化高价值证据",
          buildApiStudyContext(courseModel, docs, {
            conceptLimit: options.conceptLimit ?? 16,
            formulaLimit: options.formulaLimit ?? 14,
            problemLimit: options.problemLimit ?? 12,
            mistakeLimit: options.mistakeLimit ?? 10,
            evidence: options.evidenceLimit ?? 10,
            maxChars: options.contextChars || 22000,
          }),
          lowQualityDocs.length ? `## 解析质量提醒\n${lowQualityDocs.map((item) => `- ${item}`).join("\n")}` : "",
          imageWarnings.length ? `## 图片直传提醒\n${imageWarnings.map((item) => `- ${item}`).join("\n")}` : "",
          extractedText ? `## 抽取文本片段\n${extractedText}` : "",
        ].filter(Boolean).join("\n\n"),
        options.maxChars || 36000,
      ),
    };
  }

  function extractedDocText(doc, options = {}) {
    return (doc.units?.length ? doc.units : [{ label: "全文", text: doc.text || "" }])
      .filter((unit) => String(unit.text || "").trim())
      .slice(0, options.unitsPerDoc || 8)
      .map((unit, indexValue) => {
        const ref = makeUnitSourceRef(doc, unit, indexValue, unit.text || "", "medium");
        return [
          `### ${doc.originalName || "资料"} / ${unit.label || "全文"}`,
          `source_ref=${JSON.stringify(cleanApiSourceRefs([ref], 1)[0])}`,
          clampText(unit.text || "", options.unitChars || 900),
        ].join("\n");
      })
      .join("\n\n");
  }

  function teachingUserContent(intro, materials, tail = "") {
    const content = [{ type: "text", text: [intro, materials.text, tail].filter(Boolean).join("\n\n") }];
    for (const image of materials.imageInputs || []) {
      content.push({ type: "text", text: `图片资料：${image.name}。请直接阅读图片中的公式、图示、题干和标注；不要依赖本地 OCR。` });
      content.push({ type: "image_url", image_url: { url: image.image_url } });
    }
    return content;
  }

  function pptxImageMimeType(name = "") {
    const ext = path.extname(name).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    return "image/png";
  }

  function skippedImage(doc, reason) {
    return { skipped: true, name: doc.originalName || "图片资料", reason };
  }

  return {
    buildTeachingMaterials,
    canUseVisualDoc,
    teachingUserContent,
  };
}

module.exports = {
  createApiTeachingMaterials,
};
