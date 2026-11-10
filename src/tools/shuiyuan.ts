import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addShuiyuanSourceRef,
  getShuiyuanSiteStructure,
  getShuiyuanState,
  getShuiyuanTopic,
  listShuiyuanTopics,
  loadShuiyuanPosts,
  requireShuiyuanBound,
  shuiyuanTopicUrl,
  type ShuiyuanFeed,
  type ShuiyuanPost,
  type ShuiyuanTopicSummary,
} from "../clients/shuiyuan.js";
import { toolError } from "../errors.js";
import { cursorPage, freshness, tool } from "./shared.js";

const READ_POSTS_CHUNK = 50;

function slimTopicSummary(topic: ShuiyuanTopicSummary) {
  return {
    ref: { type: "shuiyuan-online", id: topic.id },
    id: topic.id,
    title: topic.title,
    excerpt: topic.excerpt,
    categoryId: topic.categoryId,
    tags: topic.tags,
    postsCount: topic.postsCount,
    views: topic.views,
    likeCount: topic.likeCount,
    createdAt: topic.createdAt,
    lastPostedAt: topic.lastPostedAt,
    pinned: topic.pinned,
    closed: topic.closed,
    authorUsername: topic.authorUsername,
    lastPosterUsername: topic.lastPosterUsername,
  };
}

function slimPost(post: ShuiyuanPost) {
  return {
    id: post.id,
    postNumber: post.postNumber,
    username: post.username,
    createdAt: post.createdAt,
    cooked: post.cooked,
    replyToPostNumber: post.replyToPostNumber,
    likeCount: post.likeCount,
    yours: post.yours,
  };
}

export function registerShuiyuanTools(server: McpServer): void {
  tool(
    server,
    "status",
    "查询水源社区绑定状态（只读，不联网）：是否已绑定（本地凭据存在，未在线验证）、用户名与绑定时间。未绑定时其余水源工具返回 NOT_CONFIGURED。",
    {},
    () => getShuiyuanState(),
  );

  tool(
    server,
    "list_categories",
    "列出水源社区分类树与常用标签（只读联网，站点结构带 10 分钟缓存）。返回的 categoryId 与标签名是 list_topics 构造 category/tag 浏览的前提。",
    {},
    async () => {
      requireShuiyuanBound();
      const structure = await getShuiyuanSiteStructure();
      return {
        categories: structure.categories.map(({ id, name, slug, parentId, topicCount }) => ({
          id,
          name,
          slug,
          parentId,
          topicCount,
        })),
        tags: structure.tags,
        freshness: freshness("realtime"),
      };
    },
  );

  tool(
    server,
    "list_topics",
    "浏览水源社区主题列表（只读联网）：latest 最新、featured 精选、category 按分类（categoryId 见 list_categories）、tag 按标签。分页：把上一页的 nextCursor 原样回传；远端不提供总数。",
    {
      kind: z.enum(["latest", "featured", "category", "tag"]),
      categoryId: z.number().int().positive().optional(),
      tag: z.string().trim().min(1).max(60).optional(),
      nextCursor: z.string().min(1).max(500).optional(),
    },
    async (input) => {
      requireShuiyuanBound();
      if (input.kind === "category" && input.categoryId === undefined)
        throw toolError("INVALID_INPUT", "kind=category 时必须提供 categoryId（可用 list_categories 发现分类）");
      if (input.kind === "tag" && input.tag === undefined)
        throw toolError("INVALID_INPUT", "kind=tag 时必须提供标签名 tag");
      if (input.kind !== "category" && input.categoryId !== undefined)
        throw toolError("INVALID_INPUT", "categoryId 仅在 kind=category 时使用");
      if (input.kind !== "tag" && input.tag !== undefined)
        throw toolError("INVALID_INPUT", "tag 仅在 kind=tag 时使用");
      const feed: ShuiyuanFeed =
        input.kind === "category"
          ? { kind: "category", categoryId: input.categoryId! }
          : input.kind === "tag"
            ? { kind: "tag", tag: input.tag! }
            : { kind: input.kind };
      const result = await listShuiyuanTopics(feed, input.nextCursor);
      return {
        ...cursorPage(result.topics.map(slimTopicSummary), result.moreUrl),
        freshness: freshness("realtime"),
      };
    },
  );

  tool(
    server,
    "read_topic",
    "读取水源主题详情与首段楼层（只读联网）：元信息、楼层 post id 全量 stream 与已加载楼层。剩余楼层按 continuation.nextPostIds 传给 read_posts 续读；postNumber 可从某楼附近开始加载。",
    { topicId: z.number().int().positive(), postNumber: z.number().int().positive().optional() },
    async ({ topicId, postNumber }) => {
      requireShuiyuanBound();
      const detail = await getShuiyuanTopic(topicId, postNumber);
      const loaded = new Set(detail.posts.map((post) => post.id));
      const remaining = detail.stream.filter((id) => !loaded.has(id));
      return {
        ref: { type: "shuiyuan-online", id: topicId },
        url: shuiyuanTopicUrl(topicId),
        title: detail.title,
        categoryId: detail.categoryId,
        tags: detail.tags,
        postsCount: detail.postsCount,
        views: detail.views,
        likeCount: detail.likeCount,
        createdAt: detail.createdAt,
        lastPostedAt: detail.lastPostedAt,
        closed: detail.closed,
        archetype: detail.archetype,
        stream: detail.stream,
        posts: detail.posts.map(slimPost),
        continuation:
          remaining.length > 0
            ? { nextPostIds: remaining.slice(0, READ_POSTS_CHUNK), remainingCount: remaining.length }
            : null,
        freshness: freshness("realtime"),
      };
    },
  );

  tool(
    server,
    "read_posts",
    "按楼层 post id 续读水源主题（只读联网，每次至多 50 个 id）。postIds 取自 read_topic 的 stream 或 continuation.nextPostIds；不存在的 id 会在 missingPostIds 中报告。",
    {
      topicId: z.number().int().positive(),
      postIds: z.array(z.number().int().positive()).min(1).max(50),
    },
    async ({ topicId, postIds }) => {
      requireShuiyuanBound();
      const posts = await loadShuiyuanPosts(topicId, postIds);
      const found = new Set(posts.map((post) => post.id));
      const missingPostIds = postIds.filter((id) => !found.has(id));
      return {
        topicId,
        posts: posts.map(slimPost),
        ...(missingPostIds.length ? { missingPostIds } : {}),
        freshness: freshness("realtime"),
      };
    },
  );

  tool(
    server,
    "search_topics",
    "按关键词实时搜索水源社区主题（只读联网）。返回主题摘要与 topicId 引用，可用 read_topic 读取。分页：把上一页的 nextCursor 原样回传；远端不提供总数。",
    { query: z.string().trim().min(1).max(200), nextCursor: z.string().min(1).max(500).optional() },
    async ({ query, nextCursor }) => {
      requireShuiyuanBound();
      const result = await listShuiyuanTopics({ kind: "search", query }, nextCursor);
      return {
        ...cursorPage(result.topics.map(slimTopicSummary), result.moreUrl),
        freshness: freshness("realtime"),
      };
    },
  );

  tool(
    server,
    "link_topic",
    "把水源主题关联为本地引用（联网读取引用信息并持久化）：返回 sourceRef 本地摘要与 onlineRef 联网读取入口；重复关联返回已有条目。",
    { topicId: z.number().int().positive() },
    async ({ topicId }) => {
      requireShuiyuanBound();
      const sourceRef = await addShuiyuanSourceRef(topicId);
      return { sourceRef, onlineRef: { type: "shuiyuan-online", id: topicId } };
    },
  );
}
