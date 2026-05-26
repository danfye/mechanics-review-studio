const fs = require("node:fs/promises");
const path = require("node:path");
const { assistantSkillIds, createAssistantService, getAssistantSkill } = require("../lib/server/assistant-service.cjs");

const ROOT = path.join(__dirname, "..");
const HARNESS_DIR = path.join(ROOT, "fixtures", "harness");

const HARNESS_TYPE_TO_INTENT = {
  ppt_teaching: "teach_materials",
  lesson: "teach_materials",
  solution: "solve_homework",
  homework: "solve_homework",
  final_review: "final_review",
};

function normalizeMaterial(document, courseId) {
  return {
    id: document.id,
    courseId: document.courseId || courseId,
    originalName: document.originalName || document.fileName || `${document.id}.txt`,
    kind: document.kind || document.type || "text",
    mimeType: document.mimeType || "text/plain",
    size: Buffer.byteLength(String(document.text || ""), "utf8"),
    text: String(document.text || ""),
    units: Array.isArray(document.units) ? document.units : [],
    warning: document.warning || "",
  };
}

function makeLongContextDocuments(courseId) {
  const makeUnit = (topic, index, extra = "") => ({
    label: `第 ${index + 1} 页`,
    text: `${topic} 第 ${index + 1} 页。${extra || "这里是当前科目的普通背景资料，用于检验长上下文不会被整科塞入模型。"}`,
  });
  return [
    {
      id: "long_doc_axial_target",
      courseId,
      originalName: "轴向拉压重点讲义.txt",
      type: "txt",
      text: "",
      units: [
        makeUnit("课程目录", 0),
        makeUnit("轴向拉压", 1, "截面法求轴力 F_N，横截面正应力 sigma = F_N / A。"),
        makeUnit("胡克定律", 2, "轴向伸长量 delta_L = F_N L / (E A)，需要统一单位。"),
        makeUnit("考试易错", 3, "不要把外力直接当作每个截面的轴力，先画轴力图。"),
        ...Array.from({ length: 12 }, (_, index) => makeUnit("泛化补充资料", index + 4)),
      ],
    },
    ...Array.from({ length: 9 }, (_, documentIndex) => ({
      id: `long_noise_doc_${documentIndex + 1}`,
      courseId,
      originalName: `无关章节_${documentIndex + 1}.txt`,
      type: "txt",
      text: "",
      units: Array.from({ length: 8 }, (_, unitIndex) => makeUnit(`无关章节 ${documentIndex + 1}`, unitIndex)),
    })),
  ];
}

function messageForSample(sample, intent) {
  if (sample.question) return sample.question;
  if (sample.message) return sample.message;
  if (intent === "solve_homework") return "请解析这道作业题，给出完整步骤和易错点。";
  if (intent === "final_review") return "请根据当前资料生成期末复习重点、顺序和限时练习。";
  return "请把这份课件从 0 教到我能考试复现。";
}

function intentForSample(sample) {
  return HARNESS_TYPE_TO_INTENT[sample.type] || sample.intent || "teach_materials";
}

function firstUnit(materials) {
  for (const material of materials) {
    const unit = material.units?.[0];
    if (unit) return { material, unit, unitIndex: 0 };
  }
  return { material: materials[0], unit: null, unitIndex: 0 };
}

function mockResponseFor({ sample, intent, materials }) {
  const expected = sample.expected || {};
  const skill = getAssistantSkill(intent);
  const conceptTerms = expected.conceptTerms || expected.relatedConcepts || ["课程重点"];
  const formulaTerms = expected.formulaTerms || [];
  const sections = expected.requiredSections || [];
  const { material, unit, unitIndex } = firstUnit(materials);
  const sourceRef = material
    ? {
        document_id: material.id,
        file_name: material.originalName,
        unit_index: unitIndex,
        unit_label: unit?.label || `片段 ${unitIndex + 1}`,
        excerpt: String(unit?.text || material.text || "").slice(0, 180),
      }
    : null;
  const answerParts = [
    sections.join("、"),
    conceptTerms.join("、"),
    formulaTerms.join("、"),
    "题型入口、已知-所求、关键公式、分步推导、答案校核、易错点、同类题练习、复习顺序、限时练习、最后检查表、从 0、先修知识、学习主线、掌握、记忆",
  ].filter(Boolean);
  const artifacts = skill.artifactTypes.slice(0, 2).map((type) => ({
    type,
    title: `${skill.label}档案`,
    body: answerParts.join("\n"),
    items: [...conceptTerms, ...formulaTerms, ...sections].slice(0, 8),
  }));
  return JSON.stringify({
    title: `${skill.label} harness`,
    answer_markdown: answerParts.join("\n\n"),
    source_refs: sourceRef ? [sourceRef] : [],
    artifacts,
    next_actions: ["继续讲下一页", "生成同类练习"],
  });
}

function combinedText(result) {
  return [
    result.title,
    result.answerMarkdown,
    ...result.sourceRefs.map((ref) => `${ref.file_name} ${ref.unit_label} ${ref.excerpt}`),
    ...result.artifacts.flatMap((artifact) => [artifact.type, artifact.title, artifact.body, ...(artifact.items || [])]),
    ...result.nextActions,
  ].join("\n");
}

function countHits(text, terms = []) {
  return terms.filter((term) => text.includes(String(term))).length;
}

function expectedKeywordGroups(sample, skill) {
  const expected = sample.expected || {};
  return (skill.harness.keywordGroups || [])
    .map((groupName) => ({ groupName, terms: expected[groupName] || [] }))
    .filter((group) => group.terms.length);
}

function validateResult({ sample, intent, result, capturedMessages }) {
  const skill = getAssistantSkill(intent);
  const text = combinedText(result);
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });
  const systemPrompt = String(capturedMessages[0]?.content || "");
  const userContent = capturedMessages[1]?.content || [];
  const userText = Array.isArray(userContent) ? userContent.map((item) => item.text || "").join("\n") : String(userContent);
  const pdfHomeworkDocs = (sample.documents || sample.materials || []).filter((document) => {
    const name = String(document.originalName || document.fileName || "");
    const kind = String(document.kind || document.type || "");
    return intent === "solve_homework" && (kind === "pdf" || name.toLowerCase().endsWith(".pdf"));
  });
  const context = parseStructuredContext(userText);

  add("intent", result.intent === intent, `${result.intent} expected ${intent}`);
  add("skill prompt", systemPrompt.includes(`id: ${skill.id}`) && systemPrompt.includes(skill.label), skill.label);
  add("context skill", userText.includes(`"id": "${skill.id}"`) && userText.includes('"harness"'), "skill metadata present");
  if (pdfHomeworkDocs.length) {
    add("pdf homework context", userText.includes("PDF 作业资料"), "PDF作业资料 included");
  }
  add("answer", Boolean(result.answerMarkdown), "answerMarkdown not empty");
  add("source refs", result.sourceRefs.length >= skill.harness.minimumSourceRefs, `${result.sourceRefs.length} refs`);
  add("artifact type", result.artifacts.some((artifact) => skill.harness.requiredArtifactTypes.includes(artifact.type)), result.artifacts.map((artifact) => artifact.type).join(", "));

  for (const group of expectedKeywordGroups(sample, skill)) {
    const hits = countHits(text, group.terms);
    add(`keywords:${group.groupName}`, hits === group.terms.length, `${hits}/${group.terms.length}`);
  }
  if (sample.expected?.contextPolicy) {
    const policy = sample.expected.contextPolicy;
    const materials = context?.materials || [];
    const units = materials.flatMap((material) => material.units || []);
    const summary = context?.context_policy?.summary || {};
    add("context policy", context?.context_policy?.strategy === "layered_context_pack_v1", context?.context_policy?.strategy || "missing");
    add("context material cap", materials.length <= policy.maxMaterials, `${materials.length}/${policy.maxMaterials}`);
    add("context unit cap", units.length <= policy.maxUnits, `${units.length}/${policy.maxUnits}`);
    add("context omitted materials", summary.omitted_materials >= policy.minOmittedMaterials, `${summary.omitted_materials || 0}/${policy.minOmittedMaterials}`);
    for (const term of policy.requiredTerms || []) {
      add(`context term:${term}`, units.some((unit) => String(unit.excerpt || "").includes(term)), term);
    }
    for (const term of policy.omittedTerms || []) {
      add(`context omit:${term}`, !userText.includes(term), term);
    }
  }

  return checks;
}

function parseStructuredContext(userText) {
  const marker = "结构化上下文：";
  const index = userText.indexOf(marker);
  if (index < 0) return null;
  const jsonText = userText.slice(index + marker.length).trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

async function loadHarnessSamples() {
  const files = (await fs.readdir(HARNESS_DIR)).filter((file) => file.endsWith(".json")).sort();
  const fileSamples = await Promise.all(
    files.map(async (file) => ({
      file,
      sample: JSON.parse(await fs.readFile(path.join(HARNESS_DIR, file), "utf8")),
    })),
  );
  return [
    ...fileSamples,
    {
      file: "[generated] layered-context-long-course",
      sample: {
        id: "layered-context-long-course",
        type: "solution",
        course: { id: "harness_course_long_context", name: "材料力学长上下文" },
        documents: makeLongContextDocuments("harness_course_long_context"),
        question: "等截面直杆受到轴向拉力 F，请只围绕轴向拉压、截面法、正应力和轴向伸长量给出解题步骤。",
        expected: {
          relatedConcepts: ["轴向拉压", "轴力", "正应力", "胡克定律"],
          formulaTerms: ["F_N", "A", "L", "E"],
          contextPolicy: {
            maxMaterials: 5,
            maxUnits: 16,
            minOmittedMaterials: 5,
            requiredTerms: ["轴向拉压", "F_N", "截面法"],
            omittedTerms: ["无关章节 9"],
          },
        },
      },
    },
  ];
}

function validateHarnessCoverage(entries) {
  const coveredIntents = new Set(entries.map(({ sample }) => intentForSample(sample)));
  const missing = assistantSkillIds().filter((id) => !coveredIntents.has(id));
  if (missing.length) throw new Error(`fixtures/harness 缺少 skill 覆盖：${missing.join("、")}`);
}

async function runSample(file, sample) {
  const intent = intentForSample(sample);
  const course = sample.course || { id: "harness_course", name: "Harness 课程" };
  const materials = (sample.documents || sample.materials || []).map((document) => normalizeMaterial(document, course.id));
  const message = messageForSample(sample, intent);
  let capturedMessages = [];
  const assistant = createAssistantService({
    fsp: fs,
    uploadPath: (name) => name,
    callChatApi: async (_settings, messages) => {
      capturedMessages = messages;
      return mockResponseFor({ sample, intent, materials });
    },
  });
  const result = await assistant.runAssistant({
    settings: { apiBaseUrl: "https://harness.invalid/v1", model: "harness-model", apiKey: "harness-key" },
    course,
    message,
    intent,
    materials,
    messages: [],
    artifacts: [],
  });
  const checks = validateResult({ sample, intent, result, capturedMessages });
  const passed = checks.every((check) => check.pass);
  return { file, id: sample.id || file, intent, passed, checks };
}

(async () => {
  const samples = await loadHarnessSamples();
  if (!samples.length) throw new Error("fixtures/harness 下没有 harness 样例。");
  validateHarnessCoverage(samples);
  const results = [];
  for (const { file, sample } of samples) {
    const result = await runSample(file, sample);
    results.push(result);
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`${status} ${result.id} (${result.intent}) from ${file}`);
    for (const check of result.checks) {
      console.log(`  ${check.pass ? "OK" : "NO"} ${check.name}: ${check.detail}`);
    }
  }
  const passed = results.filter((result) => result.passed).length;
  console.log(`\nHarness summary: ${passed}/${results.length} passed`);
  if (passed !== results.length) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
