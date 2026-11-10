import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import type { Page } from "puppeteer-core";
import { loadConfig } from "./config.js";

/** 教务系统根地址与 jAccount SSO 入口：未登录时 /jaccountlogin 会跳去 jaccount 登录页，登录成功后跳回并写入会话 Cookie。 */
const CAMPUS_ORIGIN = "https://i.sjtu.edu.cn";
const LOGIN_URL = `${CAMPUS_ORIGIN}/jaccountlogin`;
const TIMETABLE_URL = `${CAMPUS_ORIGIN}/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`;
const TIMETABLE_REFERER = `${CAMPUS_ORIGIN}/kbcx/xskbcx_cxXsgrkbIndex.html?gnmkdm=N2151`;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const COOKIE_HOST = "i.sjtu.edu.cn";

function edgeExecutable(): string {
  const override = process.env.CAMPUS_AGENT_EDGE;
  if (override && existsSync(override)) return override;
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    join(homedir(), "AppData", "Local", "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error("未找到 Microsoft Edge，请改用 `campus-agent login --cookie \"...\"` 手动粘贴 Cookie");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 登录完成：已从 jAccount 跳回教务系统（而非仍在 /jaccountlogin 入口）。登录页 jaccount.sjtu.edu.cn 不算到达。 */
export function reachedCampusLogin(url: string): boolean {
  return (
    (url.startsWith("https://i.sjtu.edu.cn/") || url.startsWith("http://i.sjtu.edu.cn/")) &&
    !url.includes("/jaccountlogin")
  );
}

/** 返回与 host 匹配的 Cookie（含 .sjtu.edu.cn 等父域 Cookie），即浏览器会随请求发送的那些。 */
function cookiesForHost(cookies: { name: string; value: string; domain: string }[], host: string) {
  return cookies.filter((cookie) => {
    const domain = cookie.domain.replace(/^\./, "");
    return domain === host || host.endsWith(`.${domain}`);
  });
}

function buildCookieString(cookies: { name: string; value: string }[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function probeParams(): { xnm: string; xqm: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const semester =
    month >= 9 ? `${year}-${year + 1}-1` :
    month <= 2 ? `${year - 1}-${year}-1` :
    month <= 7 ? `${year - 1}-${year}-2` :
    `${year - 1}-${year}-3`;
  const [xnm, , term] = semester.split("-");
  return { xnm: xnm!, xqm: { "1": "3", "2": "12", "3": "16" }[term!]! };
}

/**
 * 用刚抓到的 Cookie 真实请求一次课表接口，确认会话真的可用。
 * 访客 JSESSIONID 也会存在，但接口会返回 `{"status":901}` 或重定向到登录页，两者都判定为未登录。
 */
async function probeTimetable(cookie: string): Promise<boolean> {
  const { xnm, xqm } = probeParams();
  try {
    const response = await fetch(TIMETABLE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: TIMETABLE_REFERER,
        Cookie: cookie,
      },
      body: new URLSearchParams({ xnm, xqm, kzlx: "ck", xsdm: "" }).toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 200) return false;
    const payload = JSON.parse(await response.text()) as { kbList?: unknown };
    return Array.isArray(payload.kbList);
  } catch {
    return false;
  }
}

const USER_SELECTORS = "#user, input[name='user'], input[name='username'], #username";
const PASS_SELECTORS = "#pass, input[name='pass'], input[name='password'], #password";
const SUBMIT_SELECTORS =
  "button[type='submit'], input[type='submit'], #submit, #loginBtn, .login-btn, .btn-login";

function loginCredentials(): { username: string; password: string } | null {
  const campus = loadConfig().campus;
  const username = campus?.username?.trim();
  const password = campus?.password;
  if (!username || !password) return null;
  return { username, password };
}

/** 若配置了 jAccount 账号密码，自动填充登录表单并尝试提交；验证码/二次验证仍需人工完成。 */
async function tryAutoFill(page: Page): Promise<void> {
  const credentials = loginCredentials();
  if (!credentials) return;
  try {
    const user = await page.waitForSelector(USER_SELECTORS, { timeout: 20000 }).catch(() => null);
    if (!user) return;
    await user.type(credentials.username, { delay: 30 });
    const pass = await page.waitForSelector(PASS_SELECTORS, { timeout: 3000 }).catch(() => null);
    if (!pass) return;
    await pass.type(credentials.password, { delay: 30 });
    const submit = await page.waitForSelector(SUBMIT_SELECTORS, { timeout: 3000 }).catch(() => null);
    if (submit) await submit.click().catch(() => {});
  } catch {
    // 自动填充失败不致命：用户仍可手动登录。
  }
}

/**
 * 打开 Edge 完成 jAccount 登录，返回 i.sjtu.edu.cn 的完整 Cookie 串。
 * 用户在真实浏览器里登录（验证码/二次验证都能正常完成），程序等待跳回教务系统后，
 * 用真实课表请求验证会话确实有效，再自动抓取 Cookie。
 */
export async function browserLogin(): Promise<string> {
  const userDataDir = mkdtempSync(join(tmpdir(), "campus-agent-edge-"));
  const browser = await puppeteer.launch({
    executablePath: edgeExecutable(),
    headless: false,
    defaultViewport: null,
    userDataDir,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=msEdgeFirstRunExperience",
    ],
  });
  try {
    const page = await browser.newPage();
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await tryAutoFill(page);

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    for (;;) {
      // 只有「跳回教务系统且不在 SSO 入口」才尝试抓取并验证，避免拿到登录页的访客会话。
      if (reachedCampusLogin(page.url())) {
        const cookies = await browser.defaultBrowserContext().cookies();
        const cookieString = buildCookieString(cookiesForHost(cookies, COOKIE_HOST));
        if (cookieString && (await probeTimetable(cookieString))) {
          return cookieString;
        }
      }
      if (Date.now() >= deadline) {
        throw new Error("登录超时：未检测到登录成功，请关闭浏览器窗口后重试");
      }
      await sleep(1000);
    }
  } finally {
    await browser.close().catch(() => {});
    rmSync(userDataDir, { recursive: true, force: true });
  }
}
