import { z } from "zod";
import { campusRequest } from "../campus-auth.js";
import { toolError } from "../errors.js";

export interface VideoCourse {
  id: number;
  code: string;
  name: string;
}

export interface ClassroomVideo {
  id: number;
  start: string;
  end: string;
  room: string;
  period: string;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface VideoTranscript {
  videoId: number;
  segments: TranscriptSegment[];
}

const VIDEO_HOME = "https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/";
const BASE = "https://v.sjtu.edu.cn/jy-application-resourcemanage/v1";
// 官方页面自用的身份接口；Canvas LTI 取得的会话 Cookie 只作用于该路径。
const ME = "https://v.sjtu.edu.cn/jy-application-resourcemanage/authority/me";
const LOGIN_ERROR = "校园会话已失效，请登录交大视频";

const object = z.record(z.string(), z.unknown());
const id = z.coerce.number().int().positive();

async function campusJson(url: string, loginStatus?: number): Promise<unknown> {
  const text = await campusRequest(url, {
    service: "交大视频",
    loginError: LOGIN_ERROR,
    loginStatus,
    headers: { Accept: "application/json", Referer: VIDEO_HOME },
  });
  try {
    return JSON.parse(text);
  } catch {
    throw toolError("UPSTREAM_ERROR", "交大视频没有返回预期数据，请重新登录");
  }
}

function checkIdentity(response: unknown): void {
  const payload = object.safeParse(response);
  if (
    !payload.success ||
    String(payload.data.code) !== "0" ||
    !object.safeParse(payload.data.result).data?.user
  )
    throw toolError("AUTH_EXPIRED", LOGIN_ERROR);
}

export async function checkVideoLogin(): Promise<void> {
  checkIdentity(await campusJson(ME, 500));
}

function unwrap(payload: unknown): unknown {
  const parsed = object.safeParse(payload);
  if (!parsed.success) throw toolError("UPSTREAM_ERROR", "交大视频响应数据格式已变化");
  const result = parsed.data;
  if (result.status === 401 || result.status === 403 || result.code === "-1")
    throw toolError("AUTH_EXPIRED", LOGIN_ERROR);
  if (
    result.ok === false ||
    result.dataOk === false ||
    (typeof result.status === "number" && result.status !== 200)
  )
    throw toolError("UPSTREAM_ERROR", "交大视频接口请求失败");
  return result.result ?? result.data;
}

async function allPages(path: string, params: Record<string, string>): Promise<unknown[]> {
  const records: unknown[] = [];
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({
      ...params,
      "page.pageIndex": String(page),
      "page.pageSize": "1000",
    });
    const response = await campusJson(`${BASE}/${path}?${query}`);
    const data = unwrap(response);
    // 官方接口的成功空分页使用 null；只在第一页且明确零记录时接受。
    if (
      page === 1 &&
      z.object({ ok: z.literal(true), dataOk: z.literal(true) }).safeParse(response).success &&
      z
        .object({ records: z.null(), rowCount: z.literal(0), pageCount: z.literal(0) })
        .safeParse(data).success
    )
      return [];
    const parsed = z
      .object({ records: z.array(z.unknown()), pageCount: z.number().int().nonnegative().optional() })
      .safeParse(data);
    if (!parsed.success) throw toolError("UPSTREAM_ERROR", "交大视频列表数据格式已变化");
    records.push(...parsed.data.records);
    if (
      parsed.data.pageCount !== undefined
        ? page >= parsed.data.pageCount
        : parsed.data.records.length < 1000
    )
      return records;
  }
}

export async function listCourses(): Promise<VideoCourse[]> {
  await checkVideoLogin();
  const termResponse = await campusJson(`${BASE}/list/termYear`);
  const terms = z
    .array(z.object({ id, currentTerm: z.boolean().optional() }))
    .safeParse(Array.isArray(termResponse) ? termResponse : unwrap(termResponse));
  if (!terms.success) throw toolError("UPSTREAM_ERROR", "交大视频学期数据格式已变化");
  const term = terms.data.find((value) => value.currentTerm) ?? terms.data.at(-1);
  if (!term) return [];
  const records = await allPages("myself/curriculum", {
    acteId: String(term.id),
    courBeginTime: "",
    courEndTime: "",
  });
  records.push(
    ...(
      await allPages("group_subject_vod_list/t-1", {
        "page.orders[0].asc": "false",
        "page.orders[0].field": "courBeginTime",
      })
    ).filter((raw) => {
      const course = z.object({ acteId: id }).safeParse(raw);
      if (!course.success) throw toolError("UPSTREAM_ERROR", "交大视频课程学期数据格式已变化");
      return course.data.acteId === term.id;
    }),
  );
  const courses = new Map<number, VideoCourse>();
  for (const raw of records) {
    const course = z
      .object({ teclId: id.nullable(), subjCode: z.string().nullish(), subjName: z.string() })
      .safeParse(raw);
    if (!course.success) throw toolError("UPSTREAM_ERROR", "交大视频课程数据格式已变化");
    if (course.data.teclId)
      courses.set(course.data.teclId, {
        id: course.data.teclId,
        code: course.data.subjCode ?? "",
        name: course.data.subjName,
      });
  }
  return [...courses.values()];
}

export async function listVideos(courseId: number): Promise<ClassroomVideo[]> {
  await checkVideoLogin();
  const records = await allPages("subject_vod_list_new", {
    teclIds: String(id.parse(courseId)),
    "page.orders[0].asc": "false",
    "page.orders[0].field": "courBeginTime",
  });
  return records.map((raw) => {
    const video = z
      .object({
        id,
        courBeginTime: z.string(),
        courEndTime: z.string(),
        clroName: z.string().nullish(),
        letiNumber: z.union([z.string(), z.number()]).nullish(),
      })
      .safeParse(raw);
    if (!video.success) throw toolError("UPSTREAM_ERROR", "交大视频录像数据格式已变化");
    return {
      id: video.data.id,
      start: video.data.courBeginTime,
      end: video.data.courEndTime,
      room: video.data.clroName ?? "",
      period: String(video.data.letiNumber ?? ""),
    };
  });
}

const segmentSchema = z
  .object({ bg: z.number().nonnegative(), ed: z.number().nonnegative(), res: z.string() })
  .refine((value) => value.ed >= value.bg);
const transcriptDataSchema = z.object({ afterAssemblyList: z.array(segmentSchema) });

export function parseTranscript(data: unknown, videoId: number): VideoTranscript | null {
  if (data === null) return null;
  const parsed = transcriptDataSchema.safeParse(data);
  if (!parsed.success) throw toolError("UPSTREAM_ERROR", "交大视频文稿数据格式已变化");
  const segments = parsed.data.afterAssemblyList
    .map(({ bg, ed, res }) => ({ startMs: bg, endMs: ed, text: res.trim() }))
    .filter(({ text }) => text.length > 0)
    .sort((a, b) => a.startMs - b.startMs);
  return segments.length ? { videoId, segments } : null;
}

export async function getTranscript(videoId: number): Promise<VideoTranscript | null> {
  const parsedId = id.parse(videoId);
  const url = `${BASE}/course/ai/translate/${parsedId}?useOriginal=true`;
  const response = await campusJson(url);
  const empty = z
    .object({ code: z.null(), status: z.literal(200), ok: z.literal(true), data: z.null() })
    .safeParse(response).success;
  return parseTranscript(empty ? null : unwrap(response), parsedId);
}

function timestamp(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return `${time}.${String(Math.floor(ms % 1000)).padStart(3, "0")}`;
}

/** 跨平台保存文件名：非法字符与控制字符换成下划线，去掉结尾的点/空格，限长 100。 */
export function safeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
}

/** 正文单独导出：分页读取不携带存文件用的标题头。 */
export function formatSegments(segments: TranscriptSegment[]): string {
  return `${segments
    .map(({ startMs, endMs, text }) => `[${timestamp(startMs)}–${timestamp(endMs)}] ${text}`)
    .join("\n\n")}\n`;
}

export function formatTranscript(transcript: VideoTranscript, title: string): string {
  return `${title}\n录像 ID：${transcript.videoId}\n\n${formatSegments(transcript.segments)}`;
}
