const ASSISTANT_SKILLS = [
  {
    id: "teach_materials",
    label: "从 0 教课件",
    outputFocus: [
      "先建立直觉，再补先修知识。",
      "按知识主线讲清概念、公式适用条件、题型入口和掌握检测。",
      "不要大段复制原文，要把课件重组为可复现的学习路径。",
    ],
    artifactTypes: ["lesson", "memory_card", "drill_set"],
    sourceRefs: {
      required: true,
      policy: "优先引用课件页、PDF 页或文本片段，必须保留 document_id、unit_index、unit_label。",
    },
    harness: {
      requiredArtifactTypes: ["lesson"],
      keywordGroups: ["requiredSections", "conceptTerms", "formulaTerms"],
      minimumSourceRefs: 1,
    },
  },
  {
    id: "solve_homework",
    label: "解析作业/题目",
    outputFocus: [
      "必须包含题型入口、已知-所求、关键公式、分步推导和答案校核。",
      "写清公式使用前提、单位检查、易错点和同类题练习。",
      "如果资料中有作业图、PDF 页或题干，直接阅读并结合课程资料作答。",
    ],
    artifactTypes: ["solution", "drill_set", "memory_card"],
    sourceRefs: {
      required: true,
      policy: "引用讲义、题干、图片或 PDF 资料中支撑公式和条件判断的片段。",
    },
    harness: {
      requiredArtifactTypes: ["solution"],
      keywordGroups: ["relatedConcepts", "formulaTerms"],
      minimumSourceRefs: 1,
    },
  },
  {
    id: "final_review",
    label: "期末复习",
    outputFocus: [
      "必须给出重点排序、薄弱点、复习顺序、限时练习和最后检查表。",
      "把历史对话、已保存档案和当前全部资料整合为一条可执行复习路线。",
      "优先服务考前提分，不展开无关背景。",
    ],
    artifactTypes: ["review_plan", "drill_set", "memory_card"],
    sourceRefs: {
      required: true,
      policy: "引用支撑重点排序、薄弱点判断和练习来源的资料片段。",
    },
    harness: {
      requiredArtifactTypes: ["review_plan"],
      keywordGroups: ["conceptTerms", "formulaTerms", "requiredSections"],
      minimumSourceRefs: 1,
    },
  },
];

const SKILL_BY_ID = new Map(ASSISTANT_SKILLS.map((skill) => [skill.id, skill]));

function getAssistantSkill(intent) {
  return SKILL_BY_ID.get(intent) || SKILL_BY_ID.get("teach_materials");
}

function assistantSkillIds() {
  return ASSISTANT_SKILLS.map((skill) => skill.id);
}

module.exports = {
  ASSISTANT_SKILLS,
  assistantSkillIds,
  getAssistantSkill,
};
