#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runLogin } from "./cli.js";
import { loadConfig } from "./config.js";
import { registerCanvasTools } from "./tools/canvas.js";
import { registerClassroomTools } from "./tools/classroom.js";
import { registerMailTools } from "./tools/mail.js";
import { registerShuiyuanTools } from "./tools/shuiyuan.js";
import { registerTimetableTools } from "./tools/timetable.js";
import { registerTodoTools } from "./tools/todo.js";

const server = new McpServer({
  name: "campus-agent",
  version: "0.1.0",
});

server.tool(
  "ping",
  "健康检查：返回 pong，用于验证 MCP 连接是否正常。",
  {},
  async () => ({ content: [{ type: "text", text: "pong" }] })
);

registerCanvasTools(server);
registerTimetableTools(server);
registerMailTools(server);
registerClassroomTools(server);
registerShuiyuanTools(server);
registerTodoTools(server);

/** 启动时检查 jAccount 会话是否就绪，缺登录/不完整时在日志里提示，而不是等调用时才报错。 */
function warnIfNotLoggedIn(): void {
  const cookie = loadConfig().campus?.cookie?.trim() ?? "";
  if (!cookie) {
    console.error("[campus-agent] 尚未登录 jAccount：请运行 `campus-agent login`（会自动打开浏览器登录）。");
  } else if (!cookie.includes("JSESSIONID")) {
    console.error(
      "[campus-agent] jAccount 会话可能不完整（缺少 JSESSIONID）：请运行 `campus-agent login` 重新登录。",
    );
  }
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio 被 MCP 协议占用，日志一律走 stderr
  console.error("campus-agent MCP server started");
  warnIfNotLoggedIn();
}

if (process.argv[2] === "login") {
  runLogin().catch((err) => {
    console.error("Fatal error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
