const path = require("node:path");
const { assistantSkillIds, getAssistantSkill } = require("./assistant-skills.cjs");

function createAssistantService({ fsp, uploadPath, callChatApi, runtimeRequire = require }) {
  const supportedIntents = assistantSkillIds();
  let pdfjsPromise = null;
  const DOMAIN_TERMS = [
    "轴向拉压", "截面法", "轴力", "轴力图", "正应力", "胡克定律", "扭转", "扭矩图", "弯曲", "弯矩图", "剪力图", "危险截面",
    "材料力学", "理论力学", "结构力学", "弹性力学", "流体力学", "高等数学", "大学物理", "化学", "生物学",
    "期末", "复习", "重点", "薄弱点", "限时训练", "检查表", "易错", "公式", "适用条件", "题型", "作业", "证明", "求解",
  ];
  const GENERIC_QUERY_TERMS = new Set(["请", "根据", "当前", "资料", "生成", "这个", "这些", "一下", "说明", "讲解"]);
  const BASE_CONTEXT_LIMITS = {
    recentMessages: 6,
    recentArtifacts: 8,
    materialDocuments: 6,
    materialUnits: 18,
    unitsPerDocument: 4,
    excerptChars: 720,
    visualMaterials: 4,
  };

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
- 公式使用可编译的 LaTeX：行内用 $\\sigma = \\frac{F_N}{A}$，单独成行的重要公式用 $$\\sigma = \\frac{F_N}{A}$$；不要把公式写成纯文本分数。
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

  function contextLimitsForSkill(skill) {
    if (skill.id === "final_review") {
      return { ...BASE_CONTEXT_LIMITS, materialDocuments: 8, materialUnits: 24, unitsPerDocument: 4 };
    }
    if (skill.id === "solve_homework") {
      return { ...BASE_CONTEXT_LIMITS, materialDocuments: 5, materialUnits: 16, unitsPerDocument: 5 };
    }
    return BASE_CONTEXT_LIMITS;
  }

  function compactText(value, maxLength) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function recentMessageEvidence(messages = [], currentMessage = "", limits = BASE_CONTEXT_LIMITS) {
    const result = [];
    let skippedCurrent = false;
    const current = String(currentMessage || "").trim();
    for (let index = messages.length - 1; index >= 0 && result.length < limits.recentMessages; index -= 1) {
      const message = messages[index] || {};
      const text = String(message.text || "").trim();
      if (!skippedCurrent && message.role === "user" && current && text === current) {
        skippedCurrent = true;
        continue;
      }
      result.unshift({
        role: message.role,
        intent: message.intent || "",
        text: compactText(text, 700),
      });
    }
    return result;
  }

  function recentArtifactEvidence(artifacts = [], limits = BASE_CONTEXT_LIMITS) {
    return artifacts.slice(-limits.recentArtifacts).map((artifact) => ({
      type: artifact.type,
      title: compactText(artifact.title, 120),
      body: compactText(artifact.body, 520),
      items: (artifact.items || []).slice(0, 6).map((item) => compactText(item, 120)).filter(Boolean),
    }));
  }

  function historyEvidence(messages = [], artifacts = [], currentMessage = "", limits = BASE_CONTEXT_LIMITS) {
    return {
      recent_messages: recentMessageEvidence(messages, currentMessage, limits),
      recent_artifacts: recentArtifactEvidence(artifacts, limits),
    };
  }

  function extractKeywords(text = "") {
    const source = String(text || "");
    const keywords = new Set();
    for (const term of DOMAIN_TERMS) {
      if (source.includes(term)) keywords.add(term);
    }
    for (const match of source.matchAll(/[A-Za-z][A-Za-z0-9_]{1,}|[\u0370-\u03ff]{1,}/g)) {
      keywords.add(match[0]);
    }
    for (const match of source.matchAll(/[\u4e00-\u9fff]{2,16}/g)) {
      const chunk = match[0];
      if (!GENERIC_QUERY_TERMS.has(chunk)) keywords.add(chunk);
      for (let index = 0; index < chunk.length - 1 && keywords.size < 120; index += 1) {
        const bigram = chunk.slice(index, index + 2);
        if (!GENERIC_QUERY_TERMS.has(bigram)) keywords.add(bigram);
      }
      for (let index = 0; index < chunk.length - 2 && keywords.size < 120; index += 1) {
        keywords.add(chunk.slice(index, index + 3));
      }
    }
    return [...keywords].filter((keyword) => keyword.length >= 2).slice(0, 120);
  }

  function keywordWeight(keyword) {
    if (DOMAIN_TERMS.includes(keyword)) return 5;
    if (/^[A-Za-z][A-Za-z0-9_]{1,}$|^[\u0370-\u03ff]+$/.test(keyword)) return 4;
    if (keyword.length >= 4) return 3;
    return 1;
  }

  function scoreText(text = "", keywords = []) {
    const value = String(text || "");
    if (!value) return 0;
    return keywords.reduce((score, keyword) => (value.includes(keyword) ? score + keywordWeight(keyword) : score), 0);
  }

  function intentBoost(text = "", material = {}, skill) {
    const value = `${material.originalName || ""}\n${text}`;
    if (skill.id === "solve_homework") {
      return (/作业|题|求|计算|证明|已知|所求|答案|例题/.test(value) ? 8 : 0) + (["image", "pdf"].includes(material.kind) ? 5 : 0);
    }
    if (skill.id === "final_review") {
      return (/期末|复习|重点|薄弱|限时|检查表|易错|公式|题型|危险截面/.test(value) ? 7 : 0);
    }
    return (/概念|实例|公式|条件|步骤|例题|易错|掌握/.test(value) ? 5 : 0);
  }

  function snippetCandidates(material, materialIndex, skill, limits, keywords) {
    const units = Array.isArray(material.units) && material.units.length
      ? material.units.map((unit, index) => ({ index, label: unit.label || `片段 ${index + 1}`, text: unit.text || "" }))
      : fallbackUnits(material, limits);
    if (!units.length && ["image", "pdf"].includes(material.kind)) {
      units.push({ index: 0, label: material.kind === "pdf" ? "PDF 资料" : "图片资料", text: material.warning || material.originalName || "" });
    }
    return units
      .map((unit) => {
        const text = String(unit.text || "");
        const score = scoreText(`${material.originalName || ""}\n${unit.label || ""}\n${text}`, keywords)
          + intentBoost(text, material, skill)
          + Math.max(0, 3 - materialIndex * 0.15)
          + Math.max(0, 1.2 - unit.index * 0.05);
        return {
          material,
          materialIndex,
          unitIndex: unit.index,
          unitLabel: unit.label || `片段 ${unit.index + 1}`,
          text,
          score,
        };
      })
      .filter((candidate) => candidate.text || ["image", "pdf"].includes(material.kind));
  }

  function fallbackUnits(material, limits) {
    const text = String(material.text || "");
    if (!text.trim()) return [];
    const paragraphs = text.split(/\n{2,}|(?=##\s+)/).map((item) => item.trim()).filter(Boolean);
    const chunks = paragraphs.length ? paragraphs : text.match(/[\s\S]{1,900}/g) || [];
    return chunks.slice(0, Math.min(12, limits.materialUnits)).map((chunk, index) => ({
      index,
      label: `片段 ${index + 1}`,
      text: chunk,
    }));
  }

  function materialEvidence(materials = [], skill, relevanceText = "", limits = BASE_CONTEXT_LIMITS) {
    const keywords = extractKeywords(relevanceText);
    const candidates = materials.flatMap((material, materialIndex) => snippetCandidates(material, materialIndex, skill, limits, keywords));
    const ranked = candidates
      .sort((a, b) => b.score - a.score || a.materialIndex - b.materialIndex || a.unitIndex - b.unitIndex);
    const selected = [];
    const perDocumentCount = new Map();
    const selectedDocuments = new Set();
    for (const candidate of ranked) {
      const docCount = perDocumentCount.get(candidate.material.id) || 0;
      if (selected.length >= limits.materialUnits) break;
      if (docCount >= limits.unitsPerDocument) continue;
      if (!selectedDocuments.has(candidate.material.id) && selectedDocuments.size >= limits.materialDocuments) continue;
      selected.push(candidate);
      selectedDocuments.add(candidate.material.id);
      perDocumentCount.set(candidate.material.id, docCount + 1);
    }
    const byDocument = new Map();
    for (const candidate of selected) {
      if (!byDocument.has(candidate.material.id)) {
        const totalUnits = Array.isArray(candidate.material.units) && candidate.material.units.length
          ? candidate.material.units.length
          : fallbackUnits(candidate.material, limits).length;
        byDocument.set(candidate.material.id, {
          id: candidate.material.id,
          file_name: candidate.material.originalName,
          kind: candidate.material.kind,
          warning: candidate.material.warning || "",
          text_length: String(candidate.material.text || "").length,
          total_units: totalUnits,
          omitted_units: Math.max(0, totalUnits - (perDocumentCount.get(candidate.material.id) || 0)),
          units: [],
        });
      }
      byDocument.get(candidate.material.id).units.push({
        document_id: candidate.material.id,
        file_name: candidate.material.originalName,
        unit_index: candidate.unitIndex,
        unit_label: candidate.unitLabel,
        excerpt: compactText(candidate.text, limits.excerptChars),
        relevance_score: Math.round(candidate.score * 10) / 10,
      });
    }
    const evidence = [...byDocument.values()];
    const selectedMaterialIds = new Set(evidence.map((material) => material.id));
    return {
      materials: evidence,
      visualMaterials: materials.filter((material) => selectedMaterialIds.has(material.id)).slice(0, limits.visualMaterials),
      summary: {
        total_materials_available: materials.length,
        selected_materials: evidence.length,
        selected_units: evidence.reduce((sum, material) => sum + material.units.length, 0),
        omitted_materials: Math.max(0, materials.length - evidence.length),
        max_materials: limits.materialDocuments,
        max_units: limits.materialUnits,
        keyword_count: keywords.length,
      },
    };
  }

  function relevanceTextFor({ course, message, history }) {
    return [
      course?.name || "",
      message || "",
      ...(history.recent_messages || []).map((item) => item.text || ""),
      ...(history.recent_artifacts || []).flatMap((artifact) => [artifact.title, artifact.body, ...(artifact.items || [])]),
    ].join("\n");
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
    const limits = contextLimitsForSkill(skill);
    const history = historyEvidence(messages, artifacts, message, limits);
    const selectedMaterials = materialEvidence(materials, skill, relevanceTextFor({ course, message, history }), limits);
    const evidence = {
      course: { id: course.id, name: course.name },
      intent: skill.id,
      context_policy: {
        strategy: "layered_context_pack_v1",
        priority_order: ["current_user_message", "recent_messages", "recent_artifacts", "relevant_material_units"],
        note: "不再默认塞入当前科目全部资料原文，只发送按相关性挑选后的资料片段。",
        summary: selectedMaterials.summary,
      },
      skill: {
        id: skill.id,
        label: skill.label,
        expected_artifact_types: skill.artifactTypes,
        source_refs_required: skill.sourceRefs.required,
        harness: skill.harness,
      },
      current_user_message: compactText(message, 2400),
      history,
      materials: selectedMaterials.materials,
    };
    const content = [
      {
        type: "text",
        text: `请按 skill “${skill.label}”处理。本轮上下文已按 current message -> 最近对话 -> 最近 artifacts -> 相关资料片段 分层裁剪；资料区只包含最相关片段，不代表当前科目全部原文。\n\n结构化上下文：\n${JSON.stringify(evidence, null, 2)}`,
      },
    ];
    for (const material of selectedMaterials.visualMaterials) {
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
