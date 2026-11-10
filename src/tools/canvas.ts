import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CanvasCourse, CanvasState } from "../clients/canvas.js";
import { getCanvasState, syncCanvasCourse, syncCanvasCourses } from "../clients/canvas.js";
import { toolError } from "../errors.js";
import { coverage, freshness, limit, match, offset, page, query, tool } from "./shared.js";

/** syncCourse 各分支的标识与中文标签（与 client 写入 course.error 的前缀一致）。 */
const canvasSyncBranches = [
  { key: "files", label: "文件" },
  { key: "assignments", label: "作业" },
  { key: "discussions", label: "通知与讨论" },
  { key: "modules", label: "课程模块" },
] as const;

function courseSummary(course: CanvasCourse) {
  return {
    id: course.id,
    name: course.name,
    term: course.term,
    code: course.code,
    archived: course.archived ?? false,
    contentSyncedAt: course.syncedAt,
    error: course.error,
  };
}

function requireCanvasConfigured(state: CanvasState = getCanvasState()): void {
  if (!state.connected)
    throw toolError("NOT_CONFIGURED", "尚未连接 Canvas（未保存访问令牌），请先在配置中设置访问令牌");
}

/** 从 course.error（「标签：消息」逐行拼接）解析各分支错误。 */
function branchErrors(error: string | null): Map<string, string | null> {
  const lines = error ? error.split("\n") : [];
  return new Map(
    canvasSyncBranches.map(({ key, label }) => {
      const line = lines.find((item) => item.startsWith(`${label}：`));
      return [key, line ? line.slice(label.length + 1) : null];
    }),
  );
}

export function registerCanvasTools(server: McpServer): void {
  tool(
    server,
    "get_canvas_status",
    "查询 Canvas 本地状态（只读、不联网）：访问令牌是否已保存、课程列表同步时间、每门课的内容同步时间/同步错误/归档标记。",
    {},
    () => {
      const state = getCanvasState();
      const warnings: string[] = [];
      if (!state.connected) warnings.push("未保存 Canvas 访问令牌，请在配置中设置");
      else if (!state.syncedAt) warnings.push("课程列表尚未同步，请调用 refresh_canvas_courses");
      return {
        credentialSaved: state.connected,
        courseListSyncedAt: state.syncedAt,
        courses: state.courses.map(courseSummary),
        ...(warnings.length ? { warnings } : {}),
      };
    },
  );

  tool(
    server,
    "list_canvas_courses",
    "列出本地缓存的 Canvas 课程。query 按名称/代码/学期弱匹配；默认不含归档课程，includeArchived 为 true 时包含。空结果表示没有匹配的课程（需先 refresh_canvas_courses 同步列表）。",
    { query, includeArchived: z.boolean().default(false), offset, limit },
    ({ query, includeArchived, offset, limit }) => {
      const state = getCanvasState();
      requireCanvasConfigured(state);
      if (!state.syncedAt)
        throw toolError("NOT_FOUND", "课程列表尚未同步，请先调用 refresh_canvas_courses");
      const courses = state.courses.filter(
        (course) =>
          (includeArchived || !course.archived) &&
          match(`${course.name} ${course.code} ${course.term}`, query),
      );
      return {
        ...page(courses.map(courseSummary), offset, limit),
        freshness: freshness("cached", state.syncedAt),
        coverage: coverage("cached_courses", true),
      };
    },
  );

  tool(
    server,
    "search_canvas_sources",
    "按标题检索本地缓存的 Canvas 资料（匹配缓存标题，非正文全文）。可按课程、资料类型过滤；返回的 ref 用于进一步定位资料。未同步或同步出错的课程在 courses 中标注。",
    {
      query,
      courseId: z.number().int().positive().optional(),
      kind: z.enum(["file", "assignment", "page", "discussion", "link"]).optional(),
      offset,
      limit,
    },
    ({ query, courseId, kind, offset, limit }) => {
      const state = getCanvasState();
      requireCanvasConfigured(state);
      const unique = new Map(
        state.items
          .filter(
            (item) =>
              item.sourceId &&
              (courseId === undefined || item.courseId === courseId) &&
              (!kind || item.kind === kind) &&
              match(item.name, query),
          )
          .map((item) => [
            item.sourceId!,
            {
              ref: { type: "canvas" as const, id: item.sourceId! },
              title: item.name,
              courseId: item.courseId,
              kind: item.kind,
              dueAt: item.dueAt ?? null,
            },
          ]),
      );
      return {
        ...page([...unique.values()], offset, limit),
        freshness: freshness("cached", state.syncedAt),
        coverage: coverage("cached_titles", true),
        courses: state.courses
          .filter((course) => courseId === undefined || course.id === courseId)
          .map((course) => ({
            id: course.id,
            name: course.name,
            contentSyncedAt: course.syncedAt,
            error: course.error,
            archived: course.archived ?? false,
          })),
      };
    },
  );

  tool(
    server,
    "refresh_canvas_courses",
    "从 Canvas 联网刷新课程列表到本地缓存（仅更新列表，不同步课程内容）。历史课程与本地已同步数据不会被删除。",
    {},
    async () => {
      requireCanvasConfigured();
      const state = await syncCanvasCourses();
      return {
        courseListSyncedAt: state.syncedAt,
        courses: state.courses.map(courseSummary),
        freshness: freshness("cached", state.syncedAt),
      };
    },
  );

  tool(
    server,
    "refresh_canvas_course",
    "联网同步单门课程的内容到本地缓存：文件/作业/通知与讨论/课程模块四个分支独立提交，失败分支保留旧缓存并在 branches 中逐项报告（部分失败不是整体失败）。courseId 见 list_canvas_courses。",
    { courseId: z.number().int().positive() },
    async ({ courseId }) => {
      requireCanvasConfigured();
      const state = await syncCanvasCourse(courseId);
      const course = state.courses.find((item) => item.id === courseId);
      if (!course)
        throw toolError("NOT_FOUND", "课程不存在，请先调用 refresh_canvas_courses 刷新课程列表");
      const errors = branchErrors(course.error);
      return {
        courseId: course.id,
        name: course.name,
        contentSyncedAt: course.syncedAt,
        branches: canvasSyncBranches.map(({ key, label }) => ({
          key,
          label,
          ok: errors.get(key) === null,
          error: errors.get(key),
        })),
        complete: !course.error,
        ...(course.error ? { warnings: [course.error] } : {}),
        freshness: freshness("cached", course.syncedAt),
      };
    },
  );
}
