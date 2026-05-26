const path = require("node:path");
const { assistantSkillIds, getAssistantSkill } = require("./assistant-skills.cjs");

function createAssistantService({ fsp, uploadPath, callChatApi, runtimeRequire = require }) {
  const supportedIntents = assistantSkillIds();
  let pdfjsPromise = null;

  function apiReady(settings = {}) {
    return Boolean(settings.apiBaseUrl && settings.apiKey && settings.model);
  }

  function assertApiReady(settings = {}) {
    if (!apiReady(settings)) {
      const missing = [];
      if (!settings.apiBaseUrl) missing.push("API Base URL");
      if (!settings.model) missing.push("模型");
      if (!settings.apiKey) missing.push("API Key");
      throw new Error(`API 助教需要完整配置，当前缺少：${missing.join("、")}。请先到设置页完成连接测试。`);
    }
  }

  function inferIntent(input = {}) {
    const explicit = String(input.intent || "").trim();
    if (supportedIntents.includes(explicit)) return explicit;
    const text = String(input.message || "");
    if (/期末|复习|冲刺|计划|重点|薄弱|考前/.test(text)) return "final_review";
    if (/解题|作业|题目|答案|求解|怎么算|如图|证明/.test(text)) return "solve_homework";
    return "teach_materials";
  }

  function intentLabel(intent) {
    return getAssistantSkill(intent).label;
  }

  function skillPromptBlock(skill) {
    return `当前 skill：
- id: ${skill.id}
- label: ${skill.label}
- 输出重点：${skill.outputFocus.join("；")}
- 期望 artifacts 类型：${skill.artifactTypes.join("、")}
- source_refs 要求：${skill.sourceRefs.policy}`;
  }

  function systemPrompt(skill) {
    return `你是一个 API 必需的理工科课程助教。你只服务三个目标：读懂课件并从 0 教会学生、解析作业图片/PDF/题目资料并作答、基于学生上传资料做期末复习。

通用要求：
- 全程中文，面向工科/力学期末复习，语言像认真板书的老师。
- 不要说“本地 OCR 不足”“无法读取图片/PDF”作为托辞；如果消息里有图片、PDF 页或 PPT 内嵌图，要直接阅读视觉信息。
- 公式使用类 LaTeX，例如 $\\sigma = \\frac{F_N}{A}$。
- 必须尽量绑定资料来源，使用 source_refs 中提供的 document_id、unit_index、unit_label。
- 不要大段复制原文，要重组为教学、解题或复习资产。

${skillPromptBlock(skill)}

只输出 JSON 对象，不要输出 Markdown 代码块。格式：
{
  "title": string,
  "answer_markdown": string,
  "source_refs": [{"document_id": string, "file_name": string, "unit_index": number, "unit_label": string, "excerpt": string}],
  "artifacts": [{"type": "lesson|solution|review_plan|drill_set|memory_card", "title": string, "body": string, "items": string[]}],
  "next_actions": string[]
}`;
  }

  function materialEvidence(materials = []) {
    return materials
      .map((material) => {
        const units = (material.units || []).slice(0, 10).map((unit, index) => ({
          document_id: material.id,
          file_name: material.originalName,
          unit_index: index,
          unit_label: unit.label || `片段 ${index + 1}`,
          excerpt: String(unit.text || "").slice(0, 900),
        }));
        return {
          id: material.id,
          file_name: material.originalName,
          kind: material.kind,
          warning: material.warning || "",
          text_length: String(material.text || "").length,
          units,
        };
      });
  }

  function historyEvidence(messages = [], artifacts = []) {
    return {
      recent_messages: messages.slice(-8).map((message) => ({
        role: message.role,
        intent: message.intent || "",
        text: String(message.text || "").slice(0, 900),
      })),
      saved_artifacts: artifacts.slice(-20).map((artifact) => ({
        type: artifact.type,
        title: artifact.title,
        body: String(artifact.body || "").slice(0, 700),
        items: (artifact.items || []).slice(0, 8),
      })),
    };
  }

  async function imageContentForMaterial(material) {
    if (material.kind !== "image" || !material.storedName) return [];
    const buffer = await fsp.readFile(uploadPath(material.storedName));
    const mime = material.mimeType || imageMimeType(material.originalName);
    return [
      { type: "text", text: `视觉资料：${material.originalName}。请直接阅读图片中的公式、图示、题干、标注和手写内容。` },
      { type: "image_url", image_url: { url: `data:${mime};base64,${buffer.toString("base64")}` } },
    ];
  }

  async function visualContentForMaterial(material, skill) {
    if (material.kind === "image") return imageContentForMaterial(material);
    if (material.kind === "pdf" && skill.id === "solve_homework") return pdfPageContentForMaterial(material);
    return [];
  }

  async function pdfPageContentForMaterial(material) {
    const pageImages = material.storedName ? await renderPdfPageImages(material).catch(() => []) : [];
    if (!pageImages.length) {
      const unitLabels = (material.units || []).slice(0, 6).map((unit) => unit.label).filter(Boolean).join("、");
      return [
        {
          type: "text",
          text: `PDF 作业资料：${material.originalName}。已抽取 ${material.units?.length || 0} 个文本页${unitLabels ? `（${unitLabels}）` : ""}，请优先根据结构化上下文中的 PDF 分页文本解题。`,
        },
      ];
    }
    return [
      {
        type: "text",
        text: `PDF 作业资料：${material.originalName}。下面是前 ${pageImages.length} 页渲染图，请直接阅读题干、公式、图示和标注，并结合结构化上下文中的 PDF 分页文本作答。`,
      },
      ...pageImages.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
    ];
  }

  async function renderPdfPageImages(material, maxPages = 3) {
    if (!material.storedName) return [];
    const Canvas = optionalCanvas();
    if (!Canvas) return [];
    const pdfjs = await getPdfJs();
    const buffer = await fsp.readFile(uploadPath(material.storedName));
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
    const images = [];
    for (let index = 1; index <= Math.min(doc.numPages, maxPages); index += 1) {
      const page = await doc.getPage(index);
      const viewport = page.getViewport({ scale: pdfRenderScale(page) });
      const canvas = Canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvasContext: context, viewport }).promise;
      images.push({ page: index, dataUrl: canvas.toDataURL("image/png") });
    }
    return images;
  }

  function pdfRenderScale(page) {
    const baseViewport = page.getViewport({ scale: 1 });
    const longestSide = Math.max(baseViewport.width, baseViewport.height);
    if (!longestSide) return 1.25;
    return Math.min(2, Math.max(1, 1400 / longestSide));
  }

  function optionalCanvas() {
    try {
      return runtimeRequire("@napi-rs/canvas");
    } catch {
      return null;
    }
  }

  async function getPdfJs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import(runtimeRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
    }
    return pdfjsPromise;
  }

  function imageMimeType(name = "") {
    const ext = path.extname(name).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    return "image/png";
  }

  async function buildUserContent({ course, skill, message, materials, messages, artifacts }) {
    const evidence = {
      course: { id: course.id, name: course.name },
      intent: skill.id,
      skill: {
        id: skill.id,
        label: skill.label,
        expected_artifact_types: skill.artifactTypes,
        source_refs_required: skill.sourceRefs.required,
        harness: skill.harness,
      },
      current_user_message: message,
      materials: materialEvidence(materials),
      history: historyEvidence(messages, artifacts),
    };
    const content = [
      {
        type: "text",
        text: `请按 skill “${skill.label}”处理。本轮上下文已由应用筛选；如果用户拖入了指定资料，只使用这些资料，否则使用当前科目全部资料。\n\n结构化上下文：\n${JSON.stringify(evidence, null, 2)}`,
      },
    ];
    for (const material of materials.slice(0, 8)) {
      content.push(...(await visualContentForMaterial(material, skill)));
    }
    return content;
  }

  function parseJsonFromModel(content) {
    const text = String(content || "").trim();
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const direct = fenced ? fenced[1].trim() : text;
    try {
      return JSON.parse(direct);
    } catch {
      const start = direct.indexOf("{");
      const end = direct.lastIndexOf("}");
      if (start >= 0 && end > start) return JSON.parse(direct.slice(start, end + 1));
      throw new Error("API 返回内容不是可解析的 JSON。");
    }
  }

  function normalizeAssistantResult(raw = {}, fallbackTitle = "助教回答") {
    const artifacts = Array.isArray(raw.artifacts) ? raw.artifacts : [];
    const answerMarkdown = String(raw.answer_markdown || raw.answerMarkdown || raw.answer || "").trim();
    const sourceRefs = normalizeSourceRefs(raw.source_refs || raw.sourceRefs);
    const nextActions = Array.isArray(raw.next_actions || raw.nextActions)
      ? (raw.next_actions || raw.nextActions).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6)
      : [];
    const normalizedArtifacts = artifacts
      .map((artifact) => ({
        type: normalizeArtifactType(artifact.type),
        title: String(artifact.title || "复习资产").trim(),
        body: String(artifact.body || "").trim(),
        items: Array.isArray(artifact.items) ? artifact.items.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 16) : [],
      }))
      .filter((artifact) => artifact.title || artifact.body || artifact.items.length)
      .slice(0, 12);
    return {
      title: String(raw.title || fallbackTitle).trim() || fallbackTitle,
      answer_markdown: answerMarkdown,
      answerMarkdown,
      source_refs: sourceRefs,
      sourceRefs,
      artifacts: normalizedArtifacts,
      next_actions: nextActions,
      nextActions,
    };
  }

  function normalizeArtifactType(type) {
    const value = String(type || "").trim();
    return ["lesson", "solution", "review_plan", "drill_set", "memory_card"].includes(value) ? value : "memory_card";
  }

  function normalizeSourceRefs(sourceRefs = []) {
    return (Array.isArray(sourceRefs) ? sourceRefs : [])
      .map((ref) => ({
        document_id: String(ref?.document_id || ref?.documentId || "").trim(),
        file_name: String(ref?.file_name || ref?.fileName || "").trim(),
        unit_index: Number.isInteger(Number(ref?.unit_index ?? ref?.unitIndex)) ? Number(ref?.unit_index ?? ref?.unitIndex) : undefined,
        unit_label: String(ref?.unit_label || ref?.unitLabel || "").trim(),
        excerpt: String(ref?.excerpt || "").trim().slice(0, 260),
      }))
      .filter((ref) => ref.document_id || ref.file_name || ref.excerpt)
      .slice(0, 10);
  }

  async function runAssistant({ settings, course, message, intent, materials, messages, artifacts }) {
    assertApiReady(settings);
    const resolvedIntent = inferIntent({ intent, message });
    const skill = getAssistantSkill(resolvedIntent);
    const raw = await callChatApi(
      settings,
      [
        { role: "system", content: systemPrompt(skill) },
        {
          role: "user",
          content: await buildUserContent({
            course,
            skill,
            message,
            materials,
            messages,
            artifacts,
          }),
        },
      ],
      { type: "json_object" },
      { timeoutMs: 120000, temperature: 0.15, cache: false },
    );
    return {
      intent: resolvedIntent,
      ...normalizeAssistantResult(parseJsonFromModel(raw), intentLabel(resolvedIntent)),
    };
  }

  return {
    apiReady,
    assertApiReady,
    getSkill: getAssistantSkill,
    inferIntent,
    runAssistant,
  };
}

module.exports = {
  assistantSkillIds,
  createAssistantService,
  getAssistantSkill,
};
