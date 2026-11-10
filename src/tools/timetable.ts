import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  calendarEventColors,
  createCalendarEvent,
  currentSemester,
  deleteCalendarEvent,
  getCalendarEvent,
  querySchedule,
  syncTimetable,
} from "../clients/timetable.js";
import { toolError } from "../errors.js";
import { coverage, freshness, tool } from "./shared.js";

const semesterPattern = /^\d{4}-\d{4}-[123]$/;

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式为 YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day!));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month! - 1 &&
      date.getUTCDate() === day
    );
  }, "日期不存在");

/** YYYY-MM-DD 按上海时区（UTC+8）转 UTC ISO：start 为当日 00:00，end 为次日 00:00（含结束日全天）。 */
function shanghaiDayToUtc(date: string, edge: "start" | "end"): string {
  const [year, month, day] = date.split("-").map(Number);
  const utcMillis = Date.UTC(year!, month! - 1, day!) + (edge === "end" ? 86400000 : 0);
  return new Date(utcMillis - 8 * 3600000).toISOString();
}

export function registerTimetableTools(server: McpServer): void {
  tool(
    server,
    "query_schedule",
    "查询时间范围内的课程与个人事件（只读本地缓存，按 Asia/Shanghai 展开周次）。优先传 startDate/endDate（YYYY-MM-DD，按上海时区解释为当日全天）；也可传 startAt/endAt（UTC ISO 8601）。semester 可选（格式 YYYY-YYYY-[123]），缺省按本机时钟取当前学期。学期未同步或缺学期开始日期时 coverage 带警告；课程与个人事件以 source 字段区分。",
    {
      semester: z.string().regex(semesterPattern).optional(),
      startDate: dateSchema.optional(),
      endDate: dateSchema.optional(),
      startAt: z.string().datetime().optional(),
      endAt: z.string().datetime().optional(),
    },
    ({ semester, startDate, endDate, startAt, endAt }) => {
      const hasDates = startDate !== undefined || endDate !== undefined;
      const hasTimes = startAt !== undefined || endAt !== undefined;
      if (hasDates && hasTimes)
        throw toolError("INVALID_INPUT", "日期对与 UTC 时间对不能混用，请只提供一组");
      if (!hasDates && !hasTimes)
        throw toolError(
          "INVALID_INPUT",
          "请提供 startDate/endDate（YYYY-MM-DD，按上海时区解释，推荐）或 startAt/endAt（UTC ISO 8601）",
        );
      let start: string;
      let end: string;
      if (hasDates) {
        if (startDate === undefined || endDate === undefined)
          throw toolError("INVALID_INPUT", "startDate 与 endDate 必须成对提供");
        if (endDate < startDate) throw toolError("INVALID_INPUT", "endDate 不能早于 startDate");
        start = shanghaiDayToUtc(startDate, "start");
        end = shanghaiDayToUtc(endDate, "end");
      } else {
        if (startAt === undefined || endAt === undefined)
          throw toolError("INVALID_INPUT", "startAt 与 endAt 必须成对提供");
        start = startAt;
        end = endAt;
      }
      const result = querySchedule({
        ...(semester ? { semester } : {}),
        startAt: start,
        endAt: end,
      });
      const warnings = result.coverage.warnings.map((warning) =>
        warning === "该学期课表尚未同步"
          ? "该学期课表尚未同步，请调用 sync_timetable 工具同步后重试"
          : warning,
      );
      return {
        semester: result.semester,
        timezone: result.timezone,
        items: result.items,
        freshness: freshness("cached", result.coverage.courseSyncedAt ?? undefined),
        coverage: coverage(
          `cached_lessons_and_events:${result.semester}`,
          result.coverage.complete,
          warnings,
        ),
      };
    },
  );

  tool(
    server,
    "sync_timetable",
    "从教务系统拉取指定学期的课表并写入本地缓存（需要 campus.cookie 已登录且未失效；近期已同步时直接返回缓存，不重复联网）。semester 可选（格式 YYYY-YYYY-[123]），缺省按本机时钟取当前学期。同步成功后即可用 query_schedule 查询。",
    {
      semester: z.string().regex(semesterPattern).optional(),
    },
    async ({ semester }) => {
      const result = await syncTimetable(semester ?? currentSemester());
      return {
        semester: result.semester,
        syncedAt: result.syncedAt,
        lessons: result.lessons,
        semesterStart: result.semesterStart,
        cached: result.cached ?? false,
        hint: result.cached
          ? "命中近期缓存，未重复联网；课表已可用 query_schedule 查询"
          : "同步完成，现在可用 query_schedule 查询该学期课表",
      };
    },
  );

  tool(
    server,
    "create_event",
    "创建个人日程（本地写）。起止时间使用 UTC ISO 8601（Z）；不会修改课程课表。color 可选，取值 rose/peach/sand/sage/teal/blue/lilac/slate。",
    {
      title: z.string().trim().min(1).max(120),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      location: z.string().trim().max(120).optional(),
      color: z.enum(calendarEventColors).optional(),
    },
    ({ title, startAt, endAt, location, color }) => {
      if (new Date(endAt).getTime() <= new Date(startAt).getTime())
        throw toolError("INVALID_INPUT", "结束时间必须晚于开始时间");
      return createCalendarEvent({ title, startAt, endAt, location, color });
    },
  );

  tool(
    server,
    "delete_event",
    "删除个人日程（本地写，仅自建日历事件）。课程与由个人待办派生的事件不经此删除；不删除任何文件。",
    { id: z.number().int().positive() },
    ({ id }) => {
      const event = getCalendarEvent(id);
      if (!event) throw toolError("NOT_FOUND", "日程不存在或已被删除");
      deleteCalendarEvent(id);
      return { deleted: event };
    },
  );
}
