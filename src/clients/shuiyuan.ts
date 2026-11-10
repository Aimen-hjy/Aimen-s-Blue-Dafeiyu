import { z } from "zod";
import { loadConfig } from "../config.js";
import { toolError } from "../errors.js";
import { getState, setState } from "../store.js";

export const SHUIYUAN_ORIGIN = "https://shuiyuan.sjtu.edu.cn";

const REQUEST_TIMEOUT_MS = 15000;
const SHUIYUAN_FEATURED_TAG = "精品";
const STRUCTURE_TTL_MS = 10 * 60 * 1000;
const REFS_KEY = "shuiyuanRefs";

export interface ShuiyuanState {
  connected: boolean;
  username: string | null;
  boundAt: string | null;
}

export interface ShuiyuanCategory {
  id: number;
  name: string;
  slug: string;
  color: string;
  parentId: number | null;
  topicCount: number | null;
}

export interface ShuiyuanTag {
  name: string;
  topicCount: number | null;
}

export interface ShuiyuanSiteStructure {
  categories: ShuiyuanCategory[];
  tags: ShuiyuanTag[];
}

export interface ShuiyuanTopicSummary {
  id: number;
  title: string;
  excerpt: string | null;
  categoryId: number | null;
  tags: string[];
  postsCount: number;
  views: number | null;
  likeCount: number | null;
  createdAt: string;
  lastPostedAt: string | null;
  pinned: boolean;
  closed: boolean;
  lastPosterUsername: string | null;
  authorUsername: string | null;
}

export interface ShuiyuanPost {
  id: number;
  postNumber: number;
  username: string;
  createdAt: string;
  cooked: string;
  replyToPostNumber: number | null;
  likeCount: number | null;
  liked: boolean;
  yours: boolean;
}

export interface ShuiyuanTopicDetail {
  id: number;
  title: string;
  categoryId: number | null;
  tags: string[];
  postsCount: number;
  highestPostNumber: number;
  likeCount: number | null;
  views: number | null;
  createdAt: string;
  lastPostedAt: string | null;
  closed: boolean;
  archetype: string;
  stream: number[];
  posts: ShuiyuanPost[];
}

export interface ShuiyuanTopicPage {
  topics: ShuiyuanTopicSummary[];
  moreUrl: string | null;
}

export interface ShuiyuanSourceRef {
  topicId: number;
  title: string;
  url: string;
  excerpt: string | null;
  categoryName: string | null;
  author: string | null;
  postsCount: number | null;
  addedAt: string;
}

export type ShuiyuanFeed =
  | { kind: "latest" }
  | { kind: "featured" }
  | { kind: "category"; categoryId: number }
  | { kind: "tag"; tag: string }
  | { kind: "search"; query: string };

const rawTagSchema = z.union([
  z.string(),
  z
    .object({ name: z.string() })
    .passthrough()
    .transform((tag) => tag.name),
]);

const rawTopicSchema = z
  .object({
    id: z.number(),
    title: z.string().nullish(),
    fancy_title: z.string().nullish(),
    excerpt: z.string().nullish(),
    category_id: z.number().nullish(),
    tags: z.array(rawTagSchema).nullish(),
    posts_count: z.number().nullish(),
    views: z.number().nullish(),
    like_count: z.number().nullish(),
    created_at: z.string().nullish(),
    last_posted_at: z.string().nullish(),
    pinned: z.boolean().nullish(),
    closed: z.boolean().nullish(),
    archetype: z.string().nullish(),
    last_poster_username: z.string().nullish(),
    posters: z
      .array(
        z
          .object({ user_id: z.number().nullish(), description: z.string().nullish() })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();

const rawPostSchema = z
  .object({
    id: z.number(),
    post_number: z.number(),
    username: z.string(),
    created_at: z.string().nullish(),
    cooked: z.string().nullish(),
    reply_to_post_number: z.number().nullish(),
    yours: z.boolean().nullish(),
    actions_summary: z
      .array(
        z
          .object({ id: z.number(), count: z.number().nullish(), acted: z.boolean().nullish() })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();

const rawUserSchema = z
  .object({ id: z.number().nullish(), username: z.string().nullish() })
  .passthrough();

type RawTopic = z.infer<typeof rawTopicSchema>;
type RawUser = z.infer<typeof rawUserSchema>;

function usersById(payload: readonly RawUser[] | null | undefined): Map<number, RawUser> {
  const map = new Map<number, RawUser>();
  for (const user of payload ?? []) {
    if (user.id !== null && user.id !== undefined) map.set(user.id, user);
  }
  return map;
}

function mapTopic(raw: RawTopic, users: Map<number, RawUser>): ShuiyuanTopicSummary {
  const opPoster =
    raw.posters?.find((poster) => poster.description?.includes("Original Poster")) ??
    raw.posters?.[0];
  const author =
    opPoster?.user_id === null || opPoster?.user_id === undefined
      ? undefined
      : users.get(opPoster.user_id);
  return {
    id: raw.id,
    title: raw.title ?? raw.fancy_title ?? "(无标题)",
    excerpt: raw.excerpt ?? null,
    categoryId: raw.category_id ?? null,
    tags: raw.tags ?? [],
    postsCount: raw.posts_count ?? 0,
    views: raw.views ?? null,
    likeCount: raw.like_count ?? null,
    createdAt: raw.created_at ?? "",
    lastPostedAt: raw.last_posted_at ?? null,
    pinned: raw.pinned ?? false,
    closed: raw.closed ?? false,
    lastPosterUsername: raw.last_poster_username ?? null,
    authorUsername: author?.username ?? null,
  };
}

function mapPost(raw: z.infer<typeof rawPostSchema>): ShuiyuanPost {
  const like = raw.actions_summary?.find((action) => action.id === 2);
  return {
    id: raw.id,
    postNumber: raw.post_number,
    username: raw.username,
    createdAt: raw.created_at ?? "",
    cooked: raw.cooked ?? "",
    replyToPostNumber: raw.reply_to_post_number ?? null,
    likeCount: like?.count ?? null,
    liked: like?.acted ?? false,
    yours: raw.yours ?? false,
  };
}

function shuiyuanCredential(): { key: string; clientId: string } | null {
  const config = loadConfig().shuiyuan;
  if (!config || !config.key || !config.clientId) return null;
  return { key: config.key, clientId: config.clientId };
}

export function getShuiyuanState(): ShuiyuanState {
  const config = loadConfig().shuiyuan;
  const connected = Boolean(config?.key && config?.clientId);
  return {
    connected,
    username: connected ? config!.username || null : null,
    boundAt: connected ? config!.boundAt || null : null,
  };
}

export function requireShuiyuanBound(): void {
  if (!getShuiyuanState().connected)
    throw toolError(
      "NOT_CONFIGURED",
      "尚未绑定水源社区，请先在 config 中配置 shuiyuan.key 与 shuiyuan.clientId 后重试",
    );
}

async function shuiyuanRequest(path: string, init?: RequestInit): Promise<unknown> {
  const credential = shuiyuanCredential();
  if (!credential) requireShuiyuanBound();
  let response: Response;
  try {
    response = await fetch(`${SHUIYUAN_ORIGIN}${path}`, {
      ...init,
      headers: {
        "User-Api-Key": credential!.key,
        "User-Api-Client-Id": credential!.clientId,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw toolError("NETWORK_ERROR", "无法连接水源社区，请检查网络后重试");
  }
  if (response.ok) return response.json().catch(() => null);
  if (response.status === 401 || response.status === 403)
    throw toolError(
      "AUTH_EXPIRED",
      "水源拒绝了该操作（HTTP 403）：密钥可能已失效或缺少写权限，请重新绑定",
    );
  if (response.status === 429)
    throw toolError("RATE_LIMITED", "请求过于频繁，已触发水源限流，请稍后再试");
  const payload = (await response.json().catch(() => null)) as { errors?: string[] } | null;
  const detail = payload?.errors?.join("；");
  throw toolError(
    "UPSTREAM_ERROR",
    detail ? `水源返回错误：${detail}` : `水源接口返回 ${response.status}`,
  );
}

let cachedStructure: { value: ShuiyuanSiteStructure; at: number } | null = null;

export async function getShuiyuanSiteStructure(): Promise<ShuiyuanSiteStructure> {
  if (cachedStructure && Date.now() - cachedStructure.at < STRUCTURE_TTL_MS)
    return cachedStructure.value;
  const site = (await shuiyuanRequest("/site.json")) as {
    categories?: Array<Record<string, unknown>>;
    top_tags?: Array<Record<string, unknown>>;
  } | null;
  const categories: ShuiyuanCategory[] = (site?.categories ?? [])
    .map((raw) => ({
      id: z.number().parse(raw.id),
      name: z.string().parse(raw.name),
      slug: z.string().parse(raw.slug),
      color: typeof raw.color === "string" ? raw.color : "808281",
      parentId: typeof raw.parent_category_id === "number" ? raw.parent_category_id : null,
      topicCount: typeof raw.topic_count === "number" ? raw.topic_count : null,
    }))
    .filter((category) => category.slug !== "uncategorized");
  const tags: ShuiyuanTag[] = (site?.top_tags ?? [])
    .map((raw) => ({
      name: typeof raw.name === "string" ? raw.name : String(raw.id ?? ""),
      topicCount: typeof raw.topic_count === "number" ? raw.topic_count : null,
    }))
    .filter((tag) => tag.name);
  cachedStructure = { value: { categories, tags }, at: Date.now() };
  return cachedStructure.value;
}

const moreUrlSchema = z
  .string()
  .startsWith("/")
  .max(500)
  .refine((value) => !value.startsWith("//"), "分页地址无效");

function moreUrlToPath(moreUrl: unknown): string {
  const parsed = moreUrlSchema.parse(moreUrl);
  const url = new URL(parsed, SHUIYUAN_ORIGIN);
  if (url.origin !== SHUIYUAN_ORIGIN) throw toolError("INVALID_INPUT", "分页地址无效");
  return `${url.pathname.replace(/\.json$/, "")}.json${url.search}`;
}

const rawTopicListSchema = z
  .object({
    topic_list: z
      .object({ topics: z.array(rawTopicSchema).nullish(), more_topics_url: z.string().nullish() })
      .passthrough()
      .nullish(),
    users: z.array(rawUserSchema).nullish(),
  })
  .passthrough();

function mapTopicList(payload: unknown): ShuiyuanTopicPage {
  const parsed = rawTopicListSchema.parse(payload);
  const users = usersById(parsed.users);
  return {
    topics: (parsed.topic_list?.topics ?? []).map((raw) => mapTopic(raw, users)),
    moreUrl: parsed.topic_list?.more_topics_url ?? null,
  };
}

export async function listShuiyuanTopics(
  feed: ShuiyuanFeed,
  moreUrl?: string,
): Promise<ShuiyuanTopicPage> {
  const morePath = moreUrl === undefined ? null : moreUrlToPath(moreUrl);
  if (feed.kind === "search") {
    const page = morePath
      ? z
          .number()
          .int()
          .positive()
          .parse(new URL(morePath, SHUIYUAN_ORIGIN).searchParams.get("page") ?? 1)
      : 1;
    return mapSearchResult(
      await shuiyuanRequest(`/search.json?q=${encodeURIComponent(feed.query)}&page=${page}`),
      feed.query,
      page,
    );
  }
  let path: string;
  if (morePath) path = morePath;
  else if (feed.kind === "latest") path = "/latest.json";
  else if (feed.kind === "featured") path = `/tag/${encodeURIComponent(SHUIYUAN_FEATURED_TAG)}.json`;
  else if (feed.kind === "tag") path = `/tag/${encodeURIComponent(feed.tag)}.json`;
  else {
    const structure = await getShuiyuanSiteStructure();
    const category = structure.categories.find((item) => item.id === feed.categoryId);
    if (!category) throw toolError("NOT_FOUND", "该分类不存在，请刷新后重试");
    path = `/c/${category.slug}/${category.id}.json`;
  }
  return mapTopicList(await shuiyuanRequest(path));
}

function mapSearchResult(payload: unknown, query: string, page: number): ShuiyuanTopicPage {
  const parsed = z
    .object({
      topics: z.array(rawTopicSchema).nullish(),
      posts: z
        .array(
          z
            .object({ topic_id: z.number().nullish(), blurb: z.string().nullish() })
            .passthrough(),
        )
        .nullish(),
      users: z.array(rawUserSchema).nullish(),
      grouped_search_result: z
        .object({ more_full_page_results: z.boolean().nullish() })
        .passthrough()
        .nullish(),
    })
    .passthrough()
    .parse(payload);
  const blurbs = new Map<number, string>();
  for (const post of parsed.posts ?? []) {
    if (post.topic_id && post.blurb && !blurbs.has(post.topic_id)) {
      blurbs.set(post.topic_id, post.blurb);
    }
  }
  const users = usersById(parsed.users);
  const topics = (parsed.topics ?? []).map((raw) => {
    const topic = mapTopic(raw, users);
    return blurbs.has(topic.id) ? { ...topic, excerpt: blurbs.get(topic.id)! } : topic;
  });
  return {
    topics,
    moreUrl: parsed.grouped_search_result?.more_full_page_results
      ? `/search.json?q=${encodeURIComponent(query)}&page=${page + 1}`
      : null,
  };
}

const rawDetailSchema = rawTopicSchema.extend({
  highest_post_number: z.number().nullish(),
  post_stream: z
    .object({ stream: z.array(z.number()).nullish(), posts: z.array(rawPostSchema).nullish() })
    .passthrough()
    .nullish(),
});

export async function getShuiyuanTopic(
  id: number,
  postNumber?: number,
): Promise<ShuiyuanTopicDetail> {
  const path = postNumber === undefined ? `/t/${id}.json` : `/t/${id}/${postNumber}.json`;
  const parsed = rawDetailSchema.parse(await shuiyuanRequest(path));
  return {
    id: parsed.id,
    title: parsed.title ?? parsed.fancy_title ?? "(无标题)",
    categoryId: parsed.category_id ?? null,
    tags: parsed.tags ?? [],
    postsCount: parsed.posts_count ?? 0,
    highestPostNumber: parsed.highest_post_number ?? parsed.posts_count ?? 0,
    likeCount: parsed.like_count ?? null,
    views: parsed.views ?? null,
    createdAt: parsed.created_at ?? "",
    lastPostedAt: parsed.last_posted_at ?? null,
    closed: parsed.closed ?? false,
    archetype: parsed.archetype ?? "regular",
    stream: parsed.post_stream?.stream ?? [],
    posts: (parsed.post_stream?.posts ?? []).map(mapPost),
  };
}

export async function loadShuiyuanPosts(topicId: number, postIds: number[]): Promise<ShuiyuanPost[]> {
  const query = postIds.map((postId) => `post_ids[]=${postId}`).join("&");
  const parsed = z
    .object({ post_stream: z.object({ posts: z.array(rawPostSchema).nullish() }).passthrough() })
    .passthrough()
    .parse(await shuiyuanRequest(`/t/${topicId}/posts.json?${query}`));
  return (parsed.post_stream.posts ?? []).map(mapPost);
}

export function shuiyuanTopicUrl(topicId: number): string {
  return `${SHUIYUAN_ORIGIN}/t/topic/${topicId}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getShuiyuanSourceRef(topicId: number): ShuiyuanSourceRef | null {
  const refs = getState<Record<string, ShuiyuanSourceRef>>(REFS_KEY);
  return refs?.[String(topicId)] ?? null;
}

export async function addShuiyuanSourceRef(topicId: number): Promise<ShuiyuanSourceRef> {
  const existing = getShuiyuanSourceRef(topicId);
  if (existing) return existing;
  const detail = await getShuiyuanTopic(topicId);
  let categoryName: string | null = null;
  if (detail.categoryId !== null) {
    const structure = await getShuiyuanSiteStructure().catch(() => null);
    categoryName =
      structure?.categories.find((category) => category.id === detail.categoryId)?.name ?? null;
  }
  const first = detail.posts[0];
  const ref: ShuiyuanSourceRef = {
    topicId,
    title: detail.title,
    url: shuiyuanTopicUrl(topicId),
    excerpt: stripHtml(first?.cooked ?? "").slice(0, 280) || null,
    categoryName,
    author: first?.username ?? null,
    postsCount: detail.postsCount,
    addedAt: new Date().toISOString(),
  };
  const refs = getState<Record<string, ShuiyuanSourceRef>>(REFS_KEY) ?? {};
  refs[String(topicId)] = ref;
  setState(REFS_KEY, refs);
  return ref;
}
