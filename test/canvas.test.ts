import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveConfig } from "../src/config.js";
import { getCanvasState, syncCanvasCourse, syncCanvasCourses } from "../src/clients/canvas.js";
import { resetStore } from "../src/store.js";

function ok(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const coursesData = [
  { id: 123, name: "机器学习", course_code: "CS3308-01", term: { name: "2026-2027 Fall" } },
  { id: 124, name: "操作系统", course_code: "CS2101-01", term: { name: "2026-2027 Fall" } },
];

const folders = [
  { id: 1, name: "slides", parent_folder_id: null },
  { id: 2, name: "project", parent_folder_id: null },
];

const files = [
  { id: 11, display_name: "lecture1.pdf", folder_id: 1, size: 1024, "content-type": "application/pdf", updated_at: "2026-01-01" },
  { id: 12, display_name: "spec.zip", folder_id: 2, size: 2048, "content-type": "application/zip", updated_at: "2026-01-02" },
];

const assignments = [
  {
    id: 21,
    name: "作业一",
    due_at: "2026-11-20T00:00:00Z",
    html_url: "https://oc.sjtu.edu.cn/courses/123/assignments/21",
    description: "<p>要求</p>",
    updated_at: "2026-01-03",
    submission: { attachments: [{ id: 13, display_name: "hw1.zip", folder_id: null }] },
  },
];

const announcements = [
  { id: 31, title: "课程公告", message: "<p>hi</p>", html_url: "https://oc.sjtu.edu.cn/courses/123/discussion_topics/31" },
];

const modules = [{ id: 41, name: "第一章" }];

const moduleItems = [
  { id: 51, type: "File", title: "课件", content_id: 11, page_url: "", external_url: "", html_url: "" },
  { id: 52, type: "Page", title: "说明页", content_id: 0, page_url: "intro", external_url: "", html_url: "" },
];

function route(input: unknown): Response {
  const url = input instanceof URL ? input : new URL(String(input));
  const path = url.pathname;
  const search = url.search;
  if (path === "/api/v1/courses") return ok(coursesData);
  if (path === "/api/v1/courses/123/folders") return ok(folders);
  if (path === "/api/v1/courses/123/files") return ok(files);
  if (path === "/api/v1/courses/123/assignments") return ok(assignments);
  if (path === "/api/v1/courses/123/discussion_topics") {
    return search.includes("only_announcements") ? ok(announcements) : ok([]);
  }
  if (path === "/api/v1/courses/123/modules") return ok(modules);
  if (/\/api\/v1\/courses\/123\/modules\/\d+\/items$/.test(path)) return ok(moduleItems);
  return ok([]);
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campus-agent-test-"));
  process.env.CAMPUS_AGENT_CONFIG = join(dir, "config.json");
  process.env.CAMPUS_AGENT_STATE = join(dir, "state.json");
  resetStore();
  saveConfig({ canvas: { baseUrl: "https://oc.sjtu.edu.cn", accessToken: "test-token" } });
  vi.stubGlobal("fetch", vi.fn((input: unknown) => Promise.resolve(route(input))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("canvas client", () => {
  it("syncCanvasCourses 拉取并缓存课程列表", async () => {
    const state = await syncCanvasCourses();
    expect(state.syncedAt).toBeTruthy();
    expect(state.courses.map((c) => c.name)).toEqual(["机器学习", "操作系统"]);
    expect(state.courses[0].code).toBe("CS3308-01");
  });

  it("syncCanvasCourse 同步四个分支并构建条目树", async () => {
    await syncCanvasCourses();
    const state = await syncCanvasCourse(123);
    const course = state.courses.find((c) => c.id === 123)!;
    expect(course.syncedAt).toBeTruthy();
    expect(course.error).toBeNull();

    const files = state.items.filter((i) => i.kind === "file");
    // 文件树、作业提交附件、模块引用可指向同一 file source，去重后应为这三份文件。
    expect([...new Set(files.map((f) => f.sourceId))]).toEqual(["file:11", "file:12", "file:13"]);

    const assignment = state.items.find((i) => i.kind === "assignment");
    expect(assignment?.dueAt).toBe("2026-11-20T00:00:00Z");

    const discussion = state.items.find((i) => i.kind === "discussion");
    expect(discussion?.name).toBe("课程公告");

    const page = state.items.find((i) => i.kind === "page");
    expect(page?.sourceId).toBe("page:123:intro");
  });

  it("未配置令牌时 getCanvasState 标记为未连接", () => {
    process.env.CAMPUS_AGENT_CONFIG = join(dir, "missing.json");
    expect(getCanvasState().connected).toBe(false);
  });
});
