# API 课程助教

这是一个本地运行、API 驱动的课程助教。它不再是旧版多功能复习面板，而是围绕一个对话窗口完成三件事：

- 读懂你上传的课件 PPT/PDF，并从 0 开始讲到能考试复现。
- 解析你上传或引用的作业图片/PDF，给出题型入口、已知所求、公式、步骤、答案和易错点。
- 基于当前科目全部资料、历史对话和复习档案，生成期末重点、薄弱点、复习顺序和限时练习。

## 重要变化

- API 是必需能力。没有完整 API Base URL、模型和 API Key 时，助教对话会阻塞并引导去设置。
- 旧的知识地图、刷题、计划、冲刺包、错题 Tab 已删除。
- 新数据模型只保留 `courses`、`materials`、`conversations`、`messages`、`artifacts`、`settings`。
- API Key 存在用户目录的独立密钥文件中，`data/db.json` 不保存真实 key。
- 当前科目下的全部资料会默认作为助教上下文，不需要每次手动选择。

## 启动

推荐日常使用：

```bash
npm install
npm run open
```

通过 `npm run open` 或双击启动脚本打开时，关闭浏览器页面后本地服务会在几秒内自动退出，避免端口长期占用。开发时直接 `npm start` 不启用自动退出。

也可以直接运行：

```bash
npm start
```

然后打开：

```text
http://127.0.0.1:4173
```

macOS 可以继续生成应用外壳：

```bash
npm run make:mac-app
```

也可以生成专门用于网页访问的 macOS 应用外壳：

```bash
npm run make:web-app
```

## 个人网页访问

如果只是自己使用、暂时没有域名，可以让程序继续在本机运行，再用 Cloudflare Tunnel 生成一个临时 HTTPS 网页地址：

```bash
brew install cloudflared
npm run web
```

macOS 上也可以先运行 `npm run make:web-app`，然后双击 `dist/API 课程助教网页访问.app`。它和 `npm run web` 做同一件事：启动本机服务、启用网页登录保护，并打开 Cloudflare Tunnel。

`npm run web` 会做三件事：

- 启动本机服务，仍然只监听 `127.0.0.1`。
- 启用网页登录保护；首次运行会在本机用户目录生成访问密码并打印在终端里。
- 启动 `cloudflared tunnel --url http://127.0.0.1:<端口>`，并在终端输出本次 HTTPS 地址。

打开 Cloudflare 输出的 `https://...trycloudflare.com` 地址后，先输入网页登录密码，再进入助教界面。无域名时这个地址可能变化；如果以后要固定网址，需要把域名接入 Cloudflare Tunnel。

注意：这不是云端托管。电脑必须开机，`npm run web` 的终端窗口必须保持运行，外网网页才可以访问。关闭终端或电脑休眠后，外网地址会失效。

如果想自定义网页登录密码，可以先设置环境变量再启动：

```bash
export API_COURSE_TUTOR_WEB_PASSWORD="换成你自己的强密码"
npm run web
```

## 使用流程

1. 打开设置，填写 OpenAI-compatible API Base URL、API Key，检测并选择模型。
2. 在左侧新建或选择科目。
3. 上传 `.pptx`、`.pdf`、`.txt`、`.md`、`.png`、`.jpg`、`.jpeg` 或 `.webp`。
4. 在主窗口选择“从 0 教课件”“解析作业图/PDF”“期末复习”，或者直接用自然语言提问。
5. 助教回答会沉淀为复习档案，包括教学卡、解题卡、复习计划、练习集和记忆卡。

## 数据位置

- 数据库：`data/db.json`
- 上传资料：`data/uploads/`
- 旧数据备份：`data-backups/`
- API Key：`~/.codex/stem-review-studio/api-key.json`

## 测试

```bash
npm run test:core
npm run accuracy
```

`npm run accuracy` 会离线读取 `fixtures/harness/*.json`，使用 mock API 响应验证助教的 intent 到 skill 选择、上下文组装、JSON 归一化、artifact 类型、source_refs 和基础关键词覆盖。它是改上下文策略、提示词和长上下文处理前的质量护栏，不会调用外部 API。

启动服务后：

```bash
npm run smoke
```

真实教学、图片/PDF 解题和期末复习质量仍需要配置 API 后在网页端人工验证。
