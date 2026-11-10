import { configPath, loadConfig, saveConfig } from "./config.js";
import { browserLogin } from "./login-browser.js";

function saveCookie(cookie: string): void {
  const config = loadConfig();
  const campus = config.campus;
  // 只更新 cookie，保留已保存的账号密码与开学日期覆盖。
  config.campus = {
    cookie,
    username: campus?.username ?? "",
    password: campus?.password ?? "",
    semesterStarts: campus?.semesterStarts ?? {},
  };
  saveConfig(config);
  console.log(`已保存 jAccount Cookie 到 ${configPath()}`);
}

/** `campus-agent login`：默认打开浏览器完成 jAccount 登录并自动抓取 Cookie；`--cookie` 则手动粘贴。 */
export async function runLogin(): Promise<void> {
  const flagIndex = process.argv.indexOf("--cookie");
  if (flagIndex >= 0) {
    const cookie = process.argv[flagIndex + 1] ?? "";
    if (!cookie) throw new Error('未提供 Cookie（可用 `campus-agent login --cookie "..."` 传入）');
    saveCookie(cookie);
    return;
  }

  console.log("正在打开 Edge 登录页，请在浏览器中完成 jAccount 登录（含验证码/二次验证），登录成功后会自动抓取 Cookie。");
  let cookie: string;
  try {
    cookie = await browserLogin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${message}\n\n若浏览器登录失败，可手动粘贴 Cookie：campus-agent login --cookie "..."`);
  }
  saveCookie(cookie);
}
