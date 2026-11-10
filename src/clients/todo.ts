import { randomUUID } from "node:crypto";
import { z } from "zod";
import { toolError } from "../errors.js";
import { getState, setState } from "../store.js";
import {
  getCanvasState,
  listTodoCanvasAssignments,
  listTodoCanvasCourses,
} from "./canvas.js";
import { calendarEventColors, type CalendarEventColor } from "./timetable.js";

export type TodoStatus =
  | "pending"
  | "completed"
  | "submitted"
  | "graded"
  | "excused"
  | "resubmit"
  | "offline"
  | "unknown";

export interface TodoItem {
  id: string;
  source: "personal" | "canvas";
  title: string;
  notes: string;
  dueAt: string | null;
  status: TodoStatus;
  createdAt: string;
  calendar?: boolean;
  color?: CalendarEventColor;
  courseId?: number;
  courseCode?: string;
  courseName?: string;
  assignmentId?: number;
  url?: string;
  submittedAt?: string | null;
  syncedAt?: string;
}

export interface TodoState {
  items: TodoItem[];
  connected: boolean;
  syncedAt: string | null;
  error: string | null;
}

export interface TodoSaveInput {
  id?: string;
  title: string;
  notes?: string;
  dueAt?: string | null;
  completed?: boolean;
  calendar?: boolean;
  color?: CalendarEventColor;
}

const ITEMS_KEY = "todoItems";
const SYNC_KEY = "todoSync";

type SyncCache = { syncedAt: string | null; error: string | null; assignments: TodoItem[] };

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const row = (v: unknown): Record<string, unknown> => {
  const parsed = z.record(z.string(), z.unknown()).safeParse(v);
  return parsed.success ? parsed.data : {};
};

export function todoCompleted(status: TodoStatus): boolean {
  return ["completed", "submitted", "graded", "excused"].includes(status);
}

export function canvasTodoStatus(assignment: Record<string, unknown>): TodoStatus {
  const sub = row(assignment.submission);
  if (!Object.keys(sub).length) return "unknown";
  if (sub.excused === true) return "excused";
  if (sub.redo_request === true) return "resubmit";
  if (
    sub.submitted_at ||
    sub.workflow_state === "submitted" ||
    sub.workflow_state === "pending_review"
  ) {
    return sub.workflow_state === "graded" ? "graded" : "submitted";
  }
  const types = assignment.submission_types;
  if (
    Array.isArray(types) &&
    types.every((type) => type === "on_paper" || type === "none") &&
    types.length
  ) {
    return sub.workflow_state === "graded" && sub.missing !== true ? "graded" : "offline";
  }
  if (
    sub.workflow_state === "unsubmitted" ||
    sub.missing === true ||
    sub.workflow_state === "graded"
  )
    return "pending";
  return "unknown";
}

function personalItems(): TodoItem[] {
  return getState<TodoItem[]>(ITEMS_KEY) ?? [];
}

function syncCache(): SyncCache {
  return getState<SyncCache>(SYNC_KEY) ?? { syncedAt: null, error: null, assignments: [] };
}

export function getTodoState(): TodoState {
  const cache = syncCache();
  const items = [...personalItems(), ...cache.assignments].sort(
    (a, b) => (a.dueAt ?? "z").localeCompare(b.dueAt ?? "z") || a.title.localeCompare(b.title),
  );
  return {
    items,
    connected: getCanvasState().connected,
    syncedAt: cache.syncedAt,
    error: cache.error,
  };
}

export function saveTodo(input: TodoSaveInput): TodoState {
  const items = personalItems();
  const existing = input.id ? items.find((item) => item.id === input.id) : undefined;
  if (input.id && !existing)
    throw toolError("NOT_FOUND", "待办不存在，Canvas 作业的完成状态只能通过同步更新");
  const now = new Date().toISOString();
  const item: TodoItem = {
    id: input.id ?? randomUUID(),
    source: "personal",
    title: input.title,
    notes: input.notes ?? existing?.notes ?? "",
    dueAt: input.dueAt === undefined ? (existing?.dueAt ?? null) : input.dueAt,
    status:
      input.completed === undefined
        ? (existing?.status ?? "pending")
        : input.completed
          ? "completed"
          : "pending",
    calendar: input.calendar ?? existing?.calendar ?? false,
    color: input.color ?? existing?.color,
    createdAt: existing?.createdAt ?? now,
  };
  const next = existing
    ? items.map((current) => (current.id === item.id ? item : current))
    : [...items, item];
  setState(ITEMS_KEY, next);
  return getTodoState();
}

export function removeTodo(id: string): TodoState {
  const items = personalItems();
  const target = items.find((item) => item.id === id);
  if (!target) {
    if (syncCache().assignments.some((item) => item.id === id))
      throw toolError("OPERATION_FAILED", "不能删除 Canvas 作业（由同步管理），仅个人待办可删除");
    throw toolError("NOT_FOUND", "待办不存在或已删除");
  }
  setState(
    ITEMS_KEY,
    items.filter((item) => item.id !== id),
  );
  return getTodoState();
}

let activeRefresh: Promise<TodoState> | null = null;

export function refreshTodos(): Promise<TodoState> {
  if (activeRefresh) return activeRefresh;
  activeRefresh = syncCanvasTodos().then(
    (state) => {
      activeRefresh = null;
      return state;
    },
    (error) => {
      activeRefresh = null;
      throw error;
    },
  );
  return activeRefresh;
}

async function syncCanvasTodos(): Promise<TodoState> {
  const courses = await listTodoCanvasCourses();
  const previousByCourse = new Map<number, TodoItem[]>();
  for (const item of syncCache().assignments) {
    if (item.courseId !== undefined) {
      const list = previousByCourse.get(item.courseId) ?? [];
      list.push(item);
      previousByCourse.set(item.courseId, list);
    }
  }
  const errors: string[] = [];
  const assignments: TodoItem[] = [];
  for (const course of courses) {
    try {
      const rows = await listTodoCanvasAssignments(course.id);
      const now = new Date().toISOString();
      for (const a of rows) {
        if (typeof a.id !== "number" || a.published === false) continue;
        const sub = row(a.submission);
        assignments.push({
          id: `canvas:${course.id}:${num(a.id)}`,
          source: "canvas",
          assignmentId: num(a.id),
          courseId: course.id,
          courseCode: course.code || undefined,
          courseName: course.name,
          title: typeof a.name === "string" ? a.name : "未命名作业",
          notes: "",
          dueAt: typeof a.due_at === "string" ? a.due_at : null,
          status: canvasTodoStatus(a),
          submittedAt: typeof sub.submitted_at === "string" ? sub.submitted_at : null,
          url: typeof a.html_url === "string" ? a.html_url : undefined,
          createdAt: typeof a.created_at === "string" ? a.created_at : now,
          syncedAt: now,
        });
      }
    } catch (error) {
      errors.push(`${course.name}：${error instanceof Error ? error.message : String(error)}`);
      assignments.push(...(previousByCourse.get(course.id) ?? []));
    }
  }
  setState(SYNC_KEY, {
    syncedAt: errors.length ? syncCache().syncedAt : new Date().toISOString(),
    error: errors.join("\n") || null,
    assignments,
  });
  return getTodoState();
}

export const todoSaveShape = {
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(10000).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  completed: z.boolean().optional(),
  calendar: z.boolean().optional(),
  color: z.enum(calendarEventColors).optional(),
};
