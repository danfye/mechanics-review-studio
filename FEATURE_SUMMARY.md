# API 课程助教功能总结

本文档总结当前重写后的应用能力，便于后续继续开发、打包或向他人介绍项目。

当前版本：`1.0.0`

定位：本地运行、API 必需的课程助教，用对话完成课件教学、作业解题和期末复习。

## 当前能力

- 用单一对话工作台替代旧版知识地图、刷题、计划、冲刺包和错题 Tab。
- 支持按科目上传 `.pptx`、`.pdf`、`.txt`、`.md`、`.png`、`.jpg`、`.jpeg` 和 `.webp`。
- 对话支持三个主意图：`teach_materials`、`solve_homework`、`final_review`。
- 当前科目全部资料会默认进入上下文。
- 助教回答会返回 Markdown 正文、来源引用、下一步建议和结构化复习档案。
- 复习档案类型包括 `lesson`、`solution`、`review_plan`、`drill_set`、`memory_card`。
- API Key 保存在用户目录 `~/.codex/stem-review-studio/api-key.json`，`data/db.json` 不保存真实 key。
- 通过启动器打开时，浏览器窗口关闭后服务会自动退出，避免端口长期占用。

## 架构

- `server.cjs`：轻量 HTTP 路由，负责静态文件、状态、课程、资料上传、助教消息和 API 设置。
- `lib/server/material-service.cjs`：资料保存与轻量解析，保留 PPT/PDF/text units 和图片文件。
- `lib/server/assistant-service.cjs`：统一 API 助教提示词、意图识别、视觉材料组织、JSON 结果归一化。
- `public/index.html`、`public/app.js`、`public/styles.css`：聊天式三栏工作台。

## 主要接口

- `GET /api/state`：返回课程、资料、会话摘要、复习档案和 API 配置状态。
- `POST /api/courses`：创建课程。
- `POST /api/materials`：上传课件、PDF、图片或文本资料。
- `POST /api/assistant/messages`：发送助教消息，API 未配置时直接阻塞。
- `POST /api/settings/models`：检测模型列表。
- `POST /api/settings/test`：测试 API 连接。
- `POST /api/settings`：保存 API 设置。
- `POST /api/heartbeat`：启动器模式下用于检测页面是否仍打开，心跳停止后服务自动退出。

## 数据

新数据模型只保留：

- `courses`
- `materials`
- `conversations`
- `messages`
- `artifacts`
- `settings`

旧版资料、错题、复盘记录和知识包不再兼容。重写前的本地数据已备份到 `data-backups/`。
