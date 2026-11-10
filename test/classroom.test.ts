import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveConfig } from "../src/config.js";
import {
  formatSegments,
  formatTranscript,
  getTranscript,
  listCourses,
  listVideos,
  parseTranscript,
  safeFileName,
} from "../src/clients/classroom.js";
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
  if (path.includes("/authority/me")) return ok({ code: "0", result: { user: { id: 1 } } });
  if (path.includes("/list/termYear"))
    return ok([
      { id: 202, currentTerm: true },
      { id: 201 },
    ]);
  if (path.includes("/myself/curriculum"))
    return ok({
      status: 200,
      ok: true,
      dataOk: true,
      result: {
        records: [
          { teclId: 101, subjCode: "CS3308", subjName: "机器学习" },
          { teclId: 102, subjCode: "CS2101", subjName: "操作系统" },
        ],
        pageCount: 1,
      },
    });
  if (path.includes("/group_subject_vod_list/t-1"))
    return ok({
      status: 200,
      ok: true,
      dataOk: true,
      result: {
        records: [{ teclId: 101, acteId: 202, subjCode: "CS3308", subjName: "机器学习" }],
        pageCount: 1,
      },
    });
  if (path.includes("/subject_vod_list_new"))
    return ok({
      status: 200,
      ok: true,
      dataOk: true,
      result: {
        records: [
          { id: 1001, courBeginTime: "2026-09-01 08:00", courEndTime: "2026-09-01 09:40", clroName: "东中院1-101", letiNumber: "1" },
          { id: 1002, courBeginTime: "2026-09-08 08:00", courEndTime: "2026-09-08 09:40", clroName: "东中院1-101", letiNumber: 2 },
        ],
        pageCount: 1,
      },
    });
  if (/\/course\/ai\/translate\/\d+/.test(path))
    return ok({
      status: 200,
      ok: true,
      dataOk: true,
      result: {
        afterAssemblyList: [
          { bg: 0, ed: 5000, res: "大家好" },
          { bg: 5000, ed: 10000, res: "今天讲机器学习" },
        ],
      },
    });
  return ok({});
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campus-agent-test-"));
  process.env.CAMPUS_AGENT_CONFIG = join(dir, "config.json");
  process.env.CAMPUS_AGENT_STATE = join(dir, "state.json");
  resetStore();
  saveConfig({ campus: { cookie: "test-cookie" } });
  vi.stubGlobal("fetch", vi.fn((input: unknown) => Promise.resolve(route(input))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("classroom pure helpers", () => {
  it("parseTranscript 解析、过滤空段并排序", () => {
    expect(parseTranscript(null, 1)).toBeNull();
    expect(parseTranscript({ afterAssemblyList: [{ bg: 0, ed: 10, res: "  " }] }, 1)).toBeNull();
    const transcript = parseTranscript(
      {
        afterAssemblyList: [
          { bg: 10000, ed: 15000, res: "第二段" },
          { bg: 0, ed: 5000, res: "第一段" },
        ],
      },
      7,
    );
    expect(transcript?.videoId).toBe(7);
    expect(transcript?.segments).toEqual([
      { startMs: 0, endMs: 5000, text: "第一段" },
      { startMs: 10000, endMs: 15000, text: "第二段" },
    ]);
  });

  it("formatSegments / formatTranscript 生成带时间戳文本", () => {
    const segments = [{ startMs: 0, endMs: 5000, text: "大家好" }];
    expect(formatSegments(segments)).toBe("[00:00:00.000–00:00:05.000] 大家好\n");
    const output = formatTranscript({ videoId: 1, segments }, "机器学习 · 2026-09-01");
    expect(output.startsWith("机器学习 · 2026-09-01\n录像 ID：1\n\n")).toBe(true);
  });

  it("safeFileName 清理非法字符", () => {
    expect(safeFileName("a/b\\c:d*e?f")).toBe("a_b_c_d_e_f");
  });
});

describe("classroom client", () => {
  it("listCourses 去重合并两路课程列表", async () => {
    const courses = await listCourses();
    expect(courses).toHaveLength(2);
    expect(courses[0]).toEqual({ id: 101, code: "CS3308", name: "机器学习" });
    expect(courses[1]).toEqual({ id: 102, code: "CS2101", name: "操作系统" });
  });

  it("listVideos 返回录像节次", async () => {
    const videos = await listVideos(101);
    expect(videos).toHaveLength(2);
    expect(videos[0]).toMatchObject({ id: 1001, room: "东中院1-101", period: "1" });
    expect(videos[1].period).toBe("2");
  });

  it("getTranscript 拉取并解析文稿", async () => {
    const transcript = await getTranscript(1001);
    expect(transcript?.videoId).toBe(1001);
    expect(transcript?.segments).toHaveLength(2);
  });
});
