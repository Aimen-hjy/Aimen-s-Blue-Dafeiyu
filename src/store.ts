import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * 本地持久化状态（课程缓存、TODO 等）：
 * 单进程内存缓存 + 原子写盘到 ~/.campus-agent/state.json。
 */
type State = Record<string, unknown>;

let cache: State | null = null;

function statePath(): string {
  return process.env.CAMPUS_AGENT_STATE ?? join(homedir(), ".campus-agent", "state.json");
}

function load(): State {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(statePath(), "utf8")) as State;
  } catch {
    cache = {};
  }
  return cache;
}

function persist(): void {
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache ?? {}, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

export function getState<T>(key: string): T | undefined {
  return load()[key] as T | undefined;
}

/** 清空内存缓存（测试用），下次访问重新从磁盘读取。 */
export function resetStore(): void {
  cache = null;
}

export function setState<T>(key: string, value: T): void {
  load()[key] = value as unknown;
  persist();
}
