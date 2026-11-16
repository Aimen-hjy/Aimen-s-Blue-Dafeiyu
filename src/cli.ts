import { existsSync, mkdirSync } from "node:fs";
import {
  activeProfileName,
  configPath,
  isValidProfileName,
  listProfiles,
  loadConfig,
  profileConfigPath,
  profilesDir,
  removeProfile,
  saveConfig,
  setActiveProfile,
} from "./config.js";
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

const PROFILE_USAGE = [
  "campus-agent profile <命令>",
  "  add <名字>              新建并切换到该 profile",
  "  use <名字>              切换到已有 profile（use default 回到默认配置）",
  "  list                    列出所有 profile，* 标注当前",
  "  show                    显示当前 profile 及已登记字段",
  "  remove <名字>           删除一个非当前 profile",
  "  set-deepseek <sk-...>   登记当前 profile 的 DeepSeek API Key",
  "  set-user-token <token>  登记当前 profile 的 DeepSeek 平台 userToken",
  "  set-chat-token <token>  登记当前 profile 的 chat.deepseek.com 网页 user_token",
].join("\n");

function currentProfileName(): string {
  return activeProfileName() || "default";
}

function describeConfig() {
  const cfg = loadConfig();
  const ds = cfg.deepseek;
  return {
    jAccount: cfg.campus?.cookie?.trim()
      ? `已登录${cfg.campus.username?.trim() ? `（${cfg.campus.username.trim()}）` : ""}`
      : "未登录",
    canvas: cfg.canvas?.accessToken?.trim() ? "已配置" : "未配置",
    deepseekApiKey: ds?.apiKey?.trim() ? `已配置（…${ds.apiKey.trim().slice(-4)}）` : "未配置",
    deepseekUserToken: ds?.userToken?.trim() ? "已配置" : "未配置",
    deepseekChatToken: ds?.chatToken?.trim() ? "已配置" : "未配置",
  };
}

function requireName(name: string): void {
  if (!isValidProfileName(name)) {
    throw new Error("profile 名需为 1–40 位字母/数字/下划线/连字符，且不能是 default");
  }
}

/** `campus-agent profile ...`：多账号（jAccount 登录 + DeepSeek key）的登记、切换、删除。 */
export async function runProfile(): Promise<void> {
  const cmd = process.argv[3];
  const arg = (process.argv[4] ?? "").trim();

  switch (cmd) {
    case "add": {
      requireName(arg);
      mkdirSync(profilesDir(), { recursive: true });
      if (existsSync(profileConfigPath(arg))) throw new Error(`profile "${arg}" 已存在`);
      setActiveProfile(arg);
      saveConfig({});
      console.log(`已创建并切换到 profile "${arg}"（配置保存到 ${profileConfigPath(arg)}）`);
      return;
    }
    case "use": {
      if (arg === "default") {
        setActiveProfile("");
        console.log("已切换到默认 profile（~/.campus-agent/config.json）");
        return;
      }
      requireName(arg);
      if (!existsSync(profileConfigPath(arg))) {
        throw new Error(`profile "${arg}" 不存在，请先 campus-agent profile add "${arg}"`);
      }
      setActiveProfile(arg);
      console.log(`已切换到 profile "${arg}"`);
      return;
    }
    case "list": {
      const active = currentProfileName();
      const names = listProfiles();
      for (const name of names) console.log(`${name === active ? "* " : "  "}${name}`);
      if (!names.length) console.log("（尚无 profile，将使用默认配置）");
      return;
    }
    case "show": {
      const info = describeConfig();
      console.log(`当前 profile：${currentProfileName()}`);
      console.log(`配置路径：${configPath()}`);
      console.log(`jAccount 登录：${info.jAccount}`);
      console.log(`Canvas token：${info.canvas}`);
      console.log(`DeepSeek API Key：${info.deepseekApiKey}`);
      console.log(`DeepSeek 平台 userToken：${info.deepseekUserToken}`);
      console.log(`DeepSeek 网页 chat token：${info.deepseekChatToken}`);
      return;
    }
    case "remove": {
      requireName(arg);
      if (currentProfileName() === arg) throw new Error(`请先 profile use 其他 profile，再删除 "${arg}"`);
      if (!existsSync(profileConfigPath(arg))) throw new Error(`profile "${arg}" 不存在`);
      removeProfile(arg);
      console.log(`已删除 profile "${arg}"`);
      return;
    }
    case "set-deepseek": {
      if (!arg) throw new Error("缺少 API Key：campus-agent profile set-deepseek <sk-...>");
      const config = loadConfig();
      config.deepseek = {
        apiKey: arg,
        userToken: config.deepseek?.userToken ?? "",
        chatToken: config.deepseek?.chatToken ?? "",
      };
      saveConfig(config);
      console.log("已登记 DeepSeek API Key 到当前 profile");
      return;
    }
    case "set-user-token": {
      if (!arg) throw new Error("缺少 userToken：campus-agent profile set-user-token <token>");
      const config = loadConfig();
      config.deepseek = {
        apiKey: config.deepseek?.apiKey ?? "",
        userToken: arg,
        chatToken: config.deepseek?.chatToken ?? "",
      };
      saveConfig(config);
      console.log("已登记 DeepSeek 平台 userToken 到当前 profile");
      return;
    }
    case "set-chat-token": {
      if (!arg) throw new Error("缺少 token：campus-agent profile set-chat-token <chat.deepseek.com 的 user_token>");
      const config = loadConfig();
      config.deepseek = {
        apiKey: config.deepseek?.apiKey ?? "",
        userToken: config.deepseek?.userToken ?? "",
        chatToken: arg,
      };
      saveConfig(config);
      console.log("已登记 chat.deepseek.com 网页 user_token 到当前 profile");
      return;
    }
    default:
      console.log(PROFILE_USAGE);
  }
}
