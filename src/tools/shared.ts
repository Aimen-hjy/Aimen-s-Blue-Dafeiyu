import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ToolError } from "../errors.js";
import { json, text } from "./common.js";

// 跨工具共用的入参约束。
export const uuid = z.string().uuid();
export const query = z.string().max(500).default("");
export const offset = z.number().int().min(0).default(0);
export const limit = z.number().int().min(1).max(100).default(30);
export const name = z.string().trim().min(1).max(200);

/** 本地列表分页：items 为当前页，total 为总量，nextOffset 为下一页起点（无更多为 null）。 */
export function page<T>(items: T[], start: number, count: number) {
  return {
    items: items.slice(start, start + count),
    total: items.length,
    nextOffset: start + count < items.length ? start + count : null,
  };
}

export function match(value: string, keyword: string): boolean {
  return value.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
}

/** cached=本地缓存查询；realtime=当次联网。 */
export function freshness(kind: "cached" | "realtime", syncedAt?: string | null) {
  return { kind, ...(syncedAt ? { syncedAt } : {}) };
}

/** scope 描述数据窗口（如 cached_titles）；complete=false 时 warnings 说明缺口。 */
export function coverage(scope: string, complete: boolean, warnings?: string[]) {
  return { scope, complete, ...(warnings?.length ? { warnings } : {}) };
}

/** 远端 cursor 分页（水源等）：nextCursor 为不透明字符串原样回传。 */
export function cursorPage<T>(items: T[], nextCursor: string | null) {
  return { items, nextCursor };
}

/**
 * 注册一个 MCP 工具：入参经 zod 校验（默认值生效），handler 返回的对象序列化为 JSON 文本。
 * ToolError 映射为带错误码的失败结果，其余异常兜底为 OPERATION_FAILED。
 */
export function tool<S extends z.ZodRawShape>(
  server: McpServer,
  toolName: string,
  description: string,
  schema: S,
  handler: (args: z.infer<z.ZodObject<S>>) => unknown | Promise<unknown>,
): void {
  server.tool(toolName, description, schema, (async (args: z.infer<z.ZodObject<S>>) => {
    try {
      const result = await handler(args);
      return result === undefined || result === null ? text("ok") : json(result);
    } catch (err) {
      return toolFailure(err);
    }
  }) as never);
}

function toolFailure(err: unknown): CallToolResult {
  if (err instanceof ToolError) {
    return {
      content: [{ type: "text", text: `${err.code}: ${err.message}` }],
      isError: true,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `OPERATION_FAILED: ${message}` }], isError: true };
}
