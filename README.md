# campus-agent

一个面向 SJTU 校园服务的 **MCP（Model Context Protocol）服务器**。它通过 stdio 暴露 28 个工具，让 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（`dsh`）等 agent 用自然语言调用校园服务：查课表、收邮件、看课堂录像文稿、读 Canvas 课程资料、逛水源社区、管理待办。

所有凭证只保存在本机 `~/.campus-agent/config.json`，可用 `CAMPUS_AGENT_SECRET` 加密，不上传服务器。

## 功能与工具（28 个）

| 服务 | 工具 |
|---|---|
| Canvas（5） | `get_canvas_status` `list_canvas_courses` `search_canvas_sources` `refresh_canvas_courses` `refresh_canvas_course` |
| 课堂录像（4） | `list_classroom_courses` `list_classroom_videos` `read_classroom_transcript` `download_classroom_transcripts` |
| 邮件（3） | `search_mail` `list_mail_folders` `prepare_email` |
| 水源社区（7） | `status` `list_categories` `list_topics` `read_topic` `read_posts` `search_topics` `link_topic` |
| 课表（4） | `query_schedule` `sync_timetable` `create_event` `delete_event` |
| TODO（5） | `query_todos` `query_assignments` `save_todo` `remove_todo` `refresh_todos` |

另有 `ping` 健康检查工具。

## 安装与构建

要求 Node.js ≥ 22。

```sh
npm install
npm run build
```

## 配置

首次使用前，复制 `config.example.json` 为 `~/.campus-agent/config.json`，按需填写对应服务。

```sh
mkdir -p ~/.campus-agent
cp config.example.json ~/.campus-agent/config.json
```

配置路径默认为 `~/.campus-agent/config.json`，可用环境变量 `CAMPUS_AGENT_CONFIG` 覆盖。运行状态（课程缓存、待办、水源引用等）写在 `~/.campus-agent/state.json`，可用 `CAMPUS_AGENT_STATE` 覆盖。

### 加密（可选）

设置环境变量 `CAMPUS_AGENT_SECRET` 后，配置文件以 AES-256-GCM 加密落盘；未设置时以明文 JSON 保存（文件权限 0600，仅当前用户可读写）。

## 各服务凭证如何获取

| 服务 | 认证 | 获取方式 |
|---|---|---|
| Canvas | Access Token | 登录 `oc.sjtu.edu.cn` → 账户设置 → 新建访问令牌，填入 `canvas.accessToken` |
| 邮件 | IMAP/SMTP 授权 | 填写 `mail.imap` / `mail.smtp` 的服务器、账号与授权码（交大邮箱通常用独立密码/授权码） |
| 课表 / 课堂录像 | jAccount Cookie | 运行 `campus-agent login`，会自动打开 Edge 完成 jAccount 登录并抓取 Cookie |
| 水源社区 | User API Key | 在 `shuiyuan.sjtu.edu.cn` 授权 User API Key（read+write），把得到的 `key` 与 `clientId` 填入 `shuiyuan` |

### 登录课表 / 课堂录像

```sh
campus-agent login
```

运行后会打开本机的 Microsoft Edge 并跳到 `i.sjtu.edu.cn/jaccountlogin`（自动转去 jAccount 登录页），你在浏览器里正常登录（验证码、短信二次验证都能完成）。登录跳回教务系统后，程序会用真实课表请求验证会话确实有效，再抓取完整的 `JSESSIONID` 等会话 Cookie 写入 `campus.cookie`。之后 dsh 里查课表等校园服务即可直接使用。

- 在 `campus.username` / `campus.password` 填入 jAccount 账号密码后，登录时会自动填充表单并尝试提交（验证码/二次验证仍需人工完成），让后续登录更快捷。
- 教务接口的 `rqazcList` 有时为空、拿不到开学日期。此时按「接口 → `campus.semesterStarts`（`{"2026-2027-1": "2026-09-14"}`）→ 内置校历」依次回退；未命中时 `query_schedule` 会提示缺少开学日期。

- 会话过期时，工具会返回「登录已失效」，再跑一次 `campus-agent login` 即可（jAccount 会话有寿命，属正常现象）。
- 无图形界面或浏览器登录失败时，可手动粘贴 Cookie：

```sh
campus-agent login --cookie "你的 Cookie 整段"
```

Cookie 供课表等校园服务共用（课堂录像同时需要 Canvas 已配置，以便取 LTI 会话）。

## 连接 dsh（MCP）

把 campus-agent 注册为 dsh 的 MCP 服务器。dsh 目前是 dev preview（0.1.0-rc.x），MCP 配置方式可能随版本变化，以下为通用的 stdio 配置形态：

```json
{
  "mcpServers": {
    "campus-agent": {
      "command": "node",
      "args": ["<本仓库路径>/dist/index.js"],
      "env": {
        "CAMPUS_AGENT_SECRET": "<可选：加密口令>"
      }
    }
  }
}
```

连接后 agent 应能看到全部 27 个工具，并可用自然语言调用。

## 开发

```sh
npm run typecheck   # 类型检查
npm test            # 构建 + 运行单元测试（外部 HTTP 全部 mock）
```

## 许可

本项目参考 [Dela](https://github.com/Chang-Yo/Dela)（GPL-3.0-or-later）的接口与数据结构进行逆向与重写，功能接口保持一致、文案与实现为本项目独立编写。若分发本项目，请一并遵守 GPL-3.0 的约束。
