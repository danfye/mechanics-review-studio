const { createAssistantService } = require("../lib/server/assistant-service.cjs");

const assistant = createAssistantService({
  fsp: require("node:fs/promises"),
  uploadPath: (name) => name,
  callChatApi: async () => "{}",
});

const samples = [
  ["把这份 PPT 从零教会我", "teach_materials"],
  ["这张作业图怎么解，求完整步骤", "solve_homework"],
  ["根据所有资料安排期末复习", "final_review"],
];

for (const [message, expected] of samples) {
  const actual = assistant.inferIntent({ message });
  if (actual !== expected) throw new Error(`intent mismatch: ${message} -> ${actual}, expected ${expected}`);
  console.log(`${message}: ${actual}`);
}

console.log("API 助教版不再运行旧本地题库准确率报告；真实质量请使用 API 对话链路验证。");
