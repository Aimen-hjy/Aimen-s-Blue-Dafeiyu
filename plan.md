# Campus Agent 实现计划

> 目标读者：接手本计划的实现 agent / 开发者。请按本文件自顶向下执行，遇未写明处优先参考"参考源码"一节的 Dela 仓库源码。

## 1. 目标

构建一个 **campus-agent**：让 DeepSeek Harness（`dsh`）这类 agent 能调用上海交通大学（SJTU）校园服务——查课表、收邮件、看课堂录像文稿、读 Canvas 课程资料、逛水源社区、管理待办。

**交付物是一个（或多个）MCP server**，通过 stdio 协议被 `dsh` 连接。不包含任何 Electron/桌面 UI/工作台/会话导出等功能。

## 2. 范围（明确不做的事）

- ❌ 不做 Electron 桌面端、markdown 编辑器、内嵌终端、文件树、全局搜索 UI
- ❌ 不做通用编码工具（read/write/edit/bash 等，dsh 已自带）
- ❌ 不做 SSH 远程工程
- ✅ 只做：6 个校园数据客户端 + 把它们暴露成 MCP 工具 + 凭证/配置管理

## 3. 技术选型（已定，勿改）

| 项 | 选择 |
|---|---|
| 语言 | TypeScript（Node ≥ 22） |
| MCP SDK | `@modelcontextprotocol/sdk` |
| 参数校验 | `zod` |
| 传输 | **stdio**（dsh 以子进程方式拉起 MCP server） |
| 邮件 | `imapflow`（IMAP 收）+ `nodemailer`（SMTP 发） |
| 包管理 | npm 或 pnpm 均可 |
| 凭证存储 | 本地 JSON 配置文件（gitignore + 0600 权限），支持环境变量覆盖 |

## 4. 总体架构

```
dsh (agent) ──stdio/MCP──> campus-agent (MCP server)
                               │
                               ├── tools/canvas.ts      → clients/canvas.ts    → Canvas REST
                               ├── tools/mail.ts        → clients/mail.ts      → IMAP/SMTP
                               ├── tools/timetable.ts   → clients/timetable.ts → jAccount 教务
                               ├── tools/classroom.ts   → clients/classroom.ts → 课堂视频平台
                               ├── tools/shuiyuan.ts    → clients/shuiyuan.ts  → Discourse
                               └── tools/todo.ts        → clients/todo.ts      → 本地存储 + Canvas
```

**原则：客户端（clients）只做数据获取，不感知 agent；工具（tools）是薄壳，只做 schema 定义 + 调用客户端。** 这样客户端代码可独立测试、可复用。

## 5. 项目结构

```
campus-agent/
├── package.json
├── tsconfig.json
├── .gitignore
├── config.example.json          # 配置样例（真实配置不入库）
├── src/
│   ├── index.ts                 # MCP server 入口：注册全部工具，stdio 启动
│   ├── config.ts                # 读取配置（env 覆盖）
│   ├── credentials.ts           # 凭证读写（加密文件，见 §7）
│   ├── campus-auth.ts           # SJTU jAccount 会话（Cookie 会话管理）
│   ├── clients/
│   │   ├── canvas.ts
│   │   ├── mail.ts
│   │   ├── timetable.ts
│   │   ├── classroom.ts
│   │   ├── shuiyuan.ts
│   │   └── todo.ts
│   └── tools/
│       ├── canvas.ts
│       ├── mail.ts
│       ├── timetable.ts
│       ├── classroom.ts
│       ├── shuiyuan.ts
│       └── todo.ts
└── test/                        # 每个客户端的单元测试（mock 外部 HTTP）
```

## 6. 依赖清单

```jsonc
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1",
    "zod": "^3",
    "imapflow": "^1",
    "nodemailer": "^6"
  }
}
```

## 7. 凭证与配置

**config.example.json：**

```json
{
  "canvas": {
    "baseUrl": "https://oc.sjtu.edu.cn",
    "accessToken": ""
  },
  "mail": {
    "imap": { "host": "", "port": 993, "user": "", "password": "", "tls": true },
    "smtp": { "host": "", "port": 465, "user": "", "password": "", "secure": true }
  },
  "campus": {
    "cookie": ""
  },
  "shuiyuan": {
    "baseUrl": "",
    "apiKey": ""
  }
}
```

- `credentials.ts`：读 `~/.campus-agent/config.json`（或 `CAMPUS_AGENT_CONFIG` 环境变量指向的路径）。首次可明文 + 0600 权限；若时间允许，用 `node:crypto` 做 AES-256-GCM 加密（密码来自环境变量 `CAMPUS_AGENT_SECRET`）。
- `campus-auth.ts`：维护 jAccount Cookie 会话。**非 Electron 环境下的登录方式**：提供 CLI 子命令 `campus-agent login` 让用户手动粘贴 Cookie，或（可选）用 puppeteer 做 headless 登录。Cookie 存进配置文件。

## 8. 客户端模块明细（重点：认证与 endpoint）

> 所有具体 endpoint、参数、Cookie 逻辑**以 Dela 源码为准**（见 §10），本节给出已确认的信息与方向。

| 模块 | 数据源 | 认证 | 已确认信息 | 需实现的函数 |
|---|---|---|---|---|
| `canvas.ts` | Canvas LMS REST | Access Token（`Authorization: Bearer`） | base `https://oc.sjtu.edu.cn/api/v1/` | 列课程、列模块/条目、列文件、下载文件（流式写盘）、同步状态 |
| `mail.ts` | IMAP + SMTP | 账号/授权码 | 库：imapflow + nodemailer | 连 IMAP、列文件夹、搜索邮件、读正文/附件、发信、存草稿 |
| `timetable.ts` | jAccount 教务 | jAccount Cookie | origin `https://i.sjtu.edu.cn` | 拉课表 → 转 `CalendarEvent[]`、按周生成 occurrence |
| `classroom.ts` | 课堂视频平台 | Canvas LTI Cookie | base `https://v.sjtu.edu.cn/jy-application-resourcemanage/v1` | 列课程、列录像、取转录（分段）、格式化转录、下载为 TXT |
| `shuiyuan.ts` | Discourse | User API Key | 详情见源码 | 列分类、列话题、读话题、读帖子、搜索、关联话题 |
| `todo.ts` | 本地 + Canvas 作业 | — | 本地 JSON/SQLite + Canvas 作业拉取 | 查/增/删待办、查作业、同步 |

**注意：** `timetable`、`classroom`、`shuiyuan` 的 endpoint 是 SJTU 私有系统，需要对照 Dela 源码逆向；这是本任务工作量最大的部分。

## 9. MCP 工具层（27 个工具，名字必须与下表一致）

工具名用 `snake_case`，与 Dela 保持一致。每个工具 = `{ name, description, zod schema, handler }`。

### Canvas（5）
| 工具名 | 说明 |
|---|---|
| `get_canvas_status` | 返回 Canvas 连接/同步状态 |
| `list_canvas_courses` | 列出 Canvas 课程 |
| `search_canvas_sources` | 搜索课程资料/来源 |
| `refresh_canvas_courses` | 同步全部课程资料 |
| `refresh_canvas_course` | 同步单个课程资料 |

### 课堂录像（4）
| 工具名 | 说明 |
|---|---|
| `list_classroom_courses` | 列出本学期课堂视频课程，返回教学班 ID |
| `list_classroom_videos` | 列出指定教学班的录像节次 |
| `read_classroom_transcript` | 读取录像时间窗内的语音文稿（分页返回，单位为秒） |
| `download_classroom_transcripts` | 将指定节次完整文稿保存为 TXT（需绝对路径，不覆盖已有文件） |

### 邮件（3）
| 工具名 | 说明 |
|---|---|
| `search_mail` | 检索邮件 |
| `list_mail_folders` | 列出邮件文件夹 |
| `prepare_email` | 准备邮件草稿 |

### 水源社区（7）
| 工具名 | 说明 |
|---|---|
| `status` | 水源连接状态 |
| `list_categories` | 列出分类 |
| `list_topics` | 列出话题 |
| `read_topic` | 读取话题详情 |
| `read_posts` | 读取帖子内容 |
| `search_topics` | 搜索话题 |
| `link_topic` | 关联/引用话题 |

### 课表（3）
| 工具名 | 说明 |
|---|---|
| `query_schedule` | 查询课表/日程 |
| `create_event` | 创建日程 |
| `delete_event` | 删除日程 |

### TODO（5）
| 工具名 | 说明 |
|---|---|
| `query_todos` | 查询待办 |
| `query_assignments` | 查询 Canvas 作业 |
| `save_todo` | 保存/创建待办 |
| `remove_todo` | 删除待办 |
| `refresh_todos` | 同步待办与作业 |

**参考 schema 示例（课堂录像，直接摘自 Dela 源码，其余工具照此风格去源码里取）：**

- `read_classroom_transcript`：入参 `{ videoId: int, startSeconds?: number=0, endSeconds?: number, offset?: number=0, limit?: int=6000 }`；返回分页文本 + `nextOffset` + `nextStartSeconds`。
- `download_classroom_transcripts`：入参 `{ courseId: int, videoIds: int[], directory: string }`；返回 `{ results: [{videoId, status: 'saved'|'unavailable'|'failed', path?, error?}] }`。

## 10. 参考源码

- 仓库：`git clone --depth 1 https://github.com/Chang-Yo/Dela.git`（**GPL-3.0-or-later**，可参考/移植，注意若分发需遵守 GPL）。
- 客户端代码（本任务的 `clients/*` 对照物）：
  - Canvas：`src/main/canvas/api.ts`、`src/main/canvas/course-files.ts`
  - 邮件：`src/main/mail/{api,parse,send,sync,store,drafts}.ts`
  - 课表：`src/main/timetable/api.ts`、`src/shared/schedule.ts`
  - 课堂录像：`src/main/vsjtu/{api,transcript,playback}.ts`
  - 水源：`src/main/shuiyuan/{api,budget,links,media,sources,snapshot}.ts`
  - TODO：`src/main/todo/index.ts`、`src/shared/todo.ts`
  - 共享类型（DTO）：`src/shared/{canvas,mail,timetable,vsjtu,shuiyuan,todo,schedule}.ts`
- 工具层（本任务的 `tools/*` 对照物）：`src/main/agent/domain/{canvas,classroom,mail,shuiyuan,timetable,todo}/`，每个 `index.ts` 导出该服务的工具集合，`list-courses.ts`/`query-schedule.ts` 等文件内含**完整的 zod schema 和描述文案，直接照搬**。
- 登录/凭证：`src/main/campus/`、`src/main/credentials.ts`（注意：Dela 用 Electron keychain + 隐藏登录窗口，本任务要替换为 §7 的方式）。

## 11. 实施顺序（里程碑）

1. **M1 — 骨架跑通**：`package.json` + `index.ts` 起一个 MCP server，注册一个 `ping` 工具；在 `dsh` 里连上并调通一次。
2. **M2 — Canvas 端到端**：`credentials.ts` + `clients/canvas.ts` + `tools/canvas.ts`（5 工具）；验证「agent 提问 → 调 `list_canvas_courses` → 返回课程列表」。
3. **M3 — 课表**：`campus-auth.ts` + `clients/timetable.ts` + `tools/timetable.ts`。
4. **M4 — 邮件**：`clients/mail.ts` + `tools/mail.ts`。
5. **M5 — 课堂录像**：`clients/classroom.ts` + `tools/classroom.ts`（含转录下载）。
6. **M6 — 水源**：`clients/shuiyuan.ts` + `tools/shuiyuan.ts`。
7. **M7 — TODO**：`clients/todo.ts` + `tools/todo.ts`。
8. **M8 — 收尾**：配置加密、`campus-agent login` 子命令、README、每个客户端的单元测试。

## 12. 验收标准

- `dsh` 连接 `campus-agent` 后，能看到全部 27 个工具，且能通过自然语言调用其中任意一个并返回正确数据。
- 每个客户端有单元测试（外部 HTTP 全部 mock），`npm test` 通过。
- 配置文件不提交，凭证不以明文出现在仓库或日志中。
- README 说明：安装、`config.json` 配置、`dsh` 连接 MCP 的方式、各服务凭证如何获取。

## 13. 风险与注意事项

- **SJTU 私有平台逆向**：`timetable`/`classroom`/`shuiyuan` 的接口可能变，务必从 Dela 源码抄对 endpoint 和 Cookie 逻辑，并做容错（认证失败给明确错误提示）。
- **dsh 是 dev preview（0.1.0-rc.x）**：MCP 配置方式可能变，把"连 dsh"的配置写进 README 并标注版本。
- **GPL 许可**：若直接移植 Dela 代码，你的项目也需以 GPL 兼容方式发布；若只是"参考思路重写"则无此约束，自行权衡。
- **凭证安全**：Cookie/token 泄露等于账号泄露，务必保证 config 文件权限与加密。
