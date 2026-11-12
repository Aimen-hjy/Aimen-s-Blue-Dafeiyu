import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeProfileName,
  configPath,
  isValidProfileName,
  listProfiles,
  profileConfigPath,
  profilesDir,
  removeProfile,
  saveConfig,
  setActiveProfile,
} from "../src/config.js";
import { listMemory, recallMemory, removeMemory, resetMemory, saveMemory } from "../src/memory.js";
import { resetStore } from "../src/store.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campus-agent-prof-"));
  process.env.CAMPUS_AGENT_HOME = dir;
  delete process.env.CAMPUS_AGENT_CONFIG;
  delete process.env.CAMPUS_AGENT_STATE;
  delete process.env.CAMPUS_AGENT_MEMORY;
  resetStore();
  resetMemory();
});

afterEach(() => {
  delete process.env.CAMPUS_AGENT_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("profile 多账号", () => {
  it("默认 profile 指向 baseDir/config.json", () => {
    expect(activeProfileName()).toBe("");
    expect(configPath()).toBe(join(dir, "config.json"));
  });

  it("setActiveProfile 切换后 configPath 指向 profile 文件", () => {
    setActiveProfile("alice");
    expect(activeProfileName()).toBe("alice");
    expect(configPath()).toBe(join(profilesDir(), "alice.json"));
    setActiveProfile("");
    expect(activeProfileName()).toBe("");
  });

  it("add→list→use→remove 流程", () => {
    expect(listProfiles()).toEqual([]);
    setActiveProfile("alice");
    saveConfig({});
    expect(listProfiles()).toEqual(["alice"]);

    setActiveProfile("bob");
    saveConfig({});
    expect(listProfiles()).toEqual(["alice", "bob"]);
    expect(activeProfileName()).toBe("bob");

    removeProfile("alice");
    expect(listProfiles()).toEqual(["bob"]);
  });

  it("isValidProfileName 拒绝非法名与 default", () => {
    expect(isValidProfileName("alice_2026")).toBe(true);
    expect(isValidProfileName("default")).toBe(false);
    expect(isValidProfileName("a/b")).toBe(false);
    expect(isValidProfileName("")).toBe(false);
  });

  it("profileConfigPath 区分 default 与命名 profile", () => {
    expect(profileConfigPath("default")).toBe(join(dir, "config.json"));
    expect(profileConfigPath("alice")).toBe(join(profilesDir(), "alice.json"));
  });
});

describe("memory 持久记忆", () => {
  it("save/recall/list/remove", () => {
    expect(recallMemory("k1")).toBeUndefined();
    saveMemory("k1", "v1", "desc1");
    expect(recallMemory("k1")).toMatchObject({ value: "v1", description: "desc1" });
    saveMemory("k2", "v2");
    expect(listMemory()).toHaveLength(2);
    expect(removeMemory("k1")).toBe(true);
    expect(removeMemory("k1")).toBe(false);
    expect(listMemory()).toHaveLength(1);
  });

  it("记忆按 profile 隔离", () => {
    saveMemory("k", "default-value");
    setActiveProfile("other");
    resetMemory();
    expect(recallMemory("k")).toBeUndefined();
  });
});
