import { describe, expect, it } from "vitest";
import { reachedCampusLogin } from "../src/login-browser.js";

describe("reachedCampusLogin", () => {
  it("跳回教务系统首页视为登录完成", () => {
    expect(reachedCampusLogin("https://i.sjtu.edu.cn/jsxsd/")).toBe(true);
    expect(reachedCampusLogin("http://i.sjtu.edu.cn/kbcx/xskbcx_cxXsgrkb.html")).toBe(true);
  });

  it("仍在 SSO 入口不算到达", () => {
    expect(reachedCampusLogin("https://i.sjtu.edu.cn/jaccountlogin")).toBe(false);
    expect(reachedCampusLogin("https://i.sjtu.edu.cn/jaccountlogin?ticket=abc")).toBe(false);
  });

  it("jAccount 登录页不算到达", () => {
    expect(reachedCampusLogin("https://jaccount.sjtu.edu.cn/jaccount/login")).toBe(false);
    expect(reachedCampusLogin("https://jaccount.sjtu.edu.cn/jaccount/login_slogin.html")).toBe(false);
  });
});
