import { loadConfig } from "./config.js";
import { toolError } from "./errors.js";

/** jAccount Cookie 会话：读配置里的 campus.cookie，为课表/课堂视频等校园域请求共用。 */
export function campusCookie(): string {
  return loadConfig().campus?.cookie?.trim() ?? "";
}

export function requireCampusConfigured(): void {
  if (!campusCookie())
    throw toolError(
      "NOT_CONFIGURED",
      "尚未登录校园服务（未保存 jAccount 会话 Cookie），请先在配置中设置 campus.cookie",
    );
}

export interface CampusRequestOptions {
  /** 用户可见的服务名，拼进超时、断网等报错文案。 */
  service: string;
  /** 登录失效（重定向、401/403）时的报错。 */
  loginError?: string;
  /** 接口另用此状态码表示未登录（交大视频身份接口返回 500）。 */
  loginStatus?: number;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

/**
 * 带 jAccount Cookie 的校园域请求。重定向（jAccount 失效回登录页）一律视为登录失效；
 * 超时、断网与 5xx 归为网络/上游错误，由调用方决定是否重试。
 */
export async function campusRequest(url: string, options: CampusRequestOptions): Promise<string> {
  requireCampusConfigured();
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: { ...options.headers, Cookie: campusCookie() },
      redirect: "manual",
      body: options.body,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    const message =
      err instanceof Error && err.name === "TimeoutError"
        ? `${options.service}请求超时，请稍后重试`
        : `无法连接${options.service}，请检查网络后重试`;
    throw toolError("NETWORK_ERROR", message);
  }
  // redirect: "manual" 下任何重定向都表现为 opaque-redirect。
  if (response.type === "opaqueredirect" || response.status === 0)
    throw toolError("AUTH_EXPIRED", options.loginError ?? "登录已失效，请重新登录");
  const status = response.status;
  if (status === 401 || status === 403 || status === options.loginStatus)
    throw toolError("AUTH_EXPIRED", options.loginError ?? "登录已失效，请重新登录");
  if (status !== 200)
    throw toolError("UPSTREAM_ERROR", `${options.service}接口返回 ${status}`);
  return response.text();
}
