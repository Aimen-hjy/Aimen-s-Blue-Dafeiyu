import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveConfig } from "../src/config.js";
import {
  createCalendarEvent,
  currentSemester,
  deleteCalendarEvent,
  getCalendarEvent,
  parseSemesterStart,
  parseWeekNumbers,
  querySchedule,
  resolveSemesterStart,
  syncTimetable,
} from "../src/clients/timetable.js";
import { resetStore } from "../src/store.js";

const timetableData = {
  kbList: [
    {
      kcmc: "机器学习",
      xqj: "1",
      jcs: "1-2节",
      jc: "1-2节",
      zcd: "1-16周",
      cdmc: "东中院1-101",
      xm: "张三",
      xqmc: "闵行校区",
      jxb_id: "JXB001",
      kch: "CS3308",
      xf: "3.0",
      jxbmc: "1班",
      xkbz: "",
    },
  ],
  rqazcList: ["2026-02-23 开学"],
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campus-agent-test-"));
  process.env.CAMPUS_AGENT_CONFIG = join(dir, "config.json");
  process.env.CAMPUS_AGENT_STATE = join(dir, "state.json");
  resetStore();
  saveConfig({ campus: { cookie: "test-cookie" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("timetable pure helpers", () => {
  it("currentSemester 按月份归入学期", () => {
    expect(currentSemester(new Date(2026, 8, 1))).toBe("2026-2027-1");
    expect(currentSemester(new Date(2026, 1, 1))).toBe("2025-2026-1");
    expect(currentSemester(new Date(2026, 4, 1))).toBe("2025-2026-2");
    expect(currentSemester(new Date(2026, 7, 1))).toBe("2025-2026-3");
  });

  it("parseWeekNumbers 展开周次并处理单双周", () => {
    expect(parseWeekNumbers("1-16周")).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(parseWeekNumbers("1-8周(单)")).toEqual([1, 3, 5, 7]);
    expect(parseWeekNumbers("2-8周(双)")).toEqual([2, 4, 6, 8]);
    expect(parseWeekNumbers(undefined)).toEqual([]);
  });

  it("parseSemesterStart 从混杂文本中取最早日期", () => {
    expect(parseSemesterStart(["2026-02-23 开学", "2026-06-15 放假"])).toBe("2026-02-23");
    expect(parseSemesterStart(undefined)).toBeNull();
  });

  it("resolveSemesterStart 依次回退到 接口/配置/内置表", () => {
    expect(resolveSemesterStart("2026-2027-1", ["第1周 2026-09-14"])).toBe("2026-09-14");
    expect(resolveSemesterStart("2026-2027-1", [])).toBe("2026-09-14");
    saveConfig({
      campus: { cookie: "test-cookie", semesterStarts: { "2027-2028-1": "2027-09-06" } },
    });
    expect(resolveSemesterStart("2027-2028-1", [])).toBe("2027-09-06");
    expect(resolveSemesterStart("2030-2031-1", [])).toBeNull();
  });
});

describe("timetable client", () => {
  it("syncTimetable 拉取并缓存课程，含学期开始日期", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify(timetableData), { status: 200 })),
      ),
    );
    await syncTimetable("2025-2026-2");
    const result = querySchedule({
      semester: "2025-2026-2",
      startAt: "2026-02-23T00:00:00Z",
      endAt: "2026-06-30T00:00:00Z",
    });
    expect(result.semester).toBe("2025-2026-2");
    expect(result.coverage.complete).toBe(true);
    expect(result.items).toHaveLength(16);
    expect(result.items[0]).toMatchObject({
      source: "course",
      title: "机器学习",
      startAt: "2026-02-23T00:00:00.000Z",
      location: "东中院1-101",
    });
  });

  it("syncTimetable 在 rqazcList 为空时回退到内置开学日期", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ...timetableData, rqazcList: [] }), { status: 200 }),
        ),
      ),
    );
    const summary = await syncTimetable("2026-2027-1");
    expect(summary.semesterStart).toBe("2026-09-14");
  });

  it("syncTimetable 在缓存有效期内直接返回缓存，不再联网", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(timetableData), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await syncTimetable("2025-2026-2");
    const cached = await syncTimetable("2025-2026-2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cached).toMatchObject({ semester: "2025-2026-2", lessons: 1, cached: true });
  });

  it("syncTimetable 返回同步摘要", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify(timetableData), { status: 200 })),
      ),
    );
    const summary = await syncTimetable("2025-2026-2");
    expect(summary).toMatchObject({
      semester: "2025-2026-2",
      lessons: 1,
      semesterStart: "2026-02-23",
    });
    expect(typeof summary.syncedAt).toBe("string");
  });

  it("syncTimetable 在教务返回 901 时抛登录失效", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ status: 901, type: "basic", contentType: null, bodyPrefix: "" }),
            { status: 200 },
          ),
        ),
      ),
    );
    await expect(syncTimetable("2025-2026-2")).rejects.toMatchObject({
      name: "ToolError",
      code: "AUTH_EXPIRED",
    });
  });

  it("querySchedule 未同步学期时 coverage 带警告", () => {
    const result = querySchedule({
      semester: "2024-2025-1",
      startAt: "2024-09-01T00:00:00Z",
      endAt: "2024-10-01T00:00:00Z",
    });
    expect(result.items).toEqual([]);
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.warnings).toContain("该学期课表尚未同步");
  });

  it("createCalendarEvent / getCalendarEvent / deleteCalendarEvent 本地读写", () => {
    const event = createCalendarEvent({
      title: "组会",
      startAt: "2026-02-24T01:00:00Z",
      endAt: "2026-02-24T02:00:00Z",
      color: "blue",
    });
    expect(event.id).toBe(1);
    expect(event.color).toBe("blue");
    expect(getCalendarEvent(1)?.title).toBe("组会");
    createCalendarEvent({
      title: "自习",
      startAt: "2026-02-25T01:00:00Z",
      endAt: "2026-02-25T03:00:00Z",
    });
    expect(getCalendarEvent(2)?.title).toBe("自习");
    deleteCalendarEvent(1);
    expect(getCalendarEvent(1)).toBeNull();
    expect(getCalendarEvent(2)).not.toBeNull();
  });

  it("querySchedule 把日历事件并入 items 并标注 source=event", () => {
    createCalendarEvent({
      title: "组会",
      startAt: "2026-02-24T01:00:00Z",
      endAt: "2026-02-24T02:00:00Z",
    });
    const result = querySchedule({
      semester: "2025-2026-2",
      startAt: "2026-02-20T00:00:00Z",
      endAt: "2026-02-28T00:00:00Z",
    });
    const event = result.items.find((item) => item.source === "event");
    expect(event).toMatchObject({ source: "event", title: "组会" });
  });
});
