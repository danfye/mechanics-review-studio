const path = require("node:path");
const os = require("node:os");
const { extractChatCompletionContent } = require("../lib/server/api-client.cjs");
const { defaultApiKeyPath } = require("../lib/server/api-key-store.cjs");
const { createAuthService } = require("../lib/server/auth-service.cjs");
const { createWebAuthConfig } = require("../lib/server/web-auth-config.cjs");
const { createRuntimeRequire } = require("../lib/server/runtime-require.cjs");
const { createMaterialService } = require("../lib/server/material-service.cjs");
const { createAssistantService } = require("../lib/server/assistant-service.cjs");
const { createDbTemplate, publicState } = require("../server.cjs");

const runtimeRequire = createRuntimeRequire(path.join(__dirname, ".."));

async function makePptx() {
  const JSZip = runtimeRequire("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types></Types>');
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree><p:sp><p:txBody>
        <a:p><a:r><a:t>材料力学 轴向拉压</a:t></a:r></a:p>
        <a:p><a:r><a:t>正应力 sigma = F_N / A，伸长量 delta = F L / E A。</a:t></a:r></a:p>
        <p:pic><p:nvPicPr><p:cNvPr id="4" name="diagram" descr="图示：直杆轴向拉伸，截面 A 承受轴力 F_N"/></p:nvPicPr></p:pic>
      </p:txBody></p:sp></p:spTree></p:cSld>
    </p:sld>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

(async () => {
  const materialService = createMaterialService({
    fsp: require("node:fs/promises"),
    runtimeRequire,
    uploadDir: path.join(__dirname, "..", "data", "uploads"),
  });
  const pptx = await materialService.extractMaterial(await makePptx(), "sample.pptx", "");
  if (pptx.kind !== "pptx" || !pptx.text.includes("轴向拉压") || !pptx.units.length) {
    throw new Error(`PPTX extraction failed: ${JSON.stringify(pptx).slice(0, 300)}`);
  }

  const text = await materialService.extractMaterial(Buffer.from("例题：已知杆件受拉力 F，求正应力。", "utf8"), "homework.txt", "text/plain");
  if (text.kind !== "text" || !text.units.length || !text.text.includes("正应力")) {
    throw new Error("text extraction failed");
  }

  const assistant = createAssistantService({
    fsp: require("node:fs/promises"),
    uploadPath: (name) => name,
    callChatApi: async () => "{}",
  });
  if (assistant.inferIntent({ message: "这张作业图怎么解" }) !== "solve_homework") throw new Error("solve intent failed");
  if (assistant.inferIntent({ message: "给我期末冲刺计划" }) !== "final_review") throw new Error("review intent failed");
  try {
    assistant.assertApiReady({ apiBaseUrl: "", apiKey: "", model: "" });
    throw new Error("missing API config was not blocked");
  } catch (error) {
    if (!String(error.message).includes("API 助教需要完整配置")) throw error;
  }

  const db = createDbTemplate();
  db.settings = { provider: "api", apiBaseUrl: "https://example.test/v1", model: "model", apiKey: "secret" };
  const state = publicState(db);
  if (!state.apiConfigured || state.settings.apiKey !== "__SET__") throw new Error("public state API redaction failed");

  if (!defaultApiKeyPath().startsWith(os.userInfo().homedir)) {
    throw new Error("API key path must use the real user home, not a preview HOME override");
  }

  const streamed = [
    'data: {"choices":[{"delta":{"content":"{\\\"answer_markdown\\\":"}}]}',
    'data: {"choices":[{"delta":{"content":"\\\"可以回答\\\"}"}}]}',
    "data: [DONE]",
  ].join("\n\n");
  if (extractChatCompletionContent(streamed) !== '{"answer_markdown":"可以回答"}') {
    throw new Error("SSE chat completion parsing failed");
  }

  const katex = runtimeRequire("katex");
  const renderedFormula = katex.renderToString("\\tau_w=\\mu \\frac{3U}{2\\delta}", {
    displayMode: true,
    throwOnError: false,
    strict: "ignore",
  });
  if (!renderedFormula.includes("katex") || renderedFormula.includes("katex-error")) {
    throw new Error("KaTeX formula rendering failed");
  }

  const auth = createAuthService({ enabled: true, config: createWebAuthConfig("web-test-password") });
  if (!auth.verifyPassword("web-test-password")) throw new Error("web auth password verification failed");
  if (auth.verifyPassword("wrong-password")) throw new Error("web auth accepted wrong password");
  const cookie = auth.createSessionCookie();
  if (!auth.isAuthenticated({ headers: { cookie } })) throw new Error("web auth session verification failed");
  console.log("core ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
