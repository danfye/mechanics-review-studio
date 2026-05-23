const path = require("node:path");

function createAssistantService({ fsp, uploadPath, callChatApi }) {
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
    if (["teach_materials", "solve_homework", "final_review"].includes(explicit)) return explicit;
    const text = String(input.message || "");
    if (/期末|复习|冲刺|计划|重点|薄弱|考前/.test(text)) return "final_review";
    if (/解题|作业|题目|答案|求解|怎么算|如图|证明/.test(text)) return "solve_homework";
    return "teach_materials";
  }

  function intentLabel(intent) {
    if (intent === "solve_homework") return "作业解题";
    if (intent === "final_review") return "期末复习";
    return "课件教学";
  }

  function systemPrompt() {
    return `你是一个 API 必需的理工科课程助教。你只服务三个目标：读懂课件并从 0 教会学生、解析作业图片并作答、基于学生上传资料做期末复习。

通用要求：
- 全程中文，面向工科/力学期末复习，语言像认真板书的老师。
- 不要说“本地 OCR 不足”“无法读取图片”作为托辞；如果消息里有图片或 PPT 内嵌图，要直接阅读视觉信息。
- 公式使用类 LaTeX，例如 $\\sigma = \\frac{F_N}{A}$。
- 必须尽量绑定资料来源，使用 source_refs 中提供的 document_id、unit_index、unit_label。
- 不要大段复制原文，要重组为教学、解题或复习资产。

不同意图的输出重点：
- teach_materials：先建立直觉，再讲先修知识、知识主线、公式条件、题型入口、掌握检测。
- solve_homework：必须包含题型入口、已知-所求、关键公式、分步推导、答案校核、易错点、同类题练习。
- final_review：必须包含重点排序、薄弱点、复习顺序、限时练习题、最后检查表。

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

  function imageMimeType(name = "") {
    const ext = path.extname(name).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    return "image/png";
  }

  async function buildUserContent({ course, intent, message, materials, messages, artifacts }) {
    const evidence = {
      course: { id: course.id, name: course.name },
      intent,
      intent_label: intentLabel(intent),
      current_user_message: message,
      materials: materialEvidence(materials),
      history: historyEvidence(messages, artifacts),
    };
    const content = [
      {
        type: "text",
        text: `请按意图“${intentLabel(intent)}”处理。本轮默认使用当前科目全部资料。\n\n结构化上下文：\n${JSON.stringify(evidence, null, 2)}`,
      },
    ];
    for (const material of materials.slice(0, 8)) {
      content.push(...(await imageContentForMaterial(material)));
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
    return {
      title: String(raw.title || fallbackTitle).trim() || fallbackTitle,
      answerMarkdown: String(raw.answer_markdown || raw.answerMarkdown || raw.answer || "").trim(),
      sourceRefs: normalizeSourceRefs(raw.source_refs || raw.sourceRefs),
      artifacts: artifacts
        .map((artifact) => ({
          type: normalizeArtifactType(artifact.type),
          title: String(artifact.title || "复习资产").trim(),
          body: String(artifact.body || "").trim(),
          items: Array.isArray(artifact.items) ? artifact.items.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 16) : [],
        }))
        .filter((artifact) => artifact.title || artifact.body || artifact.items.length)
        .slice(0, 12),
      nextActions: Array.isArray(raw.next_actions || raw.nextActions)
        ? (raw.next_actions || raw.nextActions).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6)
        : [],
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
    const raw = await callChatApi(
      settings,
      [
        { role: "system", content: systemPrompt() },
        {
          role: "user",
          content: await buildUserContent({
            course,
            intent: resolvedIntent,
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
    inferIntent,
    runAssistant,
  };
}

module.exports = {
  createAssistantService,
};
