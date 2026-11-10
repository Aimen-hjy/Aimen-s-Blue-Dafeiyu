import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getTodoState,
  refreshTodos,
  removeTodo,
  saveTodo,
  todoCompleted,
  todoSaveShape,
  type TodoItem,
} from "../clients/todo.js";
import { toolError } from "../errors.js";
import { coverage, freshness, limit, match, offset, page, query, tool } from "./shared.js";

function matchesCompleted(item: TodoItem, completed: boolean | undefined): boolean {
  return (
    completed === undefined ||
    (completed ? todoCompleted(item.status) : ["pending", "resubmit"].includes(item.status))
  );
}

export function registerTodoTools(server: McpServer): void {
  tool(
    server,
    "query_todos",
    "查询统一待办清单（只读本地缓存）：个人待办与 Canvas 作业，关键词匹配标题/备注/课程名，可按完成状态筛选。查作业截止时间与提交状态请改用 query_assignments；未知与线下状态既不算已完成也不算未完成。",
    { query, completed: z.boolean().optional(), offset, limit },
    ({ query: keyword, completed, offset: start, limit: count }) => {
      const state = getTodoState();
      const items = state.items.filter(
        (item) =>
          match(`${item.title} ${item.notes} ${item.courseName ?? ""}`, keyword) &&
          matchesCompleted(item, completed),
      );
      const warnings: string[] = [];
      if (!state.connected) warnings.push("Canvas 未连接：清单只含个人待办，作业不可见");
      if (state.error) warnings.push(`上次作业同步出错：${state.error}`);
      return {
        ...page(items, start, count),
        freshness: freshness("cached", state.syncedAt ?? undefined),
        coverage: coverage("personal_todos_and_cached_assignments", warnings.length === 0, warnings),
      };
    },
  );

  tool(
    server,
    "query_assignments",
    "查询 Canvas 作业的截止视图（只读本地缓存）：按课程与截止时间范围筛选，含真实提交状态；个人待办请用 query_todos。需要更新状态先调用 refresh_todos；未知与线下状态既不算已完成也不算未完成。",
    {
      courseId: z.number().int().positive().optional(),
      startAt: z.string().datetime().optional(),
      endAt: z.string().datetime().optional(),
      completed: z.boolean().optional(),
      offset,
      limit,
    },
    ({ courseId, startAt, endAt, completed, offset: start, limit: count }) => {
      const state = getTodoState();
      if (!state.connected)
        throw toolError("NOT_CONFIGURED", "Canvas 未连接，无法查询作业；请先在设置中连接 Canvas");
      const items = state.items.filter(
        (item) =>
          item.source === "canvas" &&
          (courseId === undefined || item.courseId === courseId) &&
          (!startAt || (item.dueAt && Date.parse(item.dueAt) >= Date.parse(startAt))) &&
          (!endAt || (item.dueAt && Date.parse(item.dueAt) < Date.parse(endAt))) &&
          matchesCompleted(item, completed),
      );
      return {
        ...page(items, start, count),
        freshness: freshness("cached", state.syncedAt ?? undefined),
        coverage: coverage(
          "cached_assignments",
          !state.error,
          state.error ? [`上次同步出错：${state.error}`] : undefined,
        ),
      };
    },
  );

  tool(
    server,
    "save_todo",
    "新建或修改个人待办（本地写）。提供 id 时更新已有条目；不能修改 Canvas 作业（其状态由同步更新），不会提交作业。completed 控制完成状态；dueAt 为 UTC ISO 8601；calendar+color 控制是否在日历中按截止时间显示。",
    todoSaveShape,
    (input) => saveTodo(input),
  );

  tool(
    server,
    "remove_todo",
    "删除个人待办（本地写，仅个人待办；Canvas 作业由同步管理，不可删除）。删除前做存在性检查，未知 id 返回 NOT_FOUND。",
    { id: z.string().min(1).max(512) },
    ({ id }) => {
      const state = removeTodo(id);
      return { removedId: id, ...state };
    },
  );

  tool(
    server,
    "refresh_todos",
    "从 Canvas 刷新作业与提交状态缓存（联网写缓存；覆盖在读未归档课程）。不会提交作业。",
    {},
    async () => {
      const state = getTodoState();
      if (!state.connected)
        throw toolError("NOT_CONFIGURED", "Canvas 未连接，无法刷新作业；请先在设置中连接 Canvas");
      const result = await refreshTodos();
      return {
        ...result,
        freshness: freshness("cached", result.syncedAt ?? undefined),
        coverage: coverage(
          "cached_assignments",
          !result.error,
          result.error ? [`部分课程同步失败：${result.error}`] : undefined,
        ),
      };
    },
  );
}
