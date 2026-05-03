const COURSE_FOCUS_VERSION = 1;
const GENERIC_NAMES = new Set(["应力", "正应力", "应变", "剪力", "弯矩", "平衡方程", "强度条件"]);

const COURSE_PROFILES = [
  {
    id: "material_mechanics",
    label: "材料力学",
    match: ["材料力学", "工程力学", "strength of materials", "mechanics of materials"],
    terms: [
      term("轴向拉压", ["拉压", "轴向拉伸", "轴向压缩", "拉伸与压缩", "轴向拉伸和压缩"], "basic_deformation", 88),
      term("轴力", ["F_N", "F N", "FN", "截面轴力"], "basic_deformation", 82),
      term("轴力图", ["画轴力图", "轴力沿杆轴线"], "basic_deformation", 80),
      term("截面法", ["截开", "取一段", "内力分析"], "method", 72),
      term("正应力", ["sigma", "σ", "拉压应力"], "stress_strain", 70, { generic: true }),
      term("应变", ["epsilon", "ε", "线应变"], "stress_strain", 62, { generic: true }),
      term("胡克定律", ["线弹性", "应力应变关系"], "stress_strain", 76),
      term("圣维南原理", ["圣维南", "局部效应", "等效加载"], "stress_strain", 74),
      term("强度条件", ["许用应力", "强度校核", "安全系数"], "strength", 82),
      term("材料力学性能", ["低碳钢", "屈服", "强化", "应力应变曲线", "铸铁"], "material_property", 70),
      term("剪切", ["剪应力互等", "剪切胡克定律"], "shear_torsion", 66),
      term("扭转", ["圆轴扭转", "扭矩", "扭矩图", "GJ"], "shear_torsion", 86),
      term("梁弯曲", ["弯曲内力", "直梁弯曲", "梁的弯曲"], "bending", 88),
      term("剪力", ["剪力图", "Q 图"], "bending", 76),
      term("弯矩", ["弯矩图", "M 图", "最大弯矩"], "bending", 84),
      term("弯曲正应力", ["弯曲应力", "中性轴", "惯性矩", "抗弯截面系数"], "bending", 88),
      term("梁的位移", ["挠度", "转角", "积分法", "叠加法"], "bending_deformation", 76),
      term("应力状态", ["主应力", "莫尔圆", "三向应力", "平面应力状态"], "stress_state", 86),
      term("强度理论", ["最大拉应力理论", "第三强度理论", "第四强度理论", "von Mises"], "stress_state", 84),
      term("组合变形", ["斜弯曲", "偏心压缩", "弯扭组合", "拉弯组合"], "combined", 82),
      term("能量法", ["应变能", "卡氏定理", "单位载荷法"], "energy", 72),
      term("超静定", ["静不定", "变形协调", "温度应力", "装配应力"], "indeterminate", 76),
      term("压杆稳定", ["稳定性", "临界载荷", "临界力", "欧拉公式", "柔度"], "stability", 88),
    ],
  },
  {
    id: "theoretical_mechanics",
    label: "理论力学",
    match: ["理论力学", "一般力学", "theoretical mechanics"],
    terms: [
      term("静力学公理", ["二力构件", "加减平衡力系", "作用反作用"], "statics", 84),
      term("约束反力", ["约束", "受力图", "受力分析"], "statics", 86),
      term("力系简化", ["力矩", "力偶", "主矢", "主矩"], "statics", 82),
      term("平衡方程", ["平面力系平衡", "空间力系平衡"], "statics", 86),
      term("摩擦", ["库仑摩擦", "摩擦角", "自锁"], "statics", 68),
      term("点的运动学", ["速度", "加速度", "自然坐标法", "直角坐标法"], "kinematics", 78),
      term("刚体基本运动", ["平移", "定轴转动", "角速度", "角加速度"], "kinematics", 78),
      term("刚体平面运动", ["瞬心", "基点法", "速度投影"], "kinematics", 84),
      term("动力学基本定律", ["牛顿定律", "质点动力学"], "dynamics", 78),
      term("动量定理", ["冲量", "质心运动定理"], "dynamics", 78),
      term("动量矩定理", ["角动量", "转动惯量", "定轴转动微分方程"], "dynamics", 84),
      term("动能定理", ["功", "势能", "机械能守恒"], "dynamics", 82),
      term("质心运动定理", ["质心", "质心加速度", "质心运动"], "dynamics", 76),
      term("达朗贝尔原理", ["惯性力", "动静法"], "analytical", 86),
      term("虚位移原理", ["虚功", "广义坐标", "理想约束"], "analytical", 86),
    ],
  },
  {
    id: "structural_mechanics",
    label: "结构力学",
    match: ["结构力学", "structural mechanics"],
    terms: [
      term("几何组成分析", ["几何不变体系", "瞬变体系", "自由度"], "structure_basis", 76),
      term("静定结构内力", ["静定梁", "静定刚架", "三铰拱", "桁架内力"], "static_structure", 82),
      term("结构位移计算", ["虚力法", "单位荷载法", "图乘法", "莫尔积分"], "displacement", 86),
      term("力法", ["多余约束", "正则方程", "超静定结构"], "indeterminate", 88),
      term("位移法", ["转角位移方程", "杆端弯矩", "结点位移"], "indeterminate", 88),
      term("力矩分配法", ["分配系数", "传递系数", "固端弯矩"], "indeterminate", 78),
      term("影响线", ["移动荷载", "最不利荷载位置"], "influence_line", 84),
      term("矩阵位移法", ["单元刚度矩阵", "坐标变换", "结构刚度矩阵"], "matrix", 86),
      term("结构动力计算", ["自振频率", "振型", "动力反应"], "dynamics", 72),
    ],
  },
  {
    id: "elasticity",
    label: "弹性力学",
    match: ["弹性力学", "弹塑性力学", "elasticity", "elastic mechanics"],
    terms: [
      term("平面应力问题", ["平面应力", "薄板", "σ_z=0"], "plane_problem", 86),
      term("平面应变问题", ["平面应变", "长柱体", "ε_z=0"], "plane_problem", 84),
      term("应力平衡微分方程", ["平衡微分方程", "体力", "面力边界"], "field_equation", 88),
      term("几何方程", ["位移应变关系", "小变形", "应变分量"], "field_equation", 76),
      term("物理方程", ["广义胡克定律", "本构方程", "弹性常数"], "field_equation", 78),
      term("应力函数", ["Airy", "艾里应力函数", "双调和方程"], "solution_method", 86),
      term("边界条件", ["位移边界", "应力边界", "混合边界"], "boundary", 82),
      term("孔边应力集中", ["圆孔", "应力集中系数", "Kirsch"], "application", 74),
    ],
  },
  {
    id: "fluid_mechanics",
    label: "流体力学",
    match: ["流体力学", "水力学", "fluid mechanics", "hydraulics"],
    terms: [
      term("流体静力学", ["静水压强", "压强分布", "压力体"], "hydrostatics", 82),
      term("连续性方程", ["质量守恒", "流量", "不可压缩"], "conservation", 88),
      term("伯努利方程", ["Bernoulli", "能量方程", "水头"], "conservation", 90),
      term("动量方程", ["动量守恒", "控制体", "冲力"], "conservation", 84),
      term("雷诺数", ["Re", "层流", "紊流", "湍流"], "pipe_flow", 82),
      term("沿程损失", ["Darcy", "达西公式", "摩阻系数"], "pipe_flow", 80),
      term("局部损失", ["局部阻力", "损失系数", "阀门"], "pipe_flow", 72),
      term("边界层", ["附面层", "分离", "阻力"], "viscous_flow", 70),
    ],
  },
  {
    id: "vibration_mechanics",
    label: "机械振动",
    match: ["机械振动", "振动力学", "工程振动", "mechanical vibration", "vibrations"],
    terms: [
      term("单自由度自由振动", ["自由振动", "固有频率", "周期"], "sdof", 88),
      term("阻尼振动", ["阻尼比", "欠阻尼", "临界阻尼"], "sdof", 84),
      term("受迫振动", ["简谐激励", "稳态响应", "频响函数"], "forced", 86),
      term("共振", ["幅频特性", "放大系数", "共振频率"], "forced", 86),
      term("多自由度振动", ["质量矩阵", "刚度矩阵", "振型"], "mdof", 82),
      term("模态叠加", ["正交性", "主坐标", "振型叠加"], "mdof", 76),
    ],
  },
  {
    id: "engineering_mechanics",
    label: "工程力学",
    match: ["工程力学", "engineering mechanics"],
    terms: [
      term("受力图", ["约束反力", "二力杆", "隔离体"], "statics", 86),
      term("平面力系平衡", ["ΣFx", "ΣFy", "ΣM", "力矩"], "statics", 88),
      term("轴向拉压", ["轴力", "正应力", "强度校核"], "strength", 82),
      term("梁弯曲", ["剪力图", "弯矩图", "弯曲应力"], "strength", 84),
      term("点的运动", ["速度", "加速度", "轨迹"], "kinematics", 74),
      term("动能定理", ["功", "机械能", "速度"], "dynamics", 78),
    ],
  },
  {
    id: "advanced_mathematics",
    label: "高等数学",
    match: ["高等数学", "高数", "数学分析", "微积分", "线性代数", "概率论", "mathematics", "calculus", "linear algebra", "probability"],
    terms: [
      term("极限", ["数列极限", "函数极限", "无穷小", "等价无穷小"], "calculus", 86),
      term("导数", ["微分", "切线", "单调性", "极值"], "calculus", 88),
      term("不定积分", ["原函数", "换元积分", "分部积分"], "calculus", 82),
      term("定积分", ["牛顿莱布尼茨", "积分上限函数", "面积"], "calculus", 86),
      term("多元函数微分", ["偏导数", "全微分", "方向导数", "梯度"], "multivariable", 84),
      term("重积分", ["二重积分", "三重积分", "换元", "极坐标"], "multivariable", 82),
      term("级数", ["数项级数", "幂级数", "收敛半径", "泰勒级数"], "series", 78),
      term("微分方程", ["一阶微分方程", "二阶常系数", "通解"], "ode", 76),
      term("矩阵", ["行列式", "秩", "逆矩阵", "初等变换"], "linear_algebra", 82),
      term("特征值", ["特征向量", "相似对角化", "二次型"], "linear_algebra", 78),
      term("概率分布", ["随机变量", "分布函数", "数学期望", "方差"], "probability", 76),
    ],
  },
  {
    id: "college_physics",
    label: "大学物理",
    match: ["大学物理", "普通物理", "物理学", "physics", "general physics", "college physics"],
    terms: [
      term("匀变速直线运动", ["速度公式", "位移公式", "加速度"], "mechanics", 78),
      term("牛顿运动定律", ["牛顿第二定律", "受力分析", "F=ma"], "mechanics", 88),
      term("动量守恒", ["冲量", "碰撞", "质心"], "mechanics", 84),
      term("机械能守恒", ["动能", "势能", "保守力"], "mechanics", 84),
      term("简谐振动", ["振幅", "角频率", "相位"], "oscillation", 80),
      term("电场强度", ["库仑定律", "高斯定理", "电势"], "electromagnetism", 86),
      term("电容", ["电容器", "介质", "储能"], "electromagnetism", 76),
      term("磁场", ["洛伦兹力", "安培力", "磁通量"], "electromagnetism", 82),
      term("电磁感应", ["法拉第定律", "楞次定律", "感应电动势"], "electromagnetism", 84),
      term("热力学第一定律", ["内能", "热量", "做功"], "thermal", 78),
      term("波动光学", ["干涉", "衍射", "光程差"], "optics", 74),
    ],
  },
  {
    id: "chemistry",
    label: "化学",
    match: ["化学", "大学化学", "无机化学", "有机化学", "物理化学", "chemistry", "general chemistry"],
    terms: [
      term("物质的量", ["摩尔", "摩尔质量", "阿伏伽德罗常数"], "stoichiometry", 84),
      term("化学计量", ["配平", "限量反应物", "产率"], "stoichiometry", 86),
      term("理想气体状态方程", ["PV=nRT", "气体常数"], "gas", 82),
      term("溶液浓度", ["物质的量浓度", "稀释", "滴定"], "solution", 80),
      term("化学平衡", ["平衡常数", "反应商", "勒夏特列原理"], "equilibrium", 86),
      term("酸碱平衡", ["pH", "pOH", "弱酸", "缓冲溶液"], "acid_base", 86),
      term("沉淀溶解平衡", ["溶度积", "Ksp", "离子积"], "equilibrium", 74),
      term("氧化还原", ["氧化数", "电子转移", "原电池"], "redox", 78),
      term("电化学", ["能斯特方程", "电极电势", "电解"], "electrochemistry", 76),
      term("化学热力学", ["焓变", "熵变", "吉布斯自由能"], "thermochemistry", 74),
    ],
  },
  {
    id: "biology",
    label: "生物学",
    match: ["生物", "生物学", "普通生物学", "细胞生物学", "遗传学", "biology", "genetics", "cell biology"],
    terms: [
      term("细胞结构", ["细胞膜", "细胞器", "细胞核"], "cell", 76),
      term("酶", ["酶活性", "底物", "最适温度", "最适 pH"], "biochemistry", 78),
      term("光合作用", ["光反应", "暗反应", "叶绿体"], "metabolism", 82),
      term("细胞呼吸", ["糖酵解", "三羧酸循环", "氧化磷酸化"], "metabolism", 82),
      term("DNA复制", ["半保留复制", "复制叉", "DNA 聚合酶"], "molecular", 80),
      term("转录和翻译", ["mRNA", "密码子", "核糖体"], "molecular", 82),
      term("孟德尔遗传", ["分离定律", "自由组合定律", "基因型", "表现型"], "genetics", 86),
      term("种群遗传", ["基因频率", "Hardy-Weinberg", "遗传平衡"], "genetics", 72),
      term("生态系统", ["能量流动", "物质循环", "食物网"], "ecology", 70),
    ],
  },
];

function term(name, aliases, group, priority, options = {}) {
  return {
    name,
    aliases: [name, ...(aliases || [])],
    group,
    priority,
    generic: Boolean(options.generic || GENERIC_NAMES.has(name)),
  };
}

function compact(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactKey(value) {
  return compact(value).replace(/\s+/g, "").toLowerCase();
}

function detectCourseProfile(context = {}) {
  const haystack = compactKey(
    [context.courseName, context.documentName, context.chapterTitle, context.text].filter(Boolean).join("\n").slice(0, 6000),
  );
  const scored = COURSE_PROFILES.map((profile) => {
    let score = 0;
    for (const marker of profile.match || []) {
      if (haystack.includes(compactKey(marker))) score += 80;
    }
    for (const item of profile.terms) {
      if (item.aliases.some((alias) => haystack.includes(compactKey(alias)))) score += Math.max(2, Math.floor(item.priority / 24));
    }
    return { profile, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].profile : COURSE_PROFILES[0];
}

function detectConceptCandidates(textValue, context = {}) {
  const text = compact(textValue);
  if (!text) return [];
  const activeProfile = context.profile || detectCourseProfile({ ...context, text: `${context.text || ""}\n${text}` });
  const profiles = activeProfile ? [activeProfile] : COURSE_PROFILES;
  const candidates = [];
  for (const profile of profiles) {
    for (const item of profile.terms) {
      const hits = matchingAliases(text, item.aliases);
      if (!hits.length) continue;
      const evidence = evidenceScore(text, hits);
      let score = item.priority + evidence.score + Math.min(18, hits.length * 5);
      if (item.generic && evidence.score < 14) score -= 26;
      if (context.chapterTitle && matchingAliases(context.chapterTitle, item.aliases).length) score += 12;
      if (context.courseName && compactKey(context.courseName).includes(compactKey(profile.label))) score += 8;
      const minScore = item.generic ? 68 : 42;
      if (score < minScore) continue;
      candidates.push({
        name: item.name,
        aliases: hits,
        group: item.group,
        profile_id: profile.id,
        profile_label: profile.label,
        syllabus_priority: item.priority,
        evidence_score: evidence.score,
        score,
        generic: item.generic,
        reasons: evidence.reasons,
      });
    }
  }
  return suppressGenericCandidates(uniqueCandidateObjects(candidates)).sort((a, b) => b.score - a.score || b.syllabus_priority - a.syllabus_priority);
}

function matchingAliases(text, aliases = []) {
  const normalizedText = compactKey(text);
  return uniqueStrings(
    aliases.filter((alias) => {
      const key = compactKey(alias);
      if (!key) return false;
      if (/^[a-z_{}\\]+$/i.test(key)) return latinSymbolHit(text, alias);
      return normalizedText.includes(key);
    }),
  );
}

function latinSymbolHit(text, alias) {
  const escaped = String(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(text);
}

function evidenceScore(text, hits) {
  const windows = hits.map((hit) => contextWindow(text, hit, 110)).filter(Boolean);
  const joined = windows.join(" ");
  const reasons = [];
  let score = 0;
  if (/重点|难点|考试|考点|掌握|熟练|要求|必须|会|能够/.test(joined)) {
    score += 18;
    reasons.push("教学要求信号");
  }
  if (/公式|条件|适用|推导|计算|校核|判断|求|作图|证明/.test(joined)) {
    score += 18;
    reasons.push("计算或公式信号");
  }
  if (/例题|习题|作业|思考题|题目|问题|练习/.test(joined)) {
    score += 16;
    reasons.push("题目入口信号");
  }
  if (/[=≈≤≥∑Σ∫√]|\\(?:frac|sqrt|sigma|tau|Delta|varepsilon)|σ|τ|ε|Δ|F_N|EI|EA|GJ|Pcr|M\s*=/.test(joined)) {
    score += 18;
    reasons.push("公式符号信号");
  }
  if (/易错|注意|不能|不可|不适用|危险|单位|正负号|混淆/.test(joined)) {
    score += 14;
    reasons.push("易错信号");
  }
  if (/定义|概念|原理|定理|假设|方法|步骤|规律/.test(joined)) {
    score += 10;
    reasons.push("概念定义信号");
  }
  return { score, reasons: reasons.length ? uniqueStrings(reasons) : ["术语命中"] };
}

function contextWindow(text, hit, radius = 100) {
  const index = compactKey(text).indexOf(compactKey(hit));
  if (index < 0) return "";
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + String(hit).length + radius));
}

function uniqueCandidateObjects(candidates) {
  const byName = new Map();
  for (const candidate of candidates) {
    const key = compactKey(candidate.name);
    const existing = byName.get(key);
    if (!existing || candidate.score > existing.score) {
      byName.set(key, {
        ...candidate,
        aliases: uniqueStrings([...(existing?.aliases || []), ...(candidate.aliases || [])]),
        reasons: uniqueStrings([...(existing?.reasons || []), ...(candidate.reasons || [])]),
      });
    } else {
      existing.aliases = uniqueStrings([...(existing.aliases || []), ...(candidate.aliases || [])]);
      existing.reasons = uniqueStrings([...(existing.reasons || []), ...(candidate.reasons || [])]);
    }
  }
  return [...byName.values()];
}

function suppressGenericCandidates(candidates) {
  return candidates.filter((candidate) => {
    if (!candidate.generic) return true;
    const strongerSpecific = candidates.some(
      (other) =>
        other.name !== candidate.name &&
        other.group === candidate.group &&
        !other.generic &&
        other.score >= candidate.score - 8 &&
        (other.name.includes(candidate.name) || candidate.name.includes(other.name) || other.score >= 86),
    );
    return !strongerSpecific || candidate.score >= 92;
  });
}

function scoreConceptImportance(concept = {}) {
  let score = Number(concept.importance_score || 0);
  score += Number(concept.exam_focus?.score || 0) * 0.7;
  score += Number(concept.syllabus_priority || 0) * 0.8;
  score += Number(concept.selection_score || 0) * 0.95;
  score += Number(concept.evidence_score || 0) * 0.8;
  score += (concept.source_refs || []).length * 8;
  if (concept.description && concept.description !== "unknown") score += 12;
  if (concept.exam_focus?.level === "high") score += 12;
  const evidenceCounts = concept.evidence_counts || {};
  const anchoredSignals =
    Number(evidenceCounts.definition_sentences || 0) +
    Number(evidenceCounts.formulas_near || 0) +
    Number(evidenceCounts.problem_anchors || 0) +
    Number(evidenceCounts.rules || 0) +
    Number(evidenceCounts.mistakes || 0);
  if (anchoredSignals >= 2) score += 24;
  else if (anchoredSignals === 1) score += 10;
  if (concept.candidate_confidence === "high") score += 18;
  if (concept.candidate_confidence === "medium") score += 8;
  if (GENERIC_NAMES.has(concept.name) && score < 150) score -= 22;
  return Math.round(score);
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const text = compact(value);
    const key = compactKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

module.exports = {
  COURSE_FOCUS_VERSION,
  COURSE_PROFILES,
  detectCourseProfile,
  detectConceptCandidates,
  scoreConceptImportance,
};
