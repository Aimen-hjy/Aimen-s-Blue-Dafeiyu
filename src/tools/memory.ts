import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listMemory, recallMemory, removeMemory, saveMemory } from "../memory.js";
import { match, tool } from "./shared.js";

const key = z.string().trim().min(1).max(200);
const value = z.string().max(10000);
const description = z.string().trim().max(500).optional();

export function registerMemoryTools(server: McpServer): void {
  tool(
    server,
    "save_memory",
    "把一条信息写入持久记忆（按当前 profile 隔离），如登录状态、常用课程/录像 ID、用户偏好等，跨会话保留。key 重名时覆盖。",
    { key, value, description },
    async ({ key, value, description }) => {
      saveMemory(key, value, description || undefined);
      return { key, saved: true };
    },
  );

  tool(
    server,
    "recall_memory",
    "按 key 读取一条持久记忆；不存在时返回 notFound。",
    { key },
    async ({ key }) => {
      const entry = recallMemory(key);
      return entry ? { key, ...entry } : { key, notFound: true };
    },
  );

  tool(
    server,
    "list_memory",
    "列出已保存的记忆条目（含描述与更新时间，按最近更新排序）；可用 query 过滤 key/描述。",
    { query: z.string().max(500).default("") },
    async ({ query }) => {
      const items = listMemory().filter(
        (entry) => match(`${entry.key} ${entry.description ?? ""}`, query),
      );
      return { items };
    },
  );

  tool(
    server,
    "remove_memory",
    "删除一条记忆；不存在时返回 removed:false。",
    { key },
    async ({ key }) => ({ key, removed: removeMemory(key) }),
  );
}
