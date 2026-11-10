import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addShuiyuanSourceRef,
  getShuiyuanSiteStructure,
  getShuiyuanSourceRef,
  getShuiyuanState,
  getShuiyuanTopic,
  listShuiyuanTopics,
  loadShuiyuanPosts,
  shuiyuanTopicUrl,
} from "../src/clients/shuiyuan.js";
import { saveConfig } from "../src/config.js";
import { resetStore } from "../src/store.js";

function ok(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function route(input: unknown): Response {
  const url = new URL(String(input));
  const path = url.pathname;
  if (path === "/site.json")
    return ok({
      categories: [
        { id: 42, name: "学习", slug: "study", color: "0088CC", topic_count: 10 },
        { id: 1, name: "Uncategorized", slug: "uncategorized", topic_count: 3 },
      ],
      top_tags: [
        { name: "精品", topic_count: 5 },
        { name: "求助", topic_count: 2 },
      ],
    });
  if (path === "/latest.json")
    return ok({
      topic_list: {
        topics: [
          {
            id: 1,
            title: "Hello",
            excerpt: "first post",
            category_id: 42,
            tags: ["精品"],
            posts_count: 3,
            views: 100,
            like_count: 2,
            created_at: "2026-01-01T00:00:00Z",
            last_posted_at: "2026-01-02T00:00:00Z",
            pinned: false,
            closed: false,
            last_poster_username: "bob",
            posters: [{ user_id: 7, description: "Original Poster" }],
          },
        ],
        more_topics_url: "/latest.json?page=1",
      },
      users: [{ id: 7, username: "alice" }],
    });
  if (path === "/c/study/42.json")
    return ok({
      topic_list: { topics: [], more_topics_url: null },
      users: [],
    });
  if (path === "/t/1.json")
    return ok({
      id: 1,
      title: "Hello",
      category_id: 42,
      tags: ["精品"],
      posts_count: 3,
      highest_post_number: 3,
      views: 100,
      like_count: 2,
      created_at: "2026-01-01T00:00:00Z",
      last_posted_at: "2026-01-02T00:00:00Z",
      closed: false,
      archetype: "regular",
      post_stream: {
        stream: [10, 11, 12],
        posts: [
          {
            id: 10,
            post_number: 1,
            username: "alice",
            created_at: "2026-01-01T00:00:00Z",
            cooked: "<p>hi</p>",
            reply_to_post_number: null,
            yours: false,
            actions_summary: [{ id: 2, count: 1, acted: false }],
          },
        ],
      },
    });
  if (path === "/t/1/posts.json")
    return ok({
      post_stream: {
        posts: [
          {
            id: 11,
            post_number: 2,
            username: "bob",
            created_at: "2026-01-02T00:00:00Z",
            cooked: "<p>reply</p>",
            reply_to_post_number: 1,
            yours: true,
            actions_summary: [{ id: 2, count: 0, acted: false }],
          },
        ],
      },
    });
  if (path === "/search.json")
    return ok({
      topics: [
        { id: 2, title: "Search result", category_id: null, tags: [], posts_count: 1, posters: [] },
      ],
      posts: [{ topic_id: 2, blurb: "blurb text" }],
      users: [],
      grouped_search_result: { more_full_page_results: true },
    });
  return ok({});
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campus-agent-test-"));
  process.env.CAMPUS_AGENT_CONFIG = join(dir, "config.json");
  process.env.CAMPUS_AGENT_STATE = join(dir, "state.json");
  resetStore();
  saveConfig({ shuiyuan: { key: "test-key", clientId: "test-client", username: "alice", boundAt: "2026-01-01T00:00:00Z" } });
  vi.stubGlobal("fetch", vi.fn((input: unknown) => Promise.resolve(route(input))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("shuiyuan state", () => {
  it("未配置凭据时返回未绑定", () => {
    saveConfig({});
    expect(getShuiyuanState()).toEqual({ connected: false, username: null, boundAt: null });
  });

  it("配置 key 与 clientId 后返回已绑定", () => {
    expect(getShuiyuanState()).toEqual({
      connected: true,
      username: "alice",
      boundAt: "2026-01-01T00:00:00Z",
    });
  });
});

describe("shuiyuan client", () => {
  it("getShuiyuanSiteStructure 解析分类并过滤 uncategorized", async () => {
    const structure = await getShuiyuanSiteStructure();
    expect(structure.categories).toEqual([
      { id: 42, name: "学习", slug: "study", color: "0088CC", parentId: null, topicCount: 10 },
    ]);
    expect(structure.tags).toEqual([
      { name: "精品", topicCount: 5 },
      { name: "求助", topicCount: 2 },
    ]);
  });

  it("listShuiyuanTopics latest 映射主题与楼主", async () => {
    const page = await listShuiyuanTopics({ kind: "latest" });
    expect(page.moreUrl).toBe("/latest.json?page=1");
    expect(page.topics).toHaveLength(1);
    expect(page.topics[0]).toMatchObject({
      id: 1,
      title: "Hello",
      authorUsername: "alice",
      lastPosterUsername: "bob",
      tags: ["精品"],
    });
  });

  it("listShuiyuanTopics category 用分类 slug 构造端点", async () => {
    const page = await listShuiyuanTopics({ kind: "category", categoryId: 42 });
    expect(page.topics).toEqual([]);
    expect(page.moreUrl).toBeNull();
  });

  it("getShuiyuanTopic 返回详情、stream 与已加载楼层", async () => {
    const detail = await getShuiyuanTopic(1);
    expect(detail).toMatchObject({ id: 1, title: "Hello", highestPostNumber: 3, archetype: "regular" });
    expect(detail.stream).toEqual([10, 11, 12]);
    expect(detail.posts).toHaveLength(1);
    expect(detail.posts[0]).toMatchObject({ id: 10, username: "alice", likeCount: 1 });
  });

  it("loadShuiyuanPosts 按 id 续读楼层", async () => {
    const posts = await loadShuiyuanPosts(1, [11]);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: 11, postNumber: 2, username: "bob", yours: true });
  });

  it("search 结果合并 blurb 并生成下一页 cursor", async () => {
    const page = await listShuiyuanTopics({ kind: "search", query: "foo" });
    expect(page.topics).toHaveLength(1);
    expect(page.topics[0]).toMatchObject({ id: 2, excerpt: "blurb text" });
    expect(page.moreUrl).toBe("/search.json?q=foo&page=2");
  });

  it("addShuiyuanSourceRef 持久化引用并去重", async () => {
    const ref = await addShuiyuanSourceRef(1);
    expect(ref).toMatchObject({
      topicId: 1,
      title: "Hello",
      url: shuiyuanTopicUrl(1),
      excerpt: "hi",
      categoryName: "学习",
      author: "alice",
      postsCount: 3,
    });
    expect(getShuiyuanSourceRef(1)?.addedAt).toBe(ref.addedAt);
    // 重复关联返回已有条目，addedAt 保持不变
    const again = await addShuiyuanSourceRef(1);
    expect(again.addedAt).toBe(ref.addedAt);
  });
});
