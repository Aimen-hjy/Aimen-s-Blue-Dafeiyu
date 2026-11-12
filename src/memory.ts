import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { activeProfileName, baseDir, profilesDir } from "./config.js";

/**
 * agent 的持久记忆：key → { value, description, updatedAt }。
 * 存登录等必要信息、常用 courseId 等高频信息；按 profile 隔离，落盘为 JSON。
 */
export interface MemoryEntry {
  value: string;
  description?: string;
  updatedAt: string;
}

type MemoryStore = Record<string, MemoryEntry>;

let cache: MemoryStore | null = null;

function memoryPath(): string {
  if (process.env.CAMPUS_AGENT_MEMORY) return process.env.CAMPUS_AGENT_MEMORY;
  const name = activeProfileName();
  return name
    ? join(profilesDir(), `${name}.memory.json`)
    : join(baseDir(), "memory.json");
}

function load(): MemoryStore {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(memoryPath(), "utf8")) as MemoryStore;
  } catch {
    cache = {};
  }
  return cache;
}

function persist(): void {
  const path = memoryPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache ?? {}, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

/** 清空内存缓存（测试用）。 */
export function resetMemory(): void {
  cache = null;
}

export function saveMemory(key: string, value: string, description?: string): void {
  const store = load();
  store[key] = {
    value,
    ...(description ? { description } : {}),
    updatedAt: new Date().toISOString(),
  };
  persist();
}

export function recallMemory(key: string): MemoryEntry | undefined {
  return load()[key];
}

export function listMemory(): Array<{ key: string } & MemoryEntry> {
  const store = load();
  return Object.entries(store)
    .map(([key, entry]) => ({ key, ...entry }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function removeMemory(key: string): boolean {
  const store = load();
  if (!(key in store)) return false;
  delete store[key];
  persist();
  return true;
}
