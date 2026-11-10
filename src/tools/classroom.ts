import { stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  formatSegments,
  formatTranscript,
  getTranscript,
  listCourses,
  listVideos,
  safeFileName,
} from "../clients/classroom.js";
import { toolError } from "../errors.js";
import { limit, match, offset, page, query, tool } from "./shared.js";

const id = z.number().int().positive();
const transcriptLimit = z.number().int().min(1).max(12000).default(6000);

export function registerClassroomTools(server: McpServer): void {
  tool(
    server,
    "list_classroom_courses",
    "联网列出本学期课堂视频课程，返回教学班 ID。需要先登录交大视频（配置 campus.cookie）。",
    { query, offset, limit },
    async ({ query, offset, limit }) =>
      page(
        (await listCourses()).filter((course) => match(`${course.name} ${course.code}`, query)),
        offset,
        limit,
      ),
  );

  tool(
    server,
    "list_classroom_videos",
    "联网列出指定教学班的录像节次；返回的录像 id 用于读取或下载语音文稿。",
    { courseId: id, offset, limit },
    async ({ courseId, offset, limit }) => page(await listVideos(courseId), offset, limit),
  );

  tool(
    server,
    "read_classroom_transcript",
    "读取录像时间范围内的语音文稿，不写文件、不要求工作区。时间单位为秒，默认读取前五分钟；包含与区间重叠的完整段落，正文按字符分页，nextOffset 用于同一区间续读。",
    {
      videoId: id,
      startSeconds: z.number().nonnegative().default(0),
      endSeconds: z.number().positive().optional(),
      offset,
      limit: transcriptLimit,
    },
    async ({ videoId, startSeconds, endSeconds = startSeconds + 300, offset, limit }) => {
      if (endSeconds <= startSeconds)
        throw toolError("INVALID_INPUT", "结束时间必须晚于开始时间");
      const transcript = await getTranscript(videoId);
      const segments =
        transcript?.segments.filter(
          (segment) => segment.endMs > startSeconds * 1000 && segment.startMs < endSeconds * 1000,
        ) ?? [];
      const text = segments.length ? formatSegments(segments) : "";
      return {
        videoId,
        available: transcript !== null,
        startSeconds,
        endSeconds,
        text: text.slice(offset, offset + limit),
        totalCharacters: text.length,
        nextOffset: offset + limit < text.length ? offset + limit : null,
        nextStartSeconds: transcript?.segments.some((segment) => segment.endMs > endSeconds * 1000)
          ? endSeconds
          : null,
      };
    },
  );

  tool(
    server,
    "download_classroom_transcripts",
    "将同一课程中选定节次的完整文稿逐节保存为 TXT，返回各项结果，不返回正文。必须明确指定本机绝对目录；已有文件不覆盖。不支持远端目录。",
    { courseId: id, videoIds: z.array(id).min(1).max(100), directory: z.string().min(1) },
    async ({ courseId, videoIds, directory }) => {
      if (!isAbsolute(directory))
        throw toolError("INVALID_INPUT", "请指定本机文件夹的绝对路径");
      if (!(await stat(directory)).isDirectory())
        throw toolError("INVALID_INPUT", "保存位置不是文件夹");
      const course = (await listCourses()).find((course) => course.id === courseId);
      if (!course) throw toolError("NOT_FOUND", "未找到指定课程，请先列出课堂视频课程");
      const videos = await listVideos(courseId);
      const selected = [...new Set(videoIds)].map((videoId) => {
        const video = videos.find((item) => item.id === videoId);
        if (!video) throw toolError("NOT_FOUND", `录像 ${videoId} 不在指定课程中`);
        return video;
      });
      const results: Array<{
        videoId: number;
        status: "saved" | "unavailable" | "failed";
        path?: string;
        error?: string;
      }> = [];
      for (const video of selected) {
        try {
          const transcript = await getTranscript(video.id);
          if (!transcript) {
            results.push({ videoId: video.id, status: "unavailable" });
            continue;
          }
          const title = `${course.name} · ${video.start} · 第 ${video.period || "?"} 节`;
          const name = safeFileName(`${course.name}-${video.start}`);
          const path = join(directory, `${name}-${video.id}.txt`);
          await writeFile(path, formatTranscript(transcript, title), {
            encoding: "utf8",
            flag: "wx",
          });
          results.push({ videoId: video.id, status: "saved", path });
        } catch (error) {
          results.push({
            videoId: video.id,
            status: "failed",
            error: error instanceof Error ? error.message : "文稿保存失败",
          });
        }
      }
      return { courseId, results };
    },
  );
}
