import { randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import type { ListResponse, MessageStructureObject } from "imapflow";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { toolError } from "../errors.js";
import { getState, setState } from "../store.js";

export interface MailAddress {
  name: string | null;
  address: string | null;
}

export interface MailFolderInfo {
  id: number;
  path: string;
  name: string;
  specialUse: string | null;
  total: number | null;
  unread: number | null;
  lastSyncedAt: string | null;
}

export interface MailMessageSummary {
  id: number;
  uid: number;
  folderId: number;
  subject: string | null;
  sender: MailAddress | null;
  date: string | null;
  seen: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  snippet: string | null;
  size: number | null;
}

export interface MailState {
  account: { address: string; lastSyncedAt: string | null } | null;
}

export const resourceRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("canvas"), id: z.string().min(1).max(512) }),
  z.object({ type: z.literal("mail"), id: z.number().int().positive() }),
  z.object({
    type: z.literal("attachment"),
    messageId: z.number().int().positive(),
    part: z.string().regex(/^\d+(?:\.\d+)*$/),
  }),
]);

export type ResourceRef = z.infer<typeof resourceRefSchema>;

export interface MailSearchInput {
  query: string;
  from?: string;
  folderId?: number;
  startAt?: string;
  endAt?: string;
  offset: number;
  limit: number;
}

export interface PreparedEmailInput {
  to: string[];
  subject: string;
  text: string;
  attachments: ResourceRef[];
}

const STATE_KEY = "mail";
const DRAFTS_KEY = "mailDrafts";
const SYNC_WINDOW = 300;

const SPECIAL_USE_LABELS: Record<string, string> = {
  "\\Inbox": "收件箱",
  "\\Flagged": "重要",
  "\\Drafts": "草稿箱",
  "\\Sent": "已发送",
  "\\Junk": "垃圾邮件",
  "\\Trash": "已删除",
  "\\Archive": "归档",
};

const SPECIAL_USE_ORDER: Record<string, number> = {
  "\\Inbox": 0,
  "\\Drafts": 1,
  "\\Sent": 2,
  "\\Junk": 3,
  "\\Trash": 4,
  "\\Archive": 5,
};

interface MailStore {
  account: { address: string; lastSyncedAt: string | null } | null;
  folders: MailFolderInfo[];
  messages: MailMessageSummary[];
}

interface MailAccount {
  address: string;
  password: string;
  host: string;
  port: number;
  tls: boolean;
}

function loadMail(): MailStore {
  const saved = getState<MailStore>(STATE_KEY);
  return { account: saved?.account ?? null, folders: saved?.folders ?? [], messages: saved?.messages ?? [] };
}

function saveMail(store: MailStore): void {
  setState(STATE_KEY, store);
}

function mailAccount(): MailAccount | null {
  const imap = loadConfig().mail?.imap;
  const address = imap?.user?.trim();
  if (!address || !imap?.password) return null;
  return {
    address,
    password: imap.password,
    host: imap.host || "mail.sjtu.edu.cn",
    port: imap.port || 993,
    tls: imap.tls ?? true,
  };
}

export function requireMailConfigured(): MailAccount {
  const account = mailAccount();
  if (!account)
    throw toolError("NOT_CONFIGURED", "邮箱未连接：请先在配置中设置 mail.imap 账号与密码");
  return account;
}

export function getMailState(): MailState {
  const account = mailAccount();
  const saved = loadMail();
  return {
    account: account
      ? { address: account.address, lastSyncedAt: saved.account?.lastSyncedAt ?? null }
      : null,
  };
}

function friendlyError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message;
    if (/auth|login|password|credential|invalid/i.test(message)) {
      return "登录被拒绝：请检查邮箱地址与密码";
    }
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|certificate|TLS|SSL/i.test(message)) {
      return `无法连接邮件服务器：${message}`;
    }
    return message;
  }
  return String(error);
}

function connectImap(account: MailAccount): ImapFlow {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.tls,
    auth: { user: account.address, pass: account.password },
    logger: false,
  });
  client.on("error", () => {});
  return client;
}

function specialUseRank(specialUse: string | false | null | undefined): number {
  return specialUse ? (SPECIAL_USE_ORDER[specialUse] ?? 90) : 90;
}

function orderFolders(folders: ListResponse[]): ListResponse[] {
  return [...folders].sort((a, b) => {
    const rankA = specialUseRank(a.specialUse);
    const rankB = specialUseRank(b.specialUse);
    if (rankA !== rankB) return rankA - rankB;
    return a.path.localeCompare(b.path);
  });
}

function toIso(value: Date | string | undefined): string | null {
  if (value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function hasAttachments(structure: MessageStructureObject | undefined): boolean {
  if (!structure) return false;
  if (structure.disposition === "attachment" || structure.dispositionParameters?.filename) return true;
  return structure.childNodes?.some(hasAttachments) ?? false;
}

/** 联网同步：列文件夹 + 每文件夹拉最近 SYNC_WINDOW 封的头信息，覆盖写入本地缓存。 */
export async function syncMail(): Promise<void> {
  const account = requireMailConfigured();
  const client = connectImap(account);
  try {
    await client.connect();
    const listed = await client.list();
    const folders = orderFolders(
      listed.filter(
        (folder) =>
          !folder.flags.has("\\Noselect") &&
          folder.specialUse !== "\\Drafts" &&
          folder.specialUse !== "\\Trash",
      ),
    );
    const folderInfos: MailFolderInfo[] = [];
    const messages: MailMessageSummary[] = [];
    let nextMessageId = 1;
    for (const [index, folder] of folders.entries()) {
      const folderId = index + 1;
      const status = await client.status(folder.path, { messages: true, uidNext: true });
      const total = status.messages ?? null;
      const uidNext = status.uidNext !== undefined ? Number(status.uidNext) : 1;
      const start = Math.max(1, Math.max(1, uidNext - 1) - SYNC_WINDOW + 1);
      let unread = 0;
      if (total !== null && total > 0) {
        const lock = await client.getMailboxLock(folder.path);
        try {
          const headers = await client.fetchAll(
            { uid: `${start}:*` },
            { uid: true, flags: true, envelope: true, internalDate: true, size: true, bodyStructure: true },
            { uid: true },
          );
          for (const message of headers) {
            const envelope = message.envelope;
            const from = envelope?.from?.[0];
            const seen = message.flags?.has("\\Seen") ?? false;
            if (!seen) unread += 1;
            messages.push({
              id: nextMessageId++,
              uid: message.uid,
              folderId,
              subject: envelope?.subject ?? null,
              sender:
                from?.address || from?.name
                  ? { name: from?.name ?? null, address: from?.address ?? null }
                  : null,
              date: toIso(message.internalDate ?? envelope?.date),
              seen,
              flagged: message.flags?.has("\\Flagged") ?? false,
              hasAttachments: hasAttachments(message.bodyStructure),
              snippet: null,
              size: message.size ?? null,
            });
          }
        } finally {
          lock.release();
        }
      }
      folderInfos.push({
        id: folderId,
        path: folder.path,
        name: folder.specialUse ? (SPECIAL_USE_LABELS[folder.specialUse] ?? folder.name) : folder.name,
        specialUse: folder.specialUse ?? null,
        total,
        unread,
        lastSyncedAt: new Date().toISOString(),
      });
    }
    saveMail({
      account: { address: account.address, lastSyncedAt: new Date().toISOString() },
      folders: folderInfos,
      messages,
    });
  } catch (error) {
    throw toolError("UPSTREAM_ERROR", friendlyError(error));
  } finally {
    client.close();
  }
}

export function listMailFolders(): MailFolderInfo[] {
  return loadMail().folders;
}

export function searchMail(input: MailSearchInput) {
  const store = loadMail();
  const keyword = input.query.toLowerCase();
  const filtered = store.messages.filter((message) => {
    const subject = (message.subject ?? "").toLowerCase();
    const snippet = (message.snippet ?? "").toLowerCase();
    if (!subject.includes(keyword) && !snippet.includes(keyword)) return false;
    if (input.from !== undefined) {
      const from = `${message.sender?.address ?? ""} ${message.sender?.name ?? ""}`.toLowerCase();
      if (!from.includes(input.from.toLowerCase())) return false;
    }
    if (input.folderId !== undefined && message.folderId !== input.folderId) return false;
    if (input.startAt !== undefined) {
      const date = message.date ? Date.parse(message.date) : NaN;
      if (Number.isNaN(date) || date < Date.parse(input.startAt)) return false;
    }
    if (input.endAt !== undefined) {
      const date = message.date ? Date.parse(message.date) : NaN;
      if (Number.isNaN(date) || date >= Date.parse(input.endAt)) return false;
    }
    return true;
  });
  filtered.sort((a, b) => {
    if (a.date === null && b.date !== null) return 1;
    if (a.date !== null && b.date === null) return -1;
    if (a.date !== null && b.date !== null) {
      const cmp = b.date.localeCompare(a.date);
      if (cmp !== 0) return cmp;
    }
    return b.id - a.id;
  });
  const nextOffset =
    input.offset + input.limit < filtered.length ? input.offset + input.limit : null;
  const folders = store.folders
    .filter((folder) => input.folderId === undefined || folder.id === input.folderId)
    .map((folder) => ({ id: folder.id, name: folder.name, syncedAt: folder.lastSyncedAt }));
  return {
    items: filtered
      .slice(input.offset, input.offset + input.limit)
      .map((message) => ({
        id: message.id,
        subject: message.subject,
        senderName: message.sender?.name ?? null,
        senderAddress: message.sender?.address ?? null,
        date: message.date,
        snippet: message.snippet,
        folderId: message.folderId,
        ref: { type: "mail" as const, id: message.id },
      })),
    nextOffset,
    coverage: {
      scope: "cached_subjects_and_snippets",
      uidWindowPerFolder: SYNC_WINDOW,
      completeMailbox: false,
      folders,
    },
  };
}

export function prepareEmail(input: PreparedEmailInput) {
  if (input.attachments.some((ref) => ref.type === "mail"))
    throw toolError("INVALID_INPUT", "附件必须引用文件或邮件附件，不能引用整封邮件");
  const id = randomUUID();
  const drafts = getState<Record<string, unknown>>(DRAFTS_KEY) ?? {};
  drafts[id] = { ...input, createdAt: new Date().toISOString() };
  setState(DRAFTS_KEY, drafts);
  return {
    draftId: id,
    to: input.to,
    subject: input.subject,
    text: input.text,
    attachments: input.attachments,
    status: "draft",
    sent: false,
  };
}
