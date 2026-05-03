# 力学复习台

这是一个本地优先的期末复习助手基础版，面向工科/力学课程，并扩展支持数学、物理、化学、生物等基础理科课程。

## 第一版能力

- 按科目管理资料。
- 导入 `.pptx`、`.pdf`、`.txt`、`.md` 和常见图片文件。
- 支持直接粘贴纯文字例题导入，并在资料列表中继续修改题目文本。
- 从文本型 PPTX/PDF 中抽取文字，PPTX 会尽量保留 Office 公式对象和常见物理符号。
- 内置 87 条参考公式，覆盖工程力学、大学物理、化学、高等数学和生物学，并保留适用条件、常见误用和开放参考来源。
- 本地规则生成知识地图、复习提纲、题目、错题本和资料问答。
- 内置本地考试题型库和教材习题风格库，覆盖材料力学、理论力学、结构力学、弹性力学、流体力学、机械振动、工程力学综合、高等数学、大学物理、化学和生物学；刷题时不只依赖概念卡，也会补充常见大题、计算题、实验设计题和分步骤训练题。
- 按资料章节/专题、错题和已完成 sessions 生成期末复习计划，并推荐下一步复盘内容。
- 生成考前冲刺包，汇总科目下的资料、错题和复盘记录，输出优先专题、必背公式、易错清单和限时题。
- 可选填写 OpenAI-compatible API 配置，用 API 增强总结、出题和问答。

## 启动

```bash
npm install
npm start
```

然后打开：

```text
http://127.0.0.1:4173
```

如果当前终端没有可用的 `npm`，也可以直接运行：

```bash
/Users/shanfengye/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.cjs
```

## 测试

无需启动网页服务的核心测试：

```bash
npm run test:core
```

启动服务后可运行接口烟测：

```bash
npm run smoke
```

## 打包给朋友体验

先在本机项目目录生成体验包：

```bash
npm install
npm run package:share
```

生成结果：

- `dist/mechanics-review-studio-share/`：可直接打开的体验包目录。
- `dist/mechanics-review-studio-share.zip`：可发给朋友的压缩包。

体验包会带上生产依赖和启动脚本，并使用一份空白 `data/db.json`，不会默认打包你当前导入的资料、错题、复习记录或 API Key。朋友电脑需要安装 Node.js 20 或更高版本；解压后 macOS 双击 `启动-力学复习台.command`，Windows 双击 `启动-力学复习台.bat`。

## 数据位置

- 数据库：`data/db.json`
- 上传文件：`data/uploads/`

默认本地模式不会把资料发往外部服务。只有在设置里切换到 API 增强版并保存 API Key 后，生成总结、出题或问答才会调用配置的 API。
