import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveConfig } from "../src/config.js";
import {
  getMailState,
  listMailFolders,
  prepareEmail,
  searchMail,
  syncMail,
} from "../src/clients/mail.js";
import { resetStore } from "../src/store.js";

const h = vi.hoisted(() => ({
  listResult: [] as unknown[],
  statusResult: {} as Record<string, unknown>,
  fetchResult: [] as unknown[],
}));

vi.mock("imapflow", () => ({
  ImapFlow: class {
    on() {}
    async connect() {}
    async list() {
      return h.listResult;
    }
    async status() {
      return h.statusResult;
    }
    async getMailboxLock() {
      return { release() {} };
    }
    async fetchAll() {
      return h.fetchResult;
    }
    close() {}
  },
}));

let dir: string;

function mailConfig() {
  return {
    mail: {
      imap: { host: "mail.sjtu.edu.cn", port: 993, user: "test@sjtu.edu.cn", password: "secret", tls: true },
      smtp: { host: "mail.sjtu.edu.cn", port: 465, user: "test@sjtu.edu.cn", password: "secret", secure: true },
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campus-agent-test-"));
  process.env.CAMPUS_AGENT_CONFIG = join(dir, "config.json");
  process.env.CAMPUS_AGENT_STATE = join(dir, "state.json");
  resetStore();
  saveConfig(mailConfig());
  h.listResult = [];
  h.statusResult = {};
  h.fetchResult = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("mail client", () => {
  it("未配置时 getMailState 返回空账号", () => {
    process.env.CAMPUS_AGENT_CONFIG = join(dir, "missing.json");
    expect(getMailState().account).toBeNull();
  });

  it("syncMail 拉取文件夹与邮件头信息", async () => {
    h.listResult = [
      { path: "INBOX", name: "INBOX", flags: new Set(), specialUse: "\\Inbox" },
    ];
    h.statusResult = { messages: 2, uidNext: 3 };
    h.fetchResult = [
      {
        uid: 2,
        flags: new Set(["\\Seen"]),
        envelope: {
          subject: "第二封",
          from: [{ name: "张三", address: "zs@sjtu.edu.cn" }],
          date: new Date("2026-11-08T00:00:00Z"),
        },
        internalDate: new Date("2026-11-08T00:00:00Z"),
        size: 100,
        bodyStructure: undefined,
      },
      {
        uid: 1,
        flags: new Set(),
        envelope: {
          subject: "第一封",
          from: [{ name: "李四", address: "ls@sjtu.edu.cn" }],
          date: new Date("2026-11-07T00:00:00Z"),
        },
        internalDate: new Date("2026-11-07T00:00:00Z"),
        size: 200,
        bodyStructure: undefined,
      },
    ];
    await syncMail();
    expect(getMailState().account?.lastSyncedAt).toBeTruthy();
    const folders = listMailFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({ path: "INBOX", name: "收件箱", total: 2, unread: 1 });

    const result = searchMail({ query: "", offset: 0, limit: 30 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      subject: "第二封",
      senderAddress: "zs@sjtu.edu.cn",
    });
  });

  it("searchMail 按发件人、文件夹与日期筛选", async () => {
    h.listResult = [
      { path: "INBOX", name: "INBOX", flags: new Set(), specialUse: "\\Inbox" },
    ];
    h.statusResult = { messages: 1, uidNext: 2 };
    h.fetchResult = [
      {
        uid: 1,
        flags: new Set(),
        envelope: {
          subject: "机器学习作业",
          from: [{ name: "助教", address: "ta@sjtu.edu.cn" }],
          date: new Date("2026-11-07T00:00:00Z"),
        },
        internalDate: new Date("2026-11-07T00:00:00Z"),
        size: 50,
        bodyStructure: undefined,
      },
    ];
    await syncMail();

    expect(searchMail({ query: "机器", offset: 0, limit: 30 }).items).toHaveLength(1);
    expect(searchMail({ query: "不存在", offset: 0, limit: 30 }).items).toHaveLength(0);
    expect(searchMail({ query: "", from: "ta@", offset: 0, limit: 30 }).items).toHaveLength(1);
    expect(searchMail({ query: "", from: "x@", offset: 0, limit: 30 }).items).toHaveLength(0);
    expect(
      searchMail({ query: "", folderId: 999, offset: 0, limit: 30 }).items,
    ).toHaveLength(0);
    expect(
      searchMail({ query: "", startAt: "2026-11-08T00:00:00Z", offset: 0, limit: 30 }).items,
    ).toHaveLength(0);
  });

  it("prepareEmail 保存草稿并拒绝整封邮件引用", () => {
    const draft = prepareEmail({
      to: ["a@sjtu.edu.cn"],
      subject: "开会",
      text: "下午三点",
      attachments: [{ type: "canvas", id: "file:11" }],
    });
    expect(draft.status).toBe("draft");
    expect(draft.sent).toBe(false);
    expect(draft.draftId).toBeTruthy();

    expect(() =>
      prepareEmail({
        to: ["a@sjtu.edu.cn"],
        subject: "x",
        text: "y",
        attachments: [{ type: "mail", id: 1 }],
      }),
    ).toThrow();
  });
});
