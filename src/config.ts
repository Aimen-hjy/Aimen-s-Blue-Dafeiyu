import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { readConfigFile, writeConfigFile } from "./credentials.js";

export const CanvasConfig = z.object({
  baseUrl: z.string().default("https://oc.sjtu.edu.cn"),
  accessToken: z.string().default(""),
});

export const MailConfig = z.object({
  imap: z.object({
    host: z.string(),
    port: z.number().int().default(993),
    user: z.string(),
    password: z.string(),
    tls: z.boolean().default(true),
  }),
  smtp: z.object({
    host: z.string(),
    port: z.number().int().default(465),
    user: z.string(),
    password: z.string(),
    secure: z.boolean().default(true),
  }),
});

export const CampusConfig = z.object({
  cookie: z.string().default(""),
  username: z.string().default(""),
  password: z.string().default(""),
  /** 手动/内置都不满足时的开学日期覆盖：`{ "2026-2027-1": "2026-09-14" }`。 */
  semesterStarts: z.record(z.string()).default({}),
});

export const ShuiyuanConfig = z.object({
  key: z.string().default(""),
  clientId: z.string().default(""),
  username: z.string().default(""),
  boundAt: z.string().default(""),
});

export const ConfigSchema = z.object({
  canvas: CanvasConfig.optional(),
  mail: MailConfig.optional(),
  campus: CampusConfig.optional(),
  shuiyuan: ShuiyuanConfig.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type CanvasConfigT = z.infer<typeof CanvasConfig>;
export type MailConfigT = z.infer<typeof MailConfig>;
export type CampusConfigT = z.infer<typeof CampusConfig>;
export type ShuiyuanConfigT = z.infer<typeof ShuiyuanConfig>;

export function configPath(): string {
  return (
    process.env.CAMPUS_AGENT_CONFIG ??
    join(homedir(), ".campus-agent", "config.json")
  );
}

/** 读取并解析配置。文件不存在时返回空对象（各客户端自行校验所需字段）。 */
export function loadConfig(): Config {
  const path = configPath();
  let raw: string;
  try {
    raw = readConfigFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  if (!raw.trim()) return {};
  return ConfigSchema.parse(JSON.parse(raw));
}

export function saveConfig(config: Config): void {
  writeConfigFile(configPath(), JSON.stringify(config, null, 2));
}
