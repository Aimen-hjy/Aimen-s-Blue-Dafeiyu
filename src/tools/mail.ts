import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getMailState,
  listMailFolders,
  prepareEmail,
  resourceRefSchema,
  searchMail,
  syncMail,
} from "../clients/mail.js";
import { toolError } from "../errors.js";
import { coverage, freshness, limit, offset, query, tool } from "./shared.js";

async function ensureMailSynced(): Promise<void> {
  const state = getMailState();
  if (!state.account)
    throw toolError("NOT_CONFIGURED", "邮箱未连接：请先在配置中设置 mail.imap 账号与密码");
  if (!state.account.lastSyncedAt) await syncMail();
}

export function registerMailTools(server: McpServer): void {
  tool(
    server,
    "search_mail",
    "搜索已缓存邮件的主题和摘要，可按发件人、日期和文件夹筛选（folderId 取自 list_mail_folders）。只读。不是完整邮箱或正文搜索；未找到不能证明邮件不存在。",
    {
      query,
      from: z.string().max(320).optional(),
      folderId: z.number().int().positive().optional(),
      startAt: z.string().datetime().optional(),
      endAt: z.string().datetime().optional(),
      offset,
      limit,
    },
    async (input) => {
      await ensureMailSynced();
      const state = getMailState();
      const { items, nextOffset, coverage: window } = searchMail(input);
      return {
        items,
        nextOffset,
        freshness: freshness("cached", state.account!.lastSyncedAt),
        coverage: {
          ...coverage("cached_subjects_and_snippets:uid300", false, [
            "仅搜索缓存的主题与摘要，不含正文；每个文件夹只覆盖最近 300 封邮件",
          ]),
          folders: window.folders,
        },
      };
    },
  );

  tool(
    server,
    "list_mail_folders",
    "列出邮箱的全部文件夹：id、名称、邮件总数、未读数与各自的最近同步时间。只读。search_mail 的 folderId 筛选使用这里返回的 id。",
    {},
    async () => {
      await ensureMailSynced();
      const state = getMailState();
      const folders = listMailFolders();
      return {
        items: folders,
        freshness: freshness("cached", state.account!.lastSyncedAt),
        coverage: coverage(
          "cached_folders",
          folders.length > 0,
          folders.length ? undefined : ["尚未同步过邮箱，文件夹列表为空"],
        ),
      };
    },
  );

  tool(
    server,
    "prepare_email",
    "准备可供用户检查和发送的邮件草稿（本地写：只创建草稿记录，不发送邮件）。可附加项目文件、Canvas 文件或邮件附件引用；附件在用户打开草稿时加载。",
    {
      to: z.array(z.string().email()).min(1).max(50),
      subject: z.string().max(500),
      text: z.string().max(1000000),
      attachments: z.array(resourceRefSchema).max(30).default([]),
    },
    prepareEmail,
  );
}
