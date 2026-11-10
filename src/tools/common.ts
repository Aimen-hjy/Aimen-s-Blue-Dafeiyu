import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** 把纯文本包装成 MCP 工具返回值。 */
export function text(content: string): CallToolResult {
  return { content: [{ type: "text", text: content }] };
}

/** 把对象序列化为格式化 JSON 文本（工具返回给 agent 的主要形态）。 */
export function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** 返回一个带错误标记的工具结果。 */
export function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
