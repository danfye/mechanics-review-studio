const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const { createRuntimeRequire } = require("../lib/server/runtime-require.cjs");
const { createApiKeyStore } = require("../lib/server/api-key-store.cjs");
const {
  toLatexFormula,
  extractTextFromFile,
  extractKeywords,
  localKnowledgeMap,
  localReviewPlan,
  localSummary,
  localQuiz,
  localSimilarQuestions,
  generateCramPack,
  buildCourseKnowledgeModel,
  extractProblemAnchors,
  generateQuestionSet,
  evaluateQuestionSet,
  generateMindMap,
  StudyPlanGenerator,
  publicState,
  buildApiStudyContext,
  normalizeApiQuestion,
  parseJsonFromModel,
  aiPptTeachingSkillPrompt,
  aiSolutionSkillPrompt,
  pptTeachingSummaryRequest,
  solutionSkillRequest,
} = require("../server.cjs");
const {
  localSolveQuestion,
} = require("../lib/core/solution-generator.cjs");

const runtimeRequire = createRuntimeRequire(path.join(__dirname, ".."));

async function makePptx() {
  const JSZip = runtimeRequire("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types></Types>');
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
      <p:cSld><p:spTree><p:sp><p:txBody>
        <a:p><a:r><a:t>材料力学 梁的弯曲</a:t></a:r></a:p>
        <a:p><a:r><a:t>简支梁跨中集中力 P，最大弯矩 M = P L / 4</a:t></a:r></a:p>
        <a:p><a:r><a:t>弯曲正应力 sigma = M y / I，需要检查强度条件</a:t></a:r></a:p>
        <a:p><a:r><a:t>Symbol 字体：</a:t></a:r><a:r><a:rPr><a:latin typeface="Symbol"/></a:rPr><a:t>s</a:t></a:r><a:r><a:t> = F / A</a:t></a:r></a:p>
        <p:pic><p:nvPicPr><p:cNvPr id="4" name="diagram" descr="图示：梁弯曲危险截面和中性轴示意"/></p:nvPicPr></p:pic>
        <a:p>
          <a:r><a:t>公式对象：</a:t></a:r>
          <m:oMath>
            <m:sSub><m:e><m:r><m:t>F</m:t></m:r></m:e><m:sub><m:r><m:t>N</m:t></m:r></m:sub></m:sSub>
            <m:r><m:t>=</m:t></m:r>
            <m:f><m:num><m:r><m:t>EAΔl</m:t></m:r></m:num><m:den><m:r><m:t>l</m:t></m:r></m:den></m:f>
          </m:oMath>
        </a:p>
      </p:txBody></p:sp></p:spTree></p:cSld>
    </p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
    </Relationships>`,
  );
  zip.file(
    "ppt/notesSlides/notesSlide1.xml",
    `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree><p:sp><p:txBody>
        <a:p><a:r><a:t>备注：本页考试重点是先找危险截面，再使用强度条件。</a:t></a:r></a:p>
      </p:txBody></p:sp></p:spTree></p:cSld>
    </p:notes>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makePdf() {
  const { PDFDocument, StandardFonts } = runtimeRequire("pdf-lib");
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  page.drawText("Mechanics homework: axial stress sigma = F / A, deformation delta = F L / E A.", {
    x: 48,
    y: 760,
    size: 14,
    font,
  });
  return Buffer.from(await pdfDoc.save());
}

(async () => {
  const pptx = await extractTextFromFile(await makePptx(), "sample.pptx");
  if (!pptx.text.includes("最大弯矩")) throw new Error("PPTX extraction failed");
  if (!pptx.text.includes("σ = F / A")) throw new Error("PPTX Symbol font extraction failed");
  if (!pptx.text.includes("危险截面和中性轴示意") || !pptx.text.includes("备注：本页考试重点")) {
    throw new Error(`PPTX alt text or speaker notes extraction failed: ${pptx.text}`);
  }
  if (!pptx.units[0]?.hasAltText || !pptx.units[0]?.hasNotes || !pptx.units[0]?.mathCount) {
    throw new Error(`PPTX unit metadata failed: ${JSON.stringify(pptx.units[0])}`);
  }
  if (!pptx.text.includes("F_{N}") || !/\\frac\{E A \\Delta l\}\{l\}|\(EAΔl\) \/ \(l\)/.test(pptx.text)) {
    throw new Error(`PPTX formula extraction failed: ${pptx.text}`);
  }

  const pdf = await extractTextFromFile(await makePdf(), "sample.pdf");
  if (!/axial stress/.test(pdf.text)) throw new Error("PDF extraction failed");

  const textExamples = await extractTextFromFile(
    Buffer.from(
      `例题 1：等截面直杆受轴向拉力 F。\n求：正应力和轴向伸长量。\n\n题目 2：简支梁跨中作用集中力 P。\n求最大弯矩。`,
      "utf8",
    ),
    "examples.txt",
  );
  if (textExamples.units.length !== 2 || !textExamples.units[0].label.includes("例题")) {
    throw new Error(`Plain text example splitting failed: ${JSON.stringify(textExamples.units)}`);
  }

  const noisyAnchors = extractProblemAnchors("材料力学 应力 — 分布内力在截面内一点的密集程度 问题 合力 应力，关键是要知道应力在截面上如何分布。");
  if (noisyAnchors.length) throw new Error(`False problem anchor detection: ${JSON.stringify(noisyAnchors)}`);
  const realAnchors = extractProblemAnchors("问题 ： 图示带缺口的直杆在两端承受拉力 F P 作用 。 求 A － A 截面上的内力 。");
  if (!realAnchors.length || !realAnchors[0].title.includes("问题")) {
    throw new Error(`Problem anchor detection failed: ${JSON.stringify(realAnchors)}`);
  }
  const principalStress = toLatexFormula("σ_{1,2} = (σ_x+σ_y)/2 ± sqrt(((σ_x-σ_y)/2)^2 + τ_xy^2)");
  if (!principalStress.includes("\\frac{\\sigma_{x}+\\sigma_{y}}{2}") || !principalStress.includes("\\sqrt")) {
    throw new Error(`Grouped fraction formula normalization failed: ${principalStress}`);
  }

  const docs = [
    {
      id: "doc_1",
      originalName: "sample.pptx",
      text: pptx.text,
      units: pptx.units,
    },
    {
      id: "doc_2",
      originalName: "sample.pdf",
      text: pdf.text,
      units: pdf.units,
    },
  ];
  const course = { id: "course_1", name: "材料力学" };
  const keywords = extractKeywords(docs.map((doc) => doc.text).join("\n"));
  if (!keywords.length) throw new Error("Keyword extraction failed");

  const map = localKnowledgeMap(course, docs);
  if (!map.topics.length) {
    throw new Error("Knowledge map topic extraction failed");
  }
  const mapFormulas = map.topics.flatMap((topic) => topic.formulas);
  if (!mapFormulas.some((formula) => formula.includes("\\frac{M y}{I}") || formula.includes("\\frac{F_N}{A}"))) {
    throw new Error("Knowledge map formula extraction failed");
  }
  const bendingMap = localKnowledgeMap(course, [
    {
      id: "doc_bending",
      originalName: "bending.txt",
      text: "材料的力学性能 应力应变 屈服 强化 低碳钢。梁 弯曲 弯矩 剪力 惯性矩 中性轴。梁弯曲中的 σ = My/I 仍要回到材料许用应力判断。",
      units: [{ label: "全文", text: "材料的力学性能 应力应变 屈服 强化 低碳钢。梁 弯曲 弯矩 剪力 惯性矩 中性轴。梁弯曲中的 σ = My/I 仍要回到材料许用应力判断。" }],
    },
  ]);
  if (!bendingMap.relationships.some((item) => item.includes("$\\sigma = \\frac{M y}{I}$"))) {
    throw new Error(`Knowledge map relationship did not wrap formula: ${JSON.stringify(bendingMap.relationships)}`);
  }

  const summary = localSummary(course, docs);
  if (!summary.includes("期末复习提纲")) throw new Error("Summary generation failed");

  const plan = localReviewPlan(
    course,
    docs,
    [
      {
        id: "mistake_1",
        courseId: course.id,
        question: "弯矩正负号和最大弯曲正应力经常判断错",
        answer: "先画剪力图和弯矩图，再用 sigma = M y / I 校核。",
        explanation: "错因是没有统一弯矩正负号和危险截面位置。",
        sourceDocumentIds: ["doc_1"],
        mastered: false,
      },
    ],
    [],
    { limit: 6 },
  );
  if (!plan.nextReview || !plan.items.length) throw new Error("Review plan generation failed");
  if (!plan.summary.topicCount || plan.summary.unmasteredMistakeCount !== 1) {
    throw new Error("Review plan summary failed");
  }
  if (!plan.items.some((item) => item.sourceMistakeIds?.includes("mistake_1") || item.unmasteredMistakes > 0)) {
    throw new Error("Review plan did not attach mistakes");
  }

  const chapterPlan = localReviewPlan(
    course,
    [
      {
        id: "doc_chapter",
        originalName: "chapter.pdf",
        text: [
          "## 第 1 页\n2 - 1 、轴向拉压的概念和实例 外力合力作用线与杆件轴线重合，杆沿轴线伸长或缩短。",
          "## 第 2 页\n轴向拉压的特点：轴力以拉为正，以压为负。",
          "## 第 3 页\n2 - 2 、轴力和轴力图 截面法求轴力，画轴力图，确定危险截面。",
          "## 第 4 页\n平衡方程 F_N + 2F - F = 0，轴力图标明正负号。",
        ].join("\n\n"),
        units: [
          { label: "第 1 页", text: "2 - 1 、轴向拉压的概念和实例 外力合力作用线与杆件轴线重合，杆沿轴线伸长或缩短。" },
          { label: "第 2 页", text: "轴向拉压的特点：轴力以拉为正，以压为负。" },
          { label: "第 3 页", text: "2 - 2 、轴力和轴力图 截面法求轴力，画轴力图，确定危险截面。" },
          { label: "第 4 页", text: "平衡方程 F_N + 2F - F = 0，轴力图标明正负号。" },
        ],
      },
    ],
    [],
    [],
    { limit: 6 },
  );
  if (!chapterPlan.items.some((item) => item.title.startsWith("2-1、轴向拉压"))) {
    throw new Error(`Chapter review plan missed section 2-1: ${chapterPlan.items.map((item) => item.title).join(", ")}`);
  }
  if (!chapterPlan.items.some((item) => item.title.startsWith("2-2、轴力和轴力图"))) {
    throw new Error(`Chapter review plan missed section 2-2: ${chapterPlan.items.map((item) => item.title).join(", ")}`);
  }
  if (!chapterPlan.items.every((item) => item.chapterLocation.includes("第 "))) {
    throw new Error("Chapter review plan did not preserve material locations");
  }

  const firstChapter = chapterPlan.nextReview;
  const chapterPlanAfterSession = localReviewPlan(
    course,
    [
      {
        id: "doc_chapter",
        originalName: "chapter.pdf",
        text: chapterPlan.items.map((item) => item.title).join("\n"),
        units: [
          { label: "第 1 页", text: "2 - 1 、轴向拉压的概念和实例 外力合力作用线与杆件轴线重合，杆沿轴线伸长或缩短。" },
          { label: "第 2 页", text: "轴向拉压的特点：轴力以拉为正，以压为负。" },
          { label: "第 3 页", text: "2 - 2 、轴力和轴力图 截面法求轴力，画轴力图，确定危险截面。" },
          { label: "第 4 页", text: "平衡方程 F_N + 2F - F = 0，轴力图标明正负号。" },
        ],
      },
    ],
    [],
    [
      {
        id: "session_chapter_1",
        courseId: course.id,
        topicId: firstChapter.id,
        topicTitle: firstChapter.title,
        completedAt: new Date().toISOString(),
      },
    ],
    { limit: 6 },
  );
  if (chapterPlanAfterSession.nextReview?.id === firstChapter.id && chapterPlanAfterSession.items.length > 1) {
    throw new Error("Recently completed chapter stayed as next review");
  }

  const cramPack = generateCramPack(
    course,
    docs,
    {
      questions: localQuiz(course, docs, { count: 12 }),
      documents: docs,
      mistakes: [
        {
          id: "mistake_cram_1",
          courseId: course.id,
          question: "弯曲正应力公式适用条件和危险截面判断错",
          answer: "先确定最大弯矩截面，再用 sigma = M y / I。",
          explanation: "错因是没有先找危险截面。",
          sourceDocumentIds: ["doc_1"],
          sourceRefs: [
            {
              document_id: "doc_1",
              file_name: "sample.pptx",
              unit_index: 0,
              unit_label: docs[0].units?.[0]?.label || "全文",
              locator_label: "弯曲正应力",
              excerpt: "弯曲正应力公式适用条件和危险截面判断错",
            },
          ],
          mastered: false,
        },
      ],
      sessions: [],
      totalMinutes: 80,
      questionCount: 8,
    },
  );
  if (!cramPack.focusTopics.length || !cramPack.timeline.length) throw new Error("Cram pack missed focus topics or timeline");
  if (!cramPack.formulas.length) throw new Error("Cram pack missed formula queue");
  if (!cramPack.mistakeQueue.some((item) => item.id === "mistake_cram_1" && !item.mastered)) {
    throw new Error("Cram pack missed unmastered mistake queue");
  }
  const cramMistake = cramPack.mistakeQueue.find((item) => item.id === "mistake_cram_1");
  if (!cramMistake?.sourceRefs?.some((ref) => ref.document_id === "doc_1" && Number(ref.unit_index) === 0)) {
    throw new Error(`Cram pack mistake queue did not preserve sourceRefs: ${JSON.stringify(cramMistake)}`);
  }
  if (!cramPack.drillQuestions.length || cramPack.summary.drillQuestionCount !== cramPack.drillQuestions.length) {
    throw new Error("Cram pack drill questions summary failed");
  }
  if (cramPack.scope.documentCount !== docs.length || cramPack.scope.unmasteredMistakeCount !== 1) {
    throw new Error("Cram pack scope statistics failed");
  }

  const completedPlanForFirst = localReviewPlan(
    course,
    docs,
    [],
    [
      {
        id: "session_1",
        courseId: course.id,
        topicId: plan.nextReview.id,
        topicTitle: plan.nextReview.title,
        completedAt: new Date().toISOString(),
      },
    ],
    { limit: 6 },
  );
  const completedItemForFirst = completedPlanForFirst.items.find((item) => item.id === plan.nextReview.id);
  if (!completedItemForFirst?.completedCount) throw new Error("Review session tracking failed");

  const quiz = localQuiz(course, docs, { count: 6 });
  if (quiz.length !== 6 || !quiz.some((q) => q.type === "calculation")) {
    throw new Error("Quiz generation failed");
  }

  const similar = localSimilarQuestions(
    {
      id: "mistake_1",
      question: quiz[0].stem,
      answer: quiz[0].answer,
      explanation: quiz[0].explanation,
    },
    docs,
    3,
  );
  if (similar.length !== 3 || !similar.every((q) => q.sourceMistakeId === "mistake_1")) {
    throw new Error("Similar-question generation failed");
  }

  const samplePath = path.join(__dirname, "..", "samples", "mechanics-mini.json");
  const sample = JSON.parse(fs.readFileSync(samplePath, "utf8"));
  const courseModel = buildCourseKnowledgeModel(sample.course, sample.documents);
  if (!courseModel.chapters.length) throw new Error("Structured model missed chapters");
  if (!courseModel.concepts.length) throw new Error("Structured model missed concepts");
  if (!courseModel.formulas.length) throw new Error("Structured model missed formulas");
  if (!courseModel.homework_problems.length) throw new Error("Structured model missed homework problems");
  if (!courseModel.mistake_points.length) throw new Error("Structured model missed mistake points");
  const allObjects = [
    ...courseModel.chapters,
    ...courseModel.concepts,
    ...courseModel.formulas,
    ...courseModel.theorem_or_rules,
    ...courseModel.examples,
    ...courseModel.homework_problems,
    ...courseModel.mistake_points,
  ];
  if (!allObjects.every((item) => Array.isArray(item.source_refs) && item.source_refs.length)) {
    throw new Error("Structured objects did not preserve source_refs");
  }
  if (courseModel.course.focus_profile?.id !== "material_mechanics") {
    throw new Error(`Course focus profile detection failed: ${JSON.stringify(courseModel.course.focus_profile)}`);
  }
  if (courseModel.concepts.length > 14) {
    throw new Error(`Concept filter is too broad: ${courseModel.concepts.map((item) => item.name).join(", ")}`);
  }
  for (const expectedConcept of ["轴向拉压", "轴力", "圣维南原理"]) {
    if (!courseModel.concepts.some((concept) => concept.name === expectedConcept)) {
      throw new Error(`Concept detector missed key material-mechanics point: ${expectedConcept}`);
    }
  }
  if (courseModel.concepts.some((concept) => concept.name === "应力" && Number(concept.importance_score || 0) < 92)) {
    throw new Error("Generic concept leaked into filtered concept list without strong evidence");
  }

  const mixedSignalModel = buildCourseKnowledgeModel(
    { id: "course_material_noise", name: "材料力学" },
    [
      {
        id: "doc_noise",
        originalName: "考点汇总.txt",
        type: "txt",
        text: [
          "目录 1-1 绪论 1-2 基本假设 1-3 应力 1-4 应变 1-5 例题 1-6 思考题。",
          "第 2 页 轴向拉压：要求掌握轴力图、横截面正应力公式 σ = F_N / A 和强度条件。",
          "第 3 页 圆轴扭转：会画扭矩图，应用 τ = Tρ / J 判断危险点。",
          "第 4 页 梁弯曲：掌握剪力图、弯矩图和弯曲正应力 σ = M y / I。",
          "第 5 页 压杆稳定：理解临界载荷和欧拉公式，注意适用条件。",
        ].join("\n"),
        units: [
          { label: "第 1 页", text: "目录 1-1 绪论 1-2 基本假设 1-3 应力 1-4 应变 1-5 例题 1-6 思考题。" },
          { label: "第 2 页", text: "轴向拉压：要求掌握轴力图、横截面正应力公式 σ = F_N / A 和强度条件。" },
          { label: "第 3 页", text: "圆轴扭转：会画扭矩图，应用 τ = Tρ / J 判断危险点。" },
          { label: "第 4 页", text: "梁弯曲：掌握剪力图、弯矩图和弯曲正应力 σ = M y / I。" },
          { label: "第 5 页", text: "压杆稳定：理解临界载荷和欧拉公式，注意适用条件。" },
        ],
      },
    ],
  );
  const mixedNames = mixedSignalModel.concepts.map((concept) => concept.name);
  for (const expectedConcept of ["轴向拉压", "扭转", "梁弯曲", "压杆稳定"]) {
    if (!mixedNames.includes(expectedConcept)) throw new Error(`Exam-focused detector missed ${expectedConcept}: ${mixedNames.join(", ")}`);
  }
  if (mixedNames.length > 12) throw new Error(`Exam-focused detector returned too many concepts: ${mixedNames.join(", ")}`);

  const evidenceModel = buildCourseKnowledgeModel(
    { id: "course_evidence", name: "材料力学" },
    [
      {
        id: "doc_evidence",
        originalName: "拉压复习.pptx",
        type: "pptx",
        text: [
          "第 1 页 目录 1-1 绪论 1-2 应力 1-3 应变 1-4 例题 1-5 思考题。",
          "第 2 页 轴向拉压：要求掌握轴力图、横截面正应力公式 σ = F_N / A 和强度条件。",
          "第 3 页 圣维南原理：集中力附近不能直接套均匀应力假设，远离加载区后影响减弱。",
          "第 4 页 例题 1：等截面直杆受轴向拉力 F，求正应力和伸长量，注意单位统一。",
        ].join("\n"),
        units: [
          { label: "第 1 页", text: "目录 1-1 绪论 1-2 应力 1-3 应变 1-4 例题 1-5 思考题。" },
          { label: "第 2 页", text: "轴向拉压：要求掌握轴力图、横截面正应力公式 σ = F_N / A 和强度条件。" },
          { label: "第 3 页", text: "圣维南原理：集中力附近不能直接套均匀应力假设，远离加载区后影响减弱。" },
          { label: "第 4 页", text: "例题 1：等截面直杆受轴向拉力 F，求正应力和伸长量，注意单位统一。" },
        ],
      },
    ],
  );
  const evidenceNames = evidenceModel.concepts.map((concept) => concept.name);
  for (const expectedConcept of ["轴向拉压", "轴力图", "强度条件", "圣维南原理"]) {
    if (!evidenceNames.includes(expectedConcept)) {
      throw new Error(`Evidence-based concept filter missed ${expectedConcept}: ${evidenceNames.join(", ")}`);
    }
  }
  if (evidenceModel.concepts.some((concept) => concept.source_refs?.some((ref) => /目录/.test(ref.excerpt || "")))) {
    throw new Error("Evidence-based concept filter retained contents-page evidence");
  }
  if (!evidenceModel.concepts.every((concept) => Number(concept.selection_score || 0) > 0 && concept.evidence_counts)) {
    throw new Error("Evidence-based concept filter did not preserve selection metadata");
  }

  const evidenceSummary = localSummary({ id: "course_evidence", name: "材料力学" }, [
    {
      id: "doc_evidence",
      originalName: "拉压复习.pptx",
      type: "pptx",
      text: "轴向拉压：要求掌握轴力图、横截面正应力公式 σ = F_N / A 和强度条件。圣维南原理说明局部加载方式影响在远离加载区会减弱。",
      units: [
        {
          label: "第 2 页",
          text: "轴向拉压：要求掌握轴力图、横截面正应力公式 σ = F_N / A 和强度条件。圣维南原理说明局部加载方式影响在远离加载区会减弱。",
        },
      ],
    },
  ]);
  if (!evidenceSummary.includes("## 核心考点") || evidenceSummary.includes("## 高频关键词")) {
    throw new Error("Local summary still presents simple keyword extraction");
  }

  const verifiedFormulaModel = buildCourseKnowledgeModel(
    { id: "course_formula_verify", name: "理工科综合" },
    [
      {
        id: "doc_formula_verify",
        originalName: "公式校验.txt",
        type: "txt",
        text: [
          "材料力学：OCR 可能把横截面正应力写成 A F_N = σ，也可能误识别成 σ = F_N + A。",
          "梁弯曲使用 σ = M y / I。",
          "物理匀加速运动 v = v_0 + a t，化学理想气体 PV = nRT，高数恒等式 sin^2 x + cos^2 x = 1。",
          "高数：梯度 ∇f = <f_x, f_y, f_z>，概率二项分布 P(X=k)=C_n^k p^k(1-p)^(n-k)。",
          "物理：电磁感应 E = -N dPhi_B/dt，热力学第一定律 Delta U = Q - W。",
          "化学：缓冲溶液 pH = pKa + log([A-]/[HA])，溶度积 Ksp = [M]^n [X]^m。",
          "生物：遗传平衡 p^2 + 2pq + q^2 = 1，种群增长 dN/dt = rN(1-N/K)。",
        ].join("\n"),
        units: [
          {
            label: "全文",
            text: [
              "材料力学：OCR 可能把横截面正应力写成 A F_N = σ，也可能误识别成 σ = F_N + A。",
              "梁弯曲使用 σ = M y / I。",
              "物理匀加速运动 v = v_0 + a t，化学理想气体 PV = nRT，高数恒等式 sin^2 x + cos^2 x = 1。",
              "高数：梯度 ∇f = <f_x, f_y, f_z>，概率二项分布 P(X=k)=C_n^k p^k(1-p)^(n-k)。",
              "物理：电磁感应 E = -N dPhi_B/dt，热力学第一定律 Delta U = Q - W。",
              "化学：缓冲溶液 pH = pKa + log([A-]/[HA])，溶度积 Ksp = [M]^n [X]^m。",
              "生物：遗传平衡 p^2 + 2pq + q^2 = 1，种群增长 dN/dt = rN(1-N/K)。",
            ].join("\n"),
          },
        ],
      },
    ],
  );
  const verifiedExpressions = verifiedFormulaModel.formulas.map((formula) => formula.expression);
  for (const expected of [
    "\\sigma = \\frac{F_{N}}{A}",
    "\\sigma = \\frac{M y}{I}",
    "P V = n R T",
    "\\sin^{2} x + \\cos^{2} x = 1",
    "\\nabla f = \\langle f_x, f_y, f_z \\rangle",
  ]) {
    if (!verifiedExpressions.includes(expected)) {
      throw new Error(`Formula verifier missed or failed to normalize ${expected}: ${verifiedExpressions.join("; ")}`);
    }
  }
  if (verifiedExpressions.some((formula) => /F_\{N\}\s*\+\s*A/.test(formula))) {
    throw new Error(`Formula verifier retained rejected OCR formula: ${verifiedExpressions.join("; ")}`);
  }
  const correctedAxial = verifiedFormulaModel.formulas.find((formula) => formula.expression === "\\sigma = \\frac{F_{N}}{A}");
  if (correctedAxial?.verification_status !== "corrected" || !correctedAxial.original_expression.includes("A F_N")) {
    throw new Error(`Formula verifier did not preserve corrected OCR evidence: ${JSON.stringify(correctedAxial)}`);
  }
  if (!verifiedFormulaModel.formulas.every((formula) => formula.reference_match?.sources?.length && formula.external_source_refs?.length)) {
    throw new Error("Verified formulas did not retain reference source metadata");
  }
  const extraFormulaChecks = [
    {
      course: "高等数学",
      text: "高数公式：梯度 ∇f = <f_x, f_y, f_z>。概率二项分布 P(X=k)=C_n^k p^k(1-p)^(n-k)。",
      expected: ["\\nabla f = \\langle f_x, f_y, f_z \\rangle", "P(X = k) = C_{n}^k p^{k} (1-p)^{n-k}"],
    },
    {
      course: "大学物理",
      text: "物理公式：电磁感应 E = -N dPhi_B/dt。热力学第一定律 Delta U = Q - W。",
      expected: ["\\mathcal{E} = -N \\frac{d \\Phi_{B}}{d t}", "\\Delta U = Q - W"],
    },
    {
      course: "化学",
      text: "化学公式：缓冲溶液 pH = pKa + log([A-]/[HA])。溶度积 Ksp = [M]^n [X]^m。",
      expected: ["pH = pK_{a} + \\log([A^-]/[HA])", "K_{sp} = [M^{m+}]^n [X^{n-}]^m"],
    },
    {
      course: "生物学",
      text: "生物公式：遗传平衡 p^2 + 2pq + q^2 = 1。种群增长 dN/dt = rN(1-N/K)。",
      expected: ["p^{2} + 2 p q + q^{2} = 1", "\\frac{dN}{dt} = r N \\frac{K-N}{K}"],
    },
  ];
  for (const item of extraFormulaChecks) {
    const model = buildCourseKnowledgeModel(
      { id: `course_formula_${item.course}`, name: item.course },
      [{ id: `doc_formula_${item.course}`, originalName: `${item.course}.txt`, type: "txt", text: item.text, units: [{ label: "全文", text: item.text }] }],
    );
    const expressions = model.formulas.map((formula) => formula.expression);
    for (const expected of item.expected) {
      if (!expressions.includes(expected)) {
        throw new Error(`${item.course} formula verifier missed ${expected}: ${expressions.join("; ")}`);
      }
    }
    if (!model.formulas.every((formula) => formula.reference_match?.sources?.length && formula.external_source_refs?.length)) {
      throw new Error(`${item.course} formulas missed reference metadata`);
    }
  }

  const theoryModel = buildCourseKnowledgeModel(
    { id: "course_theory", name: "理论力学" },
    [
      {
        id: "doc_theory",
        originalName: "理论力学复习.txt",
        type: "txt",
        text: "静力学要求会画受力图并列平衡方程。刚体平面运动重点掌握瞬心法。动力学部分重点是动量矩定理、动能定理、达朗贝尔原理和虚位移原理。",
        units: [
          {
            label: "全文",
            text: "静力学要求会画受力图并列平衡方程。刚体平面运动重点掌握瞬心法。动力学部分重点是动量矩定理、动能定理、达朗贝尔原理和虚位移原理。",
          },
        ],
      },
    ],
  );
  const theoryNames = theoryModel.concepts.map((concept) => concept.name);
  for (const expectedConcept of ["平衡方程", "刚体平面运动", "动量矩定理", "达朗贝尔原理", "虚位移原理"]) {
    if (!theoryNames.includes(expectedConcept)) throw new Error(`Theoretical mechanics detector missed ${expectedConcept}: ${theoryNames.join(", ")}`);
  }

  const structuralModel = buildCourseKnowledgeModel(
    { id: "course_structure", name: "结构力学" },
    [
      {
        id: "doc_structure",
        originalName: "结构力学复习.txt",
        type: "txt",
        text: "结构力学期末重点：结构位移计算使用虚力法和图乘法，超静定结构重点掌握力法、位移法和力矩分配法，移动荷载章节考影响线，矩阵位移法掌握单元刚度矩阵。",
        units: [
          {
            label: "全文",
            text: "结构力学期末重点：结构位移计算使用虚力法和图乘法，超静定结构重点掌握力法、位移法和力矩分配法，移动荷载章节考影响线，矩阵位移法掌握单元刚度矩阵。",
          },
        ],
      },
    ],
  );
  const structuralNames = structuralModel.concepts.map((concept) => concept.name);
  for (const expectedConcept of ["结构位移计算", "力法", "位移法", "影响线", "矩阵位移法"]) {
    if (!structuralNames.includes(expectedConcept)) throw new Error(`Structural mechanics detector missed ${expectedConcept}: ${structuralNames.join(", ")}`);
  }

  const questionResult = generateQuestionSet(courseModel, { count: 18 });
  const richQuestions = questionResult.questions;
  const richTypes = new Set(richQuestions.map((question) => question.question_type));
  for (const type of [
    "concept_understanding",
    "formula_application",
    "calculation",
    "derivation_proof",
    "mistake_diagnosis",
    "exam_practice",
    "textbook_exercise",
    "variant",
    "comprehensive",
    "subjective_recall",
  ]) {
    if (!richTypes.has(type)) throw new Error(`Question generator missed type: ${type}`);
  }
  if (!richQuestions.some((question) => question.tags?.includes("考试题型库"))) {
    throw new Error("Question generator missed local exam-practice library questions");
  }
  if (!richQuestions.some((question) => question.tags?.includes("教材习题库"))) {
    throw new Error("Question generator missed local textbook exercise questions");
  }
  if (!courseModel.learning_pack?.drill_templates?.length) {
    throw new Error("Course model missed import-time learning pack drill templates");
  }
  if (!richQuestions.some((question) => question.tags?.includes("增量知识包"))) {
    throw new Error("Question generator did not consume learning-pack drills");
  }
  const apiContext = buildApiStudyContext(courseModel, sample.documents, { conceptLimit: 8, formulaLimit: 8, problemLimit: 8 });
  const apiContextObject = JSON.parse(apiContext);
  if (
    !apiContextObject.concepts?.length ||
    !apiContextObject.formulas?.length ||
    !apiContextObject.problems?.length ||
    !apiContextObject.evidence?.length ||
    !apiContextObject.learning_pack?.summary_text ||
    !apiContextObject.learning_pack?.drill_templates?.length
  ) {
    throw new Error(`API study context missed structured signals: ${apiContext.slice(0, 900)}`);
  }
  if (!apiContextObject.formulas.some((formula) => String(formula.expression || "").includes("\\frac"))) {
    throw new Error(`API study context did not preserve wrapped formulas: ${JSON.stringify(apiContextObject.formulas)}`);
  }
  const parsedLooseJson = parseJsonFromModel(`下面是题目 JSON：\n{"questions":[{"question_type":"calculation","question_text":"用公式求解","answer":"先判断条件。"}]}\n请查收。`);
  if (!Array.isArray(parsedLooseJson.questions) || parsedLooseJson.questions[0].question_type !== "calculation") {
    throw new Error("Loose API JSON parsing failed");
  }
  const normalizedApiQuestionFromContext = normalizeApiQuestion(
    {
      question_type: "formula_application",
      difficulty: "hard",
      question_text: "判断 $\\sigma = \\frac{F_N}{A}$ 的适用条件。",
      answer: "先确认轴向拉压、截面和远离集中力作用区。",
      related_concepts: ["轴向拉压", "应力"],
      source_refs: courseModel.formulas[0].source_refs,
      step_by_step_solution: ["识别公式", "检查适用条件", "说明误用风险"],
      common_mistakes: ["把外力直接当轴力"],
      grading_rubric: ["条件", "变量", "误用"],
      tags: ["公式", "适用条件"],
    },
  );
  if (
    normalizedApiQuestionFromContext.question_type !== "formula_application" ||
    normalizedApiQuestionFromContext.type !== "blank" ||
    !normalizedApiQuestionFromContext.sourceRefs.length ||
    !normalizedApiQuestionFromContext.sourceDocumentIds.length
  ) {
    throw new Error(`API question normalization failed: ${JSON.stringify(normalizedApiQuestionFromContext)}`);
  }
  const librarySubjects = [
    {
      course: { id: "course_theory_questions", name: "理论力学" },
      text: "理论力学期末复习：受力图、平衡方程、摩擦、刚体平面运动、动能定理、动量矩定理、达朗贝尔原理和虚位移原理都是考试题。",
      expectedProfile: "theoretical_mechanics",
    },
    {
      course: { id: "course_struct_questions", name: "结构力学" },
      text: "结构力学复习：几何组成分析、结构位移计算、力法、位移法、影响线和矩阵位移法需要大量习题训练。",
      expectedProfile: "structural_mechanics",
    },
    {
      course: { id: "course_elastic_questions", name: "弹性力学" },
      text: "弹性力学重点：平面应力问题、平面应变问题、应力平衡微分方程、几何方程、物理方程、Airy 应力函数、边界条件和孔边应力集中。",
      expectedProfile: "elasticity",
    },
    {
      course: { id: "course_fluid_questions", name: "流体力学" },
      text: "流体力学考试：流体静力学、连续性方程、伯努利方程、动量方程、雷诺数、沿程损失和局部损失。",
      expectedProfile: "fluid_mechanics",
    },
    {
      course: { id: "course_vibration_questions", name: "机械振动" },
      text: "机械振动复习：单自由度自由振动、阻尼振动、受迫振动、共振、多自由度振动和模态叠加。",
      expectedProfile: "vibration_mechanics",
    },
    {
      course: { id: "course_engineering_questions", name: "工程力学" },
      text: "工程力学综合复习：受力图、平面力系平衡、轴向拉压、梁弯曲、点的运动和动能定理。",
      expectedProfile: "engineering_mechanics",
    },
    {
      course: { id: "course_math_questions", name: "高等数学" },
      text: "高等数学复习：极限、导数、不定积分、定积分、多元函数微分、重积分、级数、微分方程、矩阵、特征值和概率分布。",
      expectedProfile: "advanced_mathematics",
    },
    {
      course: { id: "course_physics_questions", name: "大学物理" },
      text: "大学物理考试：匀变速直线运动、牛顿运动定律、动量守恒、机械能守恒、电场强度、高斯定理、电磁感应、热力学第一定律和波动光学。",
      expectedProfile: "college_physics",
    },
    {
      course: { id: "course_chem_questions", name: "化学" },
      text: "化学复习：物质的量、化学计量、理想气体状态方程、溶液浓度、化学平衡、酸碱平衡、氧化还原和电化学。",
      expectedProfile: "chemistry",
    },
    {
      course: { id: "course_bio_questions", name: "生物学" },
      text: "生物学复习：细胞结构、酶、光合作用、细胞呼吸、DNA复制、转录和翻译、孟德尔遗传、种群遗传和生态系统。",
      expectedProfile: "biology",
    },
  ];
  for (const subject of librarySubjects) {
    const subjectModel = buildCourseKnowledgeModel(subject.course, [
      {
        id: `${subject.course.id}_doc`,
        originalName: `${subject.course.name}复习.txt`,
        type: "txt",
        text: subject.text,
        units: [{ label: "全文", text: subject.text }],
      },
    ]);
    if (subjectModel.course.focus_profile.id !== subject.expectedProfile) {
      throw new Error(`${subject.course.name} profile mismatch: ${subjectModel.course.focus_profile.id}`);
    }
    const subjectQuestions = generateQuestionSet(subjectModel, { count: 12 }).questions;
    if (!subjectQuestions.some((question) => question.question_type === "exam_practice")) {
      throw new Error(`${subject.course.name} missed exam-practice library questions`);
    }
    if (!subjectQuestions.some((question) => question.question_type === "textbook_exercise")) {
      throw new Error(`${subject.course.name} missed textbook library questions`);
    }
    if (!subjectQuestions.every((question) => question.source_refs?.length && question.step_by_step_solution?.length)) {
      throw new Error(`${subject.course.name} library questions missed sources or steps`);
    }
  }
  if (!richQuestions.every((question) => question.source_refs?.length)) {
    throw new Error("Generated question missed source_refs");
  }
  if (!richQuestions.every((question) => question.step_by_step_solution?.length && question.grading_rubric?.length)) {
    throw new Error("Generated question missed steps or rubric");
  }
  const evaluation = evaluateQuestionSet(richQuestions, courseModel);
  if (!evaluation.checks.source_refs || !evaluation.checks.answer_and_steps) {
    throw new Error(`Question quality evaluation failed: ${JSON.stringify(evaluation.checks)}`);
  }
  const duplicateEval = evaluateQuestionSet([richQuestions[0], richQuestions[0]], courseModel);
  if (!duplicateEval.duplicates.length) throw new Error("Duplicate question detection failed");

  const mindMap = generateMindMap(courseModel);
  if (!mindMap.nodes.some((node) => node.type === "formula")) throw new Error("Mindmap missed formula nodes");
  if (!mindMap.nodes.some((node) => node.type === "mistake_point")) throw new Error("Mindmap missed mistake nodes");
  if (!mindMap.edges.some((edge) => edge.relation === "belongs_to")) throw new Error("Mindmap missed belongs_to edges");
  if (!mindMap.cardDeck?.cards?.length) throw new Error("Mindmap missed knowledge cards");
  if (!mindMap.cardDeck.visual_plan?.lead_cards?.length) throw new Error("Mindmap missed visual lead cards");
  if ((mindMap.cardDeck.visual_plan?.study_path || []).length < 4) throw new Error("Mindmap missed visual study path");
  if (!mindMap.cardDeck.visual_plan?.concept_cloud?.length) throw new Error("Mindmap missed visual concept cloud");
  if ((mindMap.cardDeck.lanes.find((lane) => lane.id === "concept")?.cards.length || 0) > 6) {
    throw new Error("Knowledge card deck retained too many concept cards");
  }
  const cardKinds = new Set(mindMap.cardDeck.cards.map((card) => card.kind));
  for (const kind of ["concept", "formula", "mistake"]) {
    if (!cardKinds.has(kind)) throw new Error(`Knowledge card deck missed ${kind} cards`);
  }
  if (mindMap.cardDeck.cards.some((card) => /^第\s*\d+\s*页$/.test(card.title))) {
    throw new Error(`Knowledge cards fell back to page summaries: ${mindMap.cardDeck.cards.map((card) => card.title).join(", ")}`);
  }
  if (!mindMap.mermaid.includes("graph TD")) throw new Error("Mindmap Mermaid export failed");

  const planGenerator = new StudyPlanGenerator(courseModel, richQuestions);
  const planFar = planGenerator.generate({
    today: "2026-05-01",
    examDate: "2026-05-20",
    dailyMinutes: 90,
    currentMastery: { [courseModel.chapters[0].chapter_id]: 0.2 },
  });
  const planNear = planGenerator.generate({
    today: "2026-05-01",
    examDate: "2026-05-03",
    dailyMinutes: 60,
    currentMastery: { [courseModel.chapters[0].chapter_id]: 0.2 },
  });
  if (!planFar.days.length || !planFar.diagnosticTest?.question_ids?.length) {
    throw new Error("Study plan did not generate daily tasks or diagnostic test");
  }
  if (planNear.mode !== "cramming") throw new Error("Study plan did not enter cramming mode near exam date");
  if (planFar.days[0].total_minutes !== 90 || planNear.days[0].total_minutes !== 60) {
    throw new Error("Study plan did not respect daily minutes");
  }
  if (!planFar.items.some((item) => item.sourceRefs?.some((ref) => ref.document_id && Number.isInteger(Number(ref.unit_index))))) {
    throw new Error("Study plan items did not expose precise sourceRefs");
  }

  const publicWorkspace = publicState({
    version: 1,
    courses: [course],
    documents: [
      {
        id: "doc_outline",
        courseId: course.id,
        originalName: "outline.pdf",
        type: "pdf",
        mimeType: "application/pdf",
        size: 128,
        text: "## 第 1 页\n2 - 1、轴向拉压\n例题 1：求正应力。",
        units: [{ label: "第 1 页", text: "2 - 1、轴向拉压\n例题 1：求正应力。" }],
        keywords: ["轴向拉压"],
        parseQuality: { level: "good", score: 88, counts: { chapters: 1, concepts: 1, formulas: 0, examples: 1 } },
        learningPack: courseModel.documents[0]?.learning_pack,
      },
    ],
    mistakes: [{ id: "mistake_workspace", courseId: course.id, mastered: false }],
    sessions: [{ id: "session_workspace", courseId: course.id }],
    questionProgress: [],
    settings: { provider: "api", apiBaseUrl: "", apiKey: "secret", model: "" },
  });
  const workspaceCourse = publicWorkspace.workspace?.courses?.[0];
  const workspaceDoc = publicWorkspace.workspace?.documents?.[0];
  if (publicWorkspace.settings.apiKey !== "__SET__") throw new Error("Public state leaked API key status incorrectly");
  if (publicWorkspace.workspace.providerLabel !== "API 增强版") throw new Error("Workspace provider label failed");
  if (workspaceCourse?.stats?.documents !== 1 || workspaceCourse.stats.unmasteredMistakes !== 1 || workspaceCourse.stats.sessions !== 1) {
    throw new Error(`Workspace course stats failed: ${JSON.stringify(workspaceCourse?.stats)}`);
  }
  if (!workspaceCourse?.stats?.learningPacks || !workspaceDoc?.learningPack?.coverage?.drillTemplates) {
    throw new Error(`Workspace learning pack stats failed: ${JSON.stringify({ course: workspaceCourse?.stats, doc: workspaceDoc?.learningPack })}`);
  }
  if (!workspaceDoc?.outline?.landmarks?.some((item) => item.type === "example")) {
    throw new Error(`Workspace document outline missed example anchor: ${JSON.stringify(workspaceDoc?.outline)}`);
  }

  const tempSecretDir = await fsp.mkdtemp(path.join(os.tmpdir(), "stem-review-secret-"));
  try {
    const secretPath = path.join(tempSecretDir, "api-key.json");
    const apiKeyStore = createApiKeyStore({ filePath: secretPath });
    await apiKeyStore.saveApiKey("super-secret-key");
    if (apiKeyStore.getApiKey() !== "super-secret-key") {
      throw new Error("API key store failed to read back saved key");
    }
    const storedSecret = JSON.parse(fs.readFileSync(secretPath, "utf8"));
    if (storedSecret.apiKey !== "super-secret-key") {
      throw new Error("API key store wrote an unexpected payload");
    }
    await apiKeyStore.clearApiKey();
    if (apiKeyStore.hasApiKey()) {
      throw new Error("API key store failed to clear key");
    }
    if (fs.existsSync(secretPath)) {
      throw new Error("API key store did not remove the secret file");
    }
  } finally {
    await fsp.rm(tempSecretDir, { recursive: true, force: true });
  }

  const solved = localSolveQuestion(
    course,
    docs,
    { question: "简支梁跨中集中力 P，求最大弯矩并说明弯曲正应力校核入口。" },
    courseModel,
  );
  if (!solved.steps?.length || !solved.answer || !solved.reviewCards?.length || !solved.quality?.checks?.has_steps) {
    throw new Error(`Local solution output shape failed: ${JSON.stringify(solved)}`);
  }
  if (!solved.quality.checks.has_answer || !solved.quality.checks.has_review_memory) {
    throw new Error(`Local solution quality checks failed: ${JSON.stringify(solved.quality)}`);
  }

  const normalizedApiQuestion = normalizeApiQuestion({
    question_id: "api_q_1",
    stem: "已知直杆轴力 F_N，求横截面正应力。",
    answer: "\\sigma = F_N / A",
    steps: ["识别轴向拉压题。", "确定截面面积 A。", "代入正应力公式。"],
    sourceRefs: [
      {
        documentId: "doc_1",
        fileName: "sample.pptx",
        unitIndex: 0,
        unitLabel: "第 1 页",
        locatorLabel: "轴向拉压",
        anchorText: "横截面正应力公式",
      },
    ],
  });
  if (normalizedApiQuestion.question_text !== normalizedApiQuestion.stem || normalizedApiQuestion.question_id !== "api_q_1") {
    throw new Error(`API question stem compatibility failed: ${JSON.stringify(normalizedApiQuestion)}`);
  }
  if (normalizedApiQuestion.answer !== "\\sigma = F_N / A" || normalizedApiQuestion.step_by_step_solution.length !== 3) {
    throw new Error(`API question answer/steps normalization failed: ${JSON.stringify(normalizedApiQuestion)}`);
  }
  if (!normalizedApiQuestion.sourceRefs.some((ref) => ref.document_id === "doc_1" && ref.unit_index === 0)) {
    throw new Error(`API question sourceRefs normalization failed: ${JSON.stringify(normalizedApiQuestion.sourceRefs)}`);
  }
  if (!normalizedApiQuestion.sourceDocumentIds.includes("doc_1")) {
    throw new Error(`API question sourceDocumentIds compatibility failed: ${JSON.stringify(normalizedApiQuestion)}`);
  }

  const pptSkillPrompt = aiPptTeachingSkillPrompt();
  const pptSkillRequest = pptTeachingSummaryRequest("材料力学", { nodes: 8, edges: 7 });
  for (const required of ["ppt_zero_to_mastery_v1", "从 0 学会", "掌握标准", "复习记忆", "直接阅读图片"]) {
    if (!pptSkillPrompt.includes(required)) throw new Error(`PPT teaching skill prompt missed: ${required}`);
  }
  for (const required of ["先修知识", "学习主线", "掌握检测", "可固化复习记忆"]) {
    if (!pptSkillRequest.includes(required)) throw new Error(`PPT teaching skill request missed: ${required}`);
  }

  const solutionSkillPrompt = aiSolutionSkillPrompt();
  const solutionRequest = solutionSkillRequest("材料力学", "简支梁跨中集中力 P，求最大弯矩。");
  for (const required of ["stem_exam_teacher_v1", "只输出 JSON 对象", "reviewCards", "sourceRefs", "固化记忆"]) {
    if (!solutionSkillPrompt.includes(required)) throw new Error(`Solution skill prompt missed: ${required}`);
  }
  if (!solutionRequest.includes("stem_exam_teacher_v1") || !solutionRequest.includes("reviewCards")) {
    throw new Error(`Solution skill request missed memory contract: ${solutionRequest}`);
  }

  console.log("core tests ok");
})();
