import { z } from "zod";
import { loadConfig } from "../config.js";
import { toolError } from "../errors.js";
import { getState, setState } from "../store.js";

const origin = "https://oc.sjtu.edu.cn";
const apiRoot = `${origin}/api/v1/`;

type Row = Record<string, unknown>;
const rowSchema = z.record(z.string(), z.unknown());
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const row = (v: unknown): Row => rowSchema.safeParse(v).data ?? {};

export interface CanvasCourse {
  id: number;
  name: string;
  term: string;
  code: string;
  syncedAt: string | null;
  error: string | null;
  archived?: boolean;
}

export interface SourceItem {
  id: string;
  parentId: string | null;
  courseId: number;
  name: string;
  kind: "folder" | "module" | "file" | "assignment" | "page" | "discussion" | "link";
  sourceId: string | null;
  dueAt?: string | null;
}

export interface CanvasState {
  connected: boolean;
  syncedAt: string | null;
  courses: CanvasCourse[];
  items: SourceItem[];
}

const STATE_KEY = "canvas";

function canvasToken(): string {
  return loadConfig().canvas?.accessToken?.trim() ?? "";
}

export function getCanvasState(): CanvasState {
  const saved = getState<{ syncedAt: string | null; courses: CanvasCourse[]; items: SourceItem[] }>(
    STATE_KEY,
  );
  return {
    connected: canvasToken() !== "",
    syncedAt: saved?.syncedAt ?? null,
    courses: saved?.courses ?? [],
    items: saved?.items ?? [],
  };
}

function saveState(state: CanvasState): CanvasState {
  setState(STATE_KEY, {
    syncedAt: state.syncedAt,
    courses: state.courses,
    items: state.items,
  });
  return state;
}

async function request(path: string): Promise<Response> {
  const token = canvasToken();
  if (!token) throw toolError("NOT_CONFIGURED", "尚未连接 Canvas（未保存访问令牌）");
  const url = new URL(path, apiRoot);
  if (url.origin !== origin || !url.pathname.startsWith("/api/v1/"))
    throw toolError("OPERATION_FAILED", "Canvas 地址无效");
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw toolError("NETWORK_ERROR", "无法连接 Canvas，请检查网络后重试");
  }
  if (!response.ok) {
    if (response.status === 401)
      throw toolError("AUTH_EXPIRED", "Canvas 令牌失效或无权访问此内容");
    if (response.status === 404) throw toolError("NOT_FOUND", "Canvas 内容不可用");
    throw toolError("UPSTREAM_ERROR", `Canvas HTTP ${response.status}`);
  }
  return response;
}

function nextPage(header: string | null): string | null {
  const next = header
    ?.split(",")
    .find((part) => /rel="next"/.test(part))
    ?.match(/<([^>]+)>/)?.[1];
  if (!next) return null;
  const url = new URL(next, apiRoot);
  if (url.origin !== origin || !url.pathname.startsWith("/api/v1/"))
    throw toolError("UPSTREAM_ERROR", "Canvas 分页地址无效");
  return url.href;
}

/** 跟随 Link 头拉全量分页（本实例 per_page 上限 50，不能信任请求参数）。 */
async function list(path: string): Promise<Row[]> {
  let next: string | null = new URL(path, apiRoot).href;
  const visited = new Set<string>();
  const result: Row[] = [];
  while (next) {
    if (visited.has(next)) throw toolError("UPSTREAM_ERROR", "Canvas 返回了重复分页");
    visited.add(next);
    const response = await request(next);
    result.push(...z.array(rowSchema).parse(await response.json()));
    next = nextPage(response.headers.get("link"));
  }
  return result;
}

export interface TodoCanvasCourse {
  id: number;
  name: string;
  code: string;
}

export async function listTodoCanvasCourses(): Promise<TodoCanvasCourse[]> {
  const courses = await list("courses?enrollment_state=active&per_page=50");
  const archived = new Set(
    getCanvasState()
      .courses.filter((c) => c.archived)
      .map((c) => c.id),
  );
  return courses
    .filter((c) => num(c.id) > 0 && !archived.has(num(c.id)))
    .map((c) => ({
      id: num(c.id),
      name: str(c.name) || str(c.course_code) || `课程 ${num(c.id)}`,
      code: str(c.course_code),
    }));
}

export function listTodoCanvasAssignments(courseId: number): Promise<Row[]> {
  return list(`courses/${courseId}/assignments?include[]=submission&per_page=50`);
}

export async function syncCanvasCourses(): Promise<CanvasState> {
  const courses = await list("courses?include[]=term&per_page=50");
  const state = getCanvasState();
  const previous = new Map(state.courses.map((c) => [c.id, c]));
  const nextCourses: CanvasCourse[] = courses
    .filter((c) => num(c.id) > 0)
    .map((c) => {
      const id = num(c.id);
      const prev = previous.get(id);
      return {
        id,
        name: str(c.name) || str(c.course_code) || `课程 ${id}`,
        term: str(row(c.term).name) || "未标注学期",
        code: str(c.course_code),
        syncedAt: prev?.syncedAt ?? null,
        error: prev?.error ?? null,
        archived: prev?.archived ?? false,
      };
    });
  return saveState({ ...state, syncedAt: new Date().toISOString(), courses: nextCourses });
}

const syncing = new Map<number, Promise<CanvasState>>();
export function syncCanvasCourse(id: number): Promise<CanvasState> {
  const existing = syncing.get(id);
  if (existing) return existing;
  const work = syncCourse(id).finally(() => syncing.delete(id));
  syncing.set(id, work);
  return work;
}

async function syncCourse(id: number): Promise<CanvasState> {
  const state = getCanvasState();
  const course = state.courses.find((c) => c.id === id);
  if (!course) throw toolError("NOT_FOUND", "课程不存在，请先刷新课程列表");

  const items: SourceItem[] = [];
  const errors: string[] = [];
  const oldItems = state.items.filter((i) => i.courseId === id);

  const group = (key: string, label: string): string => {
    const groupId = `${id}:${key}`;
    items.push({ id: groupId, parentId: null, courseId: id, name: label, kind: "folder", sourceId: null });
    return groupId;
  };

  const file = (f: Row, parentId: string): void => {
    const fileId = num(f.id);
    if (!fileId) return;
    const sourceId = `file:${fileId}`;
    const fileName = str(f.display_name) || str(f.filename) || `文件 ${fileId}`;
    items.push({
      id: `${parentId}/${sourceId}`,
      parentId,
      courseId: id,
      name: fileName,
      kind: "file",
      sourceId,
    });
  };

  // 每个分支独立提交：失败分支回退旧缓存并记录错误，不影响其余分支。
  const branch = async (key: string, label: string, build: () => Promise<void>): Promise<void> => {
    const start = items.length;
    try {
      await build();
    } catch (error) {
      items.splice(start);
      const rootId = `${id}:${key}`;
      const keep = new Set([rootId]);
      for (let changed = true; changed; ) {
        changed = false;
        for (const item of oldItems) {
          if (item.parentId && keep.has(item.parentId) && !keep.has(item.id)) {
            keep.add(item.id);
            changed = true;
          }
        }
      }
      items.push(...oldItems.filter((item) => keep.has(item.id)));
      errors.push(`${label}：${error instanceof Error ? error.message : "同步失败"}`);
    }
  };

  await branch("files", "文件", async () => {
    const [folders, files] = await Promise.all([
      list(`courses/${id}/folders?per_page=50`),
      list(`courses/${id}/files?per_page=50`),
    ]);
    const rootId = group("files", "文件");
    const roots = new Set(folders.filter((f) => f.parent_folder_id === null).map((f) => num(f.id)));
    const known = new Set(folders.map((f) => num(f.id)));
    for (const f of folders) {
      const fid = num(f.id);
      if (!fid || roots.has(fid)) continue;
      const pid = num(f.parent_folder_id);
      items.push({
        id: `folder:${fid}`,
        parentId: roots.has(pid) || !known.has(pid) ? rootId : `folder:${pid}`,
        courseId: id,
        name: str(f.name),
        kind: "folder",
        sourceId: null,
      });
    }
    for (const f of files) {
      const fid = num(f.folder_id);
      file(f, roots.has(fid) || !known.has(fid) ? rootId : `folder:${fid}`);
    }
  });

  await branch("assignments", "作业", async () => {
    const rows = await list(`courses/${id}/assignments?include[]=submission&per_page=50`);
    if (!rows.length) return;
    const rootId = group("assignments", "作业");
    for (const a of rows) {
      const sourceId = `assignment:${num(a.id)}`;
      const title = str(a.name);
      const dueAt = str(a.due_at) || null;
      items.push({
        id: sourceId,
        parentId: rootId,
        courseId: id,
        name: title,
        kind: "assignment",
        sourceId,
        dueAt,
      });
      const attachments = row(a.submission).attachments;
      if (Array.isArray(attachments) && attachments.length) {
        const submissionId = `${sourceId}:submission`;
        items.push({
          id: submissionId,
          parentId: sourceId,
          courseId: id,
          name: "我的提交",
          kind: "folder",
          sourceId: null,
        });
        for (const attachment of attachments) file(row(attachment), submissionId);
      }
    }
  });

  await branch("discussions", "通知与讨论", async () => {
    const [topics, announcements] = await Promise.all([
      list(`courses/${id}/discussion_topics?per_page=50`),
      list(`courses/${id}/discussion_topics?per_page=50&only_announcements=true`),
    ]);
    const rows = [...topics, ...announcements];
    if (!rows.length) return;
    const rootId = group("discussions", "通知与讨论");
    for (const d of rows) {
      const sourceId = `discussion:${id}:${num(d.id)}`;
      items.push({
        id: sourceId,
        parentId: rootId,
        courseId: id,
        name: str(d.title),
        kind: "discussion",
        sourceId,
      });
    }
  });

  await branch("modules", "课程模块", async () => {
    const modules = await list(`courses/${id}/modules?per_page=50`);
    if (!modules.length) return;
    const rootId = group("modules", "课程模块");
    for (const m of modules) {
      const moduleId = `module:${num(m.id)}`;
      items.push({
        id: moduleId,
        parentId: rootId,
        courseId: id,
        name: str(m.name),
        kind: "module",
        sourceId: null,
      });
      const moduleItems = await list(`courses/${id}/modules/${num(m.id)}/items?per_page=50`);
      for (const i of moduleItems) {
        const nodeId = `module-item:${num(i.id)}`;
        const type = str(i.type);
        const sourceId: string | null =
          type === "File"
            ? `file:${num(i.content_id)}`
            : type === "Assignment"
              ? `assignment:${num(i.content_id)}`
              : type === "Discussion"
                ? `discussion:${id}:${num(i.content_id)}`
                : type === "Page"
                  ? `page:${id}:${str(i.page_url)}`
                  : type === "SubHeader"
                    ? null
                    : nodeId;
        const kind: SourceItem["kind"] =
          type === "File"
            ? "file"
            : type === "Assignment"
              ? "assignment"
              : type === "Discussion"
                ? "discussion"
                : type === "Page"
                  ? "page"
                  : sourceId
                    ? "link"
                    : "folder";
        items.push({
          id: nodeId,
          parentId: moduleId,
          courseId: id,
          name: str(i.title),
          kind,
          sourceId,
        });
      }
    }
  });

  course.syncedAt = new Date().toISOString();
  course.error = errors.length ? errors.join("\n") : null;
  const nextCourses = state.courses.map((c) => (c.id === id ? course : c));
  const nextItems = [...state.items.filter((i) => i.courseId !== id), ...items];
  return saveState({ ...state, courses: nextCourses, items: nextItems });
}
