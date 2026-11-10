import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canvasTodoStatus,
  getTodoState,
  refreshTodos,
  removeTodo,
  saveTodo,
} from "../src/clients/todo.js";
import { saveConfig } from "../src/config.js";
import { resetStore } from "../src/store.js";

function ok(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function route(input: unknown): Response {
  const url = new URL(String(input));
  const path = url.pathname;
  if (path === "/api/v1/courses")
    return ok([
      { id: 100, name: "机器学习", course_code: "CS3308" },
      { id: 101, name: "操作系统", course_code: "CS2101" },
    ]);
  const assignments = path.match(/^\/api\/v1\/courses\/(\d+)\/assignments$/);
  if (assignments) {
    if (assignments[1] === "100")
      return ok([
        {
          id: 1,
          name: "作业一",
          due_at: "2026-12-01T00:00:00Z",
          published: true,
          created_at: "2026-11-01T00:00:00Z",
          html_url: "https://oc.sjtu.edu.cn/courses/100/assignments/1",
          submission: { workflow_state: "unsubmitted" },
        },
        {
          id: 2,
          name: "线下作业",
          published: true,
          submission: { workflow_state: "unsubmitted" },
          submission_types: ["on_paper"],
        },
      ]);
    return ok([]);
  }
  return ok([]);
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campus-agent-test-"));
  process.env.CAMPUS_AGENT_CONFIG = join(dir, "config.json");
  process.env.CAMPUS_AGENT_STATE = join(dir, "state.json");
  resetStore();
  saveConfig({ canvas: { accessToken: "test-token" } });
  vi.stubGlobal("fetch", vi.fn((input: unknown) => Promise.resolve(route(input))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("canvasTodoStatus", () => {
  it("按提交事实与作业类型判定状态", () => {
    expect(canvasTodoStatus({})).toBe("unknown");
    expect(canvasTodoStatus({ submission: { excused: true } })).toBe("excused");
    expect(canvasTodoStatus({ submission: { redo_request: true } })).toBe("resubmit");
    expect(
      canvasTodoStatus({ submission: { submitted_at: "x", workflow_state: "graded" } }),
    ).toBe("graded");
    expect(canvasTodoStatus({ submission: { submitted_at: "x" } })).toBe("submitted");
    expect(
      canvasTodoStatus({ submission: { workflow_state: "unsubmitted" }, submission_types: ["on_paper"] }),
    ).toBe("offline");
    expect(canvasTodoStatus({ submission: { workflow_state: "unsubmitted" } })).toBe("pending");
  });
});

describe("todo personal", () => {
  it("saveTodo 新建与更新个人待办", () => {
    const created = saveTodo({ title: "复习线性代数", dueAt: "2026-12-15T00:00:00Z" });
    expect(created.items).toHaveLength(1);
    const item = created.items[0];
    expect(item).toMatchObject({ source: "personal", title: "复习线性代数", status: "pending" });

    const updated = saveTodo({ id: item.id, title: "复习线性代数", completed: true });
    expect(updated.items[0]).toMatchObject({ id: item.id, status: "completed" });
    expect(updated.items).toHaveLength(1);
  });

  it("saveTodo 未知 id 返回 NOT_FOUND", () => {
    expect(() => saveTodo({ id: "00000000-0000-4000-8000-000000000000", title: "x" })).toThrowError(
      /NOT_FOUND|待办不存在/,
    );
  });

  it("removeTodo 删除个人待办", () => {
    const item = saveTodo({ title: "临时" }).items[0];
    const state = removeTodo(item.id);
    expect(state.items).toHaveLength(0);
  });

  it("removeTodo 未知 id 返回 NOT_FOUND", () => {
    expect(() => removeTodo("missing")).toThrowError(/NOT_FOUND|待办不存在/);
  });
});

describe("todo canvas sync", () => {
  it("未连接 Canvas 时 connected 为 false", () => {
    saveConfig({});
    expect(getTodoState().connected).toBe(false);
  });

  it("refreshTodos 拉取作业并合并到统一清单", async () => {
    const state = await refreshTodos();
    expect(state.connected).toBe(true);
    expect(state.syncedAt).not.toBeNull();
    const canvas = state.items.filter((item) => item.source === "canvas");
    expect(canvas).toHaveLength(2);
    expect(canvas[0]).toMatchObject({
      courseId: 100,
      courseName: "机器学习",
      courseCode: "CS3308",
      title: "作业一",
      dueAt: "2026-12-01T00:00:00Z",
      status: "pending",
    });
    expect(canvas[1]).toMatchObject({ title: "线下作业", status: "offline" });
  });

  it("removeTodo 拒绝删除 Canvas 作业", async () => {
    await refreshTodos();
    const canvas = getTodoState().items.find((item) => item.source === "canvas")!;
    expect(() => removeTodo(canvas.id)).toThrowError(/不能删除 Canvas 作业/);
  });
});
