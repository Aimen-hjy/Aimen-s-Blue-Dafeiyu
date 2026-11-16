import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

export const DeepSeekConfig = z.object({
  /** 平台开放 API 的 sk- key（余额、对话、视觉问答等）。 */
  apiKey: z.string().default(""),
  /** 平台私密接口的登录态 userToken（用于按天查询消费金额）。 */
  userToken: z.string().default(""),
  /** chat.deepseek.com 网页端的 user_token（localStorage），用于 chat 模式走网页内部接口。 */
  chatToken: z.string().default(""),
});

export const ConfigSchema = z.object({
  canvas: CanvasConfig.optional(),
  mail: MailConfig.optional(),
  campus: CampusConfig.optional(),
  shuiyuan: ShuiyuanConfig.optional(),
  deepseek: DeepSeekConfig.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type CanvasConfigT = z.infer<typeof CanvasConfig>;
export type MailConfigT = z.infer<typeof MailConfig>;
export type CampusConfigT = z.infer<typeof CampusConfig>;
export type ShuiyuanConfigT = z.infer<typeof ShuiyuanConfig>;
export type DeepSeekConfigT = z.infer<typeof DeepSeekConfig>;

/** 多账号：命名 profile 目录，每个 profile 一份 config + state + memory。 */
export function baseDir(): string {
  return process.env.CAMPUS_AGENT_HOME ?? join(homedir(), ".campus-agent");
}

export function profilesDir(): string {
  return join(baseDir(), "profiles");
}

const ACTIVE_PROFILE_FILE = "active-profile";

function activeProfileFilePath(): string {
  return join(baseDir(), ACTIVE_PROFILE_FILE);
}

/** 当前激活的 profile 名；空串表示默认（兼容旧的 config.json / state.json）。 */
export function activeProfileName(): string {
  try {
    return readFileSync(activeProfileFilePath(), "utf8").trim();
  } catch {
    return "";
  }
}

export function setActiveProfile(name: string): void {
  mkdirSync(baseDir(), { recursive: true });
  writeFileSync(activeProfileFilePath(), name.trim() ? `${name.trim()}\n` : "", "utf8");
}

export const PROFILE_NAME = /^[A-Za-z0-9_-]{1,40}$/;

export function isValidProfileName(name: string): boolean {
  return PROFILE_NAME.test(name) && name !== "default";
}

export function listProfiles(): string[] {
  const names = new Set<string>();
  if (existsSync(join(baseDir(), "config.json"))) names.add("default");
  try {
    for (const entry of readdirSync(profilesDir(), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json")) names.add(entry.name.slice(0, -5));
    }
  } catch {
    // 尚无 profiles 目录
  }
  return [...names].sort();
}

export function profileConfigPath(name: string): string {
  return name === "default"
    ? join(baseDir(), "config.json")
    : join(profilesDir(), `${name}.json`);
}

/** 删除命名 profile 的 config/state/memory 文件（default 不可删）。 */
export function removeProfile(name: string): void {
  if (!isValidProfileName(name)) throw new Error("无效的 profile 名（default 不可删除）");
  for (const suffix of [".json", ".state.json", ".memory.json"]) {
    rmSync(join(profilesDir(), `${name}${suffix}`), { force: true });
  }
}

export function configPath(): string {
  if (process.env.CAMPUS_AGENT_CONFIG) return process.env.CAMPUS_AGENT_CONFIG;
  const name = activeProfileName();
  return name ? profileConfigPath(name) : profileConfigPath("default");
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
