import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const serverPath = resolve(projectRoot, "dist", "index.js");

const clients: Client[] = [];

async function connect(): Promise<Client> {
  const client = new Client({ name: "smoke-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: projectRoot,
    // 隔离真实用户配置：指向不存在的临时路径，确保服务器以无凭证状态启动。
    env: {
      ...process.env,
      CAMPUS_AGENT_CONFIG: join(tmpdir(), "campus-agent-smoke", "config.json"),
      CAMPUS_AGENT_STATE: join(tmpdir(), "campus-agent-smoke", "state.json"),
    },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

afterEach(async () => {
  while (clients.length) {
    const c = clients.pop()!;
    try {
      await c.close();
    } catch {
      // 已关闭则忽略
    }
  }
});

describe("campus-agent MCP server (stdio)", () => {
  it("完成 initialize 握手并列出工具", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("ping");
    for (const canvasTool of [
      "get_canvas_status",
      "list_canvas_courses",
      "search_canvas_sources",
      "refresh_canvas_courses",
      "refresh_canvas_course",
    ]) {
      expect(names).toContain(canvasTool);
    }
    for (const timetableTool of ["query_schedule", "sync_timetable", "create_event", "delete_event"]) {
      expect(names).toContain(timetableTool);
    }
    for (const mailTool of ["search_mail", "list_mail_folders", "prepare_email"]) {
      expect(names).toContain(mailTool);
    }
    for (const classroomTool of [
      "list_classroom_courses",
      "list_classroom_videos",
      "read_classroom_transcript",
      "download_classroom_transcripts",
    ]) {
      expect(names).toContain(classroomTool);
    }
    for (const shuiyuanTool of [
      "status",
      "list_categories",
      "list_topics",
      "read_topic",
      "read_posts",
      "search_topics",
      "link_topic",
    ]) {
      expect(names).toContain(shuiyuanTool);
    }
    for (const todoTool of [
      "query_todos",
      "query_assignments",
      "save_todo",
      "remove_todo",
      "refresh_todos",
    ]) {
      expect(names).toContain(todoTool);
    }
  });

  it("调用 ping 返回 pong", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "ping", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "text", text: "pong" }]);
  });

  it("调用 get_canvas_status 在无令牌时返回未连接", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "get_canvas_status", arguments: {} });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.credentialSaved).toBe(false);
  });
});
