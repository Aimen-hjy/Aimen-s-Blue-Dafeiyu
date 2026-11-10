import { z } from "zod";
import { campusRequest, requireCampusConfigured } from "../campus-auth.js";
import { loadConfig } from "../config.js";
import { toolError } from "../errors.js";
import { getState, setState } from "../store.js";

export const calendarEventColors = [
  "rose",
  "peach",
  "sand",
  "sage",
  "teal",
  "blue",
  "lilac",
  "slate",
] as const;

export type CalendarEventColor = (typeof calendarEventColors)[number];

export interface TimetableLesson {
  id: number;
  semester: string;
  sourceId: string;
  courseCode: string;
  courseName: string;
  className: string | null;
  teacher: string | null;
  campus: string | null;
  classroom: string | null;
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  periodsText: string;
  weeksText: string;
  weekNumbers: number[];
  credits: number | null;
  note: string | null;
}

export interface CalendarEvent {
  id: number;
  title: string;
  startAt: string;
  endAt: string;
  location: string | null;
  color: CalendarEventColor | null;
}

export interface CalendarEventInput {
  title: string;
  startAt: string;
  endAt: string;
  location?: string;
  color?: CalendarEventColor;
}

const CAMPUS_ORIGIN = "https://i.sjtu.edu.cn";
const TIMETABLE_URL = `${CAMPUS_ORIGIN}/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`;

const semesterPattern = /^\d{4}-\d{4}-[123]$/;
const STATE_KEY = "timetable";
const EVENTS_KEY = "calendarEvents";

interface SemesterSync {
  lastSyncedAt: string;
  semesterStart: string | null;
}

interface TimetableStore {
  lessons: Record<string, TimetableLesson[]>;
  sync: Record<string, SemesterSync>;
}

interface CalendarStore {
  nextId: number;
  events: CalendarEvent[];
}

function loadTimetable(): TimetableStore {
  const saved = getState<TimetableStore>(STATE_KEY);
  return { lessons: saved?.lessons ?? {}, sync: saved?.sync ?? {} };
}

function saveTimetable(store: TimetableStore): void {
  setState(STATE_KEY, store);
}

function loadCalendar(): CalendarStore {
  const saved = getState<CalendarStore>(EVENTS_KEY);
  return { nextId: saved?.nextId ?? 1, events: saved?.events ?? [] };
}

function saveCalendar(store: CalendarStore): void {
  setState(EVENTS_KEY, store);
}

export function currentSemester(now = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 9) return `${year}-${year + 1}-1`;
  if (month <= 2) return `${year - 1}-${year}-1`;
  if (month <= 7) return `${year - 1}-${year}-2`;
  return `${year - 1}-${year}-3`;
}

function semesterParams(semester: string): { xnm: string; xqm: string } {
  if (!semesterPattern.test(semester)) throw toolError("INVALID_INPUT", "学期格式无效");
  const [year, , term] = semester.split("-");
  const termCodes: Record<string, string> = { "1": "3", "2": "12", "3": "16" };
  return { xnm: year!, xqm: termCodes[term!]! };
}

export function parseSemesterStart(values: readonly unknown[] | undefined): string | null {
  const dates = (values ?? [])
    .flatMap((value) => {
      const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
      return text.match(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/g) ?? [];
    })
    .map((value) => {
      const [year, month, day] = value.split(/[-/.]/).map(Number);
      if (!year || !month || !day) return null;
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
        return null;
      return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
        .toString()
        .padStart(2, "0")}`;
    })
    .filter((value): value is string => value !== null)
    .sort();
  return dates[0] ?? null;
}

/**
 * 教务接口的 rqazcList（日期安排）可能为空，导致拿不到开学日期。
 * 这里按「接口 → 配置覆盖 → 内置校历表」依次回退。
 */
const KNOWN_SEMESTER_STARTS: Record<string, string> = {
  // 上海交通大学 2026-2027-1 秋季学期：2026-09-14（周一）开学。
  "2026-2027-1": "2026-09-14",
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function resolveSemesterStart(
  semester: string,
  rqazcList: readonly unknown[] | undefined,
): string | null {
  const fromApi = parseSemesterStart(rqazcList);
  if (fromApi) return fromApi;
  const override = loadConfig().campus?.semesterStarts?.[semester];
  if (override && DATE_PATTERN.test(override)) return override;
  return KNOWN_SEMESTER_STARTS[semester] ?? null;
}

function parsePeriods(value: string | undefined): { start: number; end: number; text: string } {
  const numbers = (value ?? "").match(/\d+/g)?.map(Number) ?? [];
  const start = numbers[0] ?? 1;
  const end = numbers.at(-1) ?? start;
  return {
    start: Math.min(20, Math.max(1, start)),
    end: Math.min(20, Math.max(start, end)),
    text: value?.trim() || `${start}-${end}节`,
  };
}

export function parseWeekNumbers(value: string | undefined): number[] {
  if (!value) return [];
  const odd = /单/.test(value);
  const even = /双/.test(value);
  const result = new Set<number>();
  for (const part of value.replace(/[周()（）单双]/g, "").split(/[,，、]/)) {
    const numbers = part.match(/\d+/g)?.map(Number) ?? [];
    if (numbers.length === 0) continue;
    const start = numbers[0]!;
    const end = numbers[1] ?? start;
    for (let week = start; week <= end && week <= 30; week += 1) {
      if ((odd && week % 2 === 0) || (even && week % 2 === 1)) continue;
      result.add(week);
    }
  }
  return [...result].sort((a, b) => a - b);
}

const rawLessonSchema = z
  .object({
    cdmc: z.string().optional(),
    jc: z.string().optional(),
    jcs: z.string().optional(),
    jxb_id: z.string().optional(),
    jxbmc: z.string().optional(),
    kch: z.string().optional(),
    kch_id: z.string().optional(),
    kcmc: z.string().optional(),
    xf: z.string().optional(),
    xkbz: z.string().optional(),
    xm: z.string().optional(),
    xqj: z.string().optional(),
    xqmc: z.string().optional(),
    zcd: z.string().optional(),
  })
  .passthrough();

const responseSchema = z
  .object({
    kbList: z.array(rawLessonSchema),
    rqazcList: z.array(z.unknown()).optional(),
  })
  .passthrough();

async function fetchTimetable(semester: string) {
  const { xnm, xqm } = semesterParams(semester);
  const body = new URLSearchParams({ xnm, xqm, kzlx: "ck", xsdm: "" });
  const text = await campusRequest(TIMETABLE_URL, {
    service: "课表",
    loginError: "登录已失效，请重新登录",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${CAMPUS_ORIGIN}/kbcx/xskbcx_cxXsgrkbIndex.html?gnmkdm=N2151`,
    },
    body: body.toString(),
  });
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw toolError("UPSTREAM_ERROR", "课表接口没有返回预期的数据，请重新登录后再试");
  }
  // 教务接口把「未登录」藏在响应体里（HTTP 仍是 200）：status=901 即会话失效。
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    const status = (payload as { status?: unknown }).status;
    if (status === 901) throw toolError("AUTH_EXPIRED", "登录已失效，请重新登录");
    if (typeof status === "number" && status !== 200)
      throw toolError("UPSTREAM_ERROR", `课表接口返回状态 ${status}`);
  }
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw toolError("UPSTREAM_ERROR", "课表返回了无法识别的数据");
  return parsed.data;
}

export interface TimetableSyncResult {
  semester: string;
  lessons: number;
  syncedAt: string;
  semesterStart: string | null;
  /** 命中近期缓存（未联网拉取）时为 true。 */
  cached?: boolean;
}

/** 同步结果缓存有效期：期内再同步直接返回缓存，避免每次查询重复联网（教务接口约 0.5s）。 */
const SYNC_TTL_MS = 10 * 60 * 1000;

export async function syncTimetable(semester: string): Promise<TimetableSyncResult> {
  requireCampusConfigured();
  const store = loadTimetable();
  const cached = store.sync[semester];
  if (cached?.lastSyncedAt && Date.now() - Date.parse(cached.lastSyncedAt) < SYNC_TTL_MS) {
    return {
      semester,
      lessons: (store.lessons[semester] ?? []).length,
      syncedAt: cached.lastSyncedAt,
      semesterStart: cached.semesterStart ?? null,
      cached: true,
    };
  }
  const data = await fetchTimetable(semester);
  const semesterStart = resolveSemesterStart(semester, data.rqazcList);
  const lessons: TimetableLesson[] = data.kbList.flatMap((raw, index) => {
    const courseName = raw.kcmc?.trim();
    const weekday = Number(raw.xqj);
    if (!courseName || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) return [];
    const periods = parsePeriods(raw.jcs || raw.jc);
    const credits = raw.xf ? Number(raw.xf) : null;
    return [
      {
        id: index + 1,
        semester,
        sourceId: raw.jxb_id || raw.kch_id || `${raw.kch ?? courseName}-${index}`,
        courseCode: raw.kch?.trim() || "",
        courseName,
        className: raw.jxbmc?.trim() || null,
        teacher: raw.xm?.trim() || null,
        campus: raw.xqmc?.trim() || null,
        classroom: raw.cdmc?.trim() || null,
        weekday,
        startPeriod: periods.start,
        endPeriod: periods.end,
        periodsText: raw.jc?.trim() || periods.text,
        weeksText: raw.zcd?.trim() || "周次未提供",
        weekNumbers: parseWeekNumbers(raw.zcd),
        credits: Number.isFinite(credits) ? credits : null,
        note: raw.xkbz?.trim() || null,
      },
    ];
  });
  const previousStart = store.sync[semester]?.semesterStart;
  const syncedAt = new Date().toISOString();
  store.lessons[semester] = lessons;
  store.sync[semester] = {
    lastSyncedAt: syncedAt,
    semesterStart: semesterStart ?? previousStart ?? null,
  };
  saveTimetable(store);
  return {
    semester,
    lessons: lessons.length,
    syncedAt,
    semesterStart: semesterStart ?? previousStart ?? null,
  };
}

// 上海交大教务处公布的本科生节次表。第 13 节仅用于 11–13 节连上的课程。
const classPeriods = [
  [8 * 60, 8 * 60 + 45],
  [8 * 60 + 55, 9 * 60 + 40],
  [10 * 60, 10 * 60 + 45],
  [10 * 60 + 55, 11 * 60 + 40],
  [12 * 60, 12 * 60 + 45],
  [12 * 60 + 55, 13 * 60 + 40],
  [14 * 60, 14 * 60 + 45],
  [14 * 60 + 55, 15 * 60 + 40],
  [16 * 60, 16 * 60 + 45],
  [16 * 60 + 55, 17 * 60 + 40],
  [18 * 60, 18 * 60 + 45],
  [18 * 60 + 55, 19 * 60 + 40],
  [19 * 60 + 50, 20 * 60 + 20],
] as const;

interface ScheduleItem {
  source: "course";
  lessonId: number;
  title: string;
  startAt: string;
  endAt: string;
  location: string | null;
}

function lessonOccurrences(
  lessons: readonly TimetableLesson[],
  semesterStart: string | null,
  startAt: string,
  endAt: string,
): { items: ScheduleItem[]; warnings: string[] } {
  const warnings: string[] = [];
  const items: ScheduleItem[] = [];
  if (!semesterStart) return { items, warnings: ["缺少学期开始日期，无法将课程转换为实际日期"] };
  const date = new Date(`${semesterStart}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== semesterStart)
    return { items, warnings: ["学期开始日期无效"] };
  const day = 86400000;
  const monday = date.getTime() - ((date.getUTCDay() + 6) % 7) * day - 8 * 3600000;
  const rangeStart = Date.parse(startAt);
  const rangeEnd = Date.parse(endAt);
  for (const lesson of lessons) {
    const start = classPeriods[lesson.startPeriod - 1]?.[0];
    const end = classPeriods[lesson.endPeriod - 1]?.[1];
    if (
      !lesson.weekNumbers.length ||
      start === undefined ||
      end === undefined ||
      end <= start ||
      lesson.weekday < 1 ||
      lesson.weekday > 7
    ) {
      warnings.push(`${lesson.courseName}：缺少有效周次或节次，未计入时间安排`);
      continue;
    }
    for (const week of lesson.weekNumbers) {
      const base = monday + ((week - 1) * 7 + lesson.weekday - 1) * day;
      const begin = base + start * 60000;
      const finish = base + end * 60000;
      if (finish > rangeStart && begin < rangeEnd)
        items.push({
          source: "course",
          lessonId: lesson.id,
          title: lesson.courseName,
          startAt: new Date(begin).toISOString(),
          endAt: new Date(finish).toISOString(),
          location: lesson.classroom,
        });
    }
  }
  return { items, warnings };
}

export interface ScheduleQueryInput {
  semester?: string;
  startAt: string;
  endAt: string;
}

export function querySchedule(input: ScheduleQueryInput) {
  const startAt = z.string().datetime().parse(input.startAt);
  const endAt = z.string().datetime().parse(input.endAt);
  if (
    !(Date.parse(endAt) > Date.parse(startAt)) ||
    Date.parse(endAt) - Date.parse(startAt) > 366 * 86400000
  )
    throw toolError("INVALID_INPUT", "查询范围必须为正数且不超过一年");
  const semester = input.semester ?? currentSemester();
  const store = loadTimetable();
  const sync = store.sync[semester];
  const courses = lessonOccurrences(
    store.lessons[semester] ?? [],
    sync?.semesterStart ?? null,
    startAt,
    endAt,
  );
  const events = listCalendarEvents(startAt, endAt).map((event) => ({
    ...event,
    source: "event" as const,
  }));
  const warnings = [...courses.warnings];
  if (!sync?.lastSyncedAt) warnings.push("该学期课表尚未同步");
  return {
    semester,
    timezone: "Asia/Shanghai",
    items: [...courses.items, ...events].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    coverage: {
      courseSyncedAt: sync?.lastSyncedAt ?? null,
      complete: warnings.length === 0,
      warnings,
    },
  };
}

const dateTimeSchema = z.string().datetime();

export function listCalendarEvents(startAt: string, endAt: string): CalendarEvent[] {
  const start = dateTimeSchema.parse(startAt);
  const end = dateTimeSchema.parse(endAt);
  return loadCalendar()
    .events.filter((event) => event.endAt > start && event.startAt < end)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export function createCalendarEvent(input: CalendarEventInput): CalendarEvent {
  if (new Date(input.endAt).getTime() <= new Date(input.startAt).getTime())
    throw toolError("INVALID_INPUT", "结束时间必须晚于开始时间");
  const store = loadCalendar();
  const created: CalendarEvent = {
    id: store.nextId,
    title: input.title,
    startAt: input.startAt,
    endAt: input.endAt,
    location: input.location ?? null,
    color: input.color ?? null,
  };
  store.events.push(created);
  store.nextId += 1;
  saveCalendar(store);
  return created;
}

export function getCalendarEvent(id: number): CalendarEvent | null {
  const eventId = z.number().int().positive().parse(id);
  return loadCalendar().events.find((event) => event.id === eventId) ?? null;
}

export function deleteCalendarEvent(id: number): void {
  const eventId = z.number().int().positive().parse(id);
  const store = loadCalendar();
  store.events = store.events.filter((event) => event.id !== eventId);
  saveCalendar(store);
}
