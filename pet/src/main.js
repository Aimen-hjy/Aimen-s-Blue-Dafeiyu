const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let petWin = null;
let panelWin = null;

// 桌宠窗口尺寸（16:9，与 640×360 素材等比）。用常量锁死，
// 避免高 DPI（如 150%）下 setPosition 的 DIP 舍入累积把窗口撑宽。
const PET_WIDTH = 400;
const PET_HEIGHT = 225;
const PANEL_WIDTH = 340;
const PANEL_HEIGHT = 460;

// 面板相对鱼窗口的偏移；鱼被拖动时面板按此偏移跟随，保持相对位置
let panelOffset = null;

/** 从 env / dsh 凭据 / pet config 依次解析 DeepSeek API Key（本地秘密，绝不外发）。 */
function resolveDeepSeekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  for (const p of [
    path.join(os.homedir(), '.dsh', '.credentials.yaml'),
    path.join(os.homedir(), '.dsh', 'credentials.yaml'),
  ]) {
    try {
      const txt = fs.readFileSync(p, 'utf8');
      const m = txt.match(/DEEPSEEK_API_KEY:\s*(\S+)/) || txt.match(/sk-[A-Za-z0-9_-]{10,}/);
      if (m) return (m[1] || m[0]).trim();
    } catch {}
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    if (cfg.deepseekApiKey) return String(cfg.deepseekApiKey).trim();
  } catch {}
  return null;
}

async function fetchDeepSeekBalance() {
  const key = resolveDeepSeekKey();
  if (!key) return { ok: false, error: '未找到 DeepSeek API Key' };
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return { ok: false, error: `balance 接口 HTTP ${res.status}` };
    const data = await res.json();
    const info = data.balance_infos?.[0];
    return {
      ok: true,
      isAvailable: data.is_available,
      currency: info?.currency ?? null,
      totalBalance: info?.total_balance ?? null,
      grantedBalance: info?.granted_balance ?? null,
      toppedUpBalance: info?.topped_up_balance ?? null,
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** 从 env / pet config 解析 DeepSeek 平台登录态 userToken（本地秘密，绝不外发）。 */
function resolveDeepSeekUserToken() {
  if (process.env.DEEPSEEK_USER_TOKEN) return normalizeUserToken(process.env.DEEPSEEK_USER_TOKEN);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    if (cfg.deepseekUserToken) return normalizeUserToken(String(cfg.deepseekUserToken));
  } catch {}
  return null;
}

/** userToken 可能被存成 {"value":"...","__version":"0"} 或直接是 token 字符串。 */
function normalizeUserToken(v) {
  v = String(v).trim();
  try {
    const o = JSON.parse(v);
    if (o && typeof o.value === 'string' && o.value) return o.value.trim();
  } catch {}
  return v;
}

/**
 * 读 DeepSeek 平台私密接口取「当日消费金额」（CNY）。balance 公开接口只有余额，
 * 逐日金额在 platform.deepseek.com 的 usage/cost（需要浏览器登录态 userToken）。
 * 按北京时区的今天日期匹配当月分天数据，累加各模型/各计费项的 amount。
 */
async function fetchTodayCost() {
  const token = resolveDeepSeekUserToken();
  if (!token) return { ok: false, error: '未找到 DeepSeek 平台 userToken' };
  const nowSh = new Date(Date.now() + 8 * 3600000); // 平移到北京时区
  const year = nowSh.getUTCFullYear();
  const month = nowSh.getUTCMonth() + 1;
  const today =
    `${year}-${String(month).padStart(2, '0')}-${String(nowSh.getUTCDate()).padStart(2, '0')}`;
  try {
    const res = await fetch(
      `https://platform.deepseek.com/api/v0/usage/cost?month=${month}&year=${year}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'x-client-platform': 'web',
        },
      }
    );
    if (!res.ok) return { ok: false, error: `usage 接口 HTTP ${res.status}` };
    const body = await res.json();
    // biz_data 是数组（通常 1 组），每组含 days（按天）与 currency
    const groups = body?.data?.biz_data;
    if (!Array.isArray(groups)) {
      return { ok: false, error: body?.data?.biz_msg || body?.msg || '用量数据为空' };
    }
    let amount = 0;
    for (const g of groups) {
      const days = g?.days;
      if (!Array.isArray(days)) continue;
      const day = days.find((d) => d.date === today);
      if (!day) continue;
      for (const m of day.data || []) {
        for (const u of m.usage || []) {
          const n = parseFloat(u.amount);
          if (Number.isFinite(n)) amount += n;
        }
      }
    }
    amount = Math.round(amount * 10000) / 10000;
    return { ok: true, amount, currency: groups[0]?.currency || 'CNY', date: today };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// 上海交大本科生节次表（分钟，自 0 点起）。第 13 节仅用于 11–13 节连上的课程。
const CLASS_PERIODS = [
  [480, 525], [535, 580], [600, 645], [655, 700], [720, 765],
  [775, 820], [840, 885], [895, 940], [960, 1005], [1015, 1060],
  [1080, 1125], [1135, 1180], [1190, 1220],
];

function fmtClock(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** 由起止节次得到具体上课时间「HH:MM-HH:MM」；节次越界时回退为 null。 */
function periodTime(startPeriod, endPeriod) {
  const start = CLASS_PERIODS[startPeriod - 1]?.[0];
  const end = CLASS_PERIODS[endPeriod - 1]?.[1];
  if (start === undefined || end === undefined) return null;
  return `${fmtClock(start)}-${fmtClock(end)}`;
}

/** 计算「今天上海时区」的课程列表（只读本地缓存，不做网络请求）。 */
function todayClasses(lessons, semesterStart) {
  if (!semesterStart || !Array.isArray(lessons)) return [];
  const DAY = 86400000;
  const startUtc = Date.parse(semesterStart + 'T00:00:00+08:00');
  if (!Number.isFinite(startUtc)) return [];
  const startDow = ((new Date(startUtc).getUTCDay() + 6) % 7) + 1; // 1=周一..7=周日
  const week1Monday = startUtc - (startDow - 1) * DAY;
  const nowSh = new Date(Date.now() + 8 * 3600000); // 平移到上海时区
  const todayMidSh = Date.UTC(nowSh.getUTCFullYear(), nowSh.getUTCMonth(), nowSh.getUTCDate());
  const todayUtc = todayMidSh - 8 * 3600000;
  const weekday = ((nowSh.getUTCDay() + 6) % 7) + 1;
  const week = Math.floor((todayUtc - week1Monday) / (7 * DAY)) + 1;
  return lessons
    .filter((l) => l.weekday === weekday && Array.isArray(l.weekNumbers) && l.weekNumbers.includes(week))
    .sort((a, b) => a.startPeriod - b.startPeriod)
    .map((l) => ({
      course: l.courseName,
      room: l.classroom || '',
      time: periodTime(l.startPeriod, l.endPeriod) || l.periodsText || '',
    }));
}

function readCampusInfo() {
  const statePath = path.join(os.homedir(), '.campus-agent', 'state.json');
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return { ok: false, error: '未找到 campus-agent 状态' };
  }
  const tt = state.timetable || {};
  const semesters = Object.keys(tt.lessons || {});
  const semester = semesters[0];
  if (!semester) return { ok: false, error: '课表尚未同步' };
  const lessons = tt.lessons[semester] || [];
  const semesterStart = tt.sync?.[semester]?.semesterStart || null;
  return { ok: true, today: todayClasses(lessons, semesterStart) };
}

/** 从 campus-agent 缓存读最近的 Canvas 作业（截止时间最近的排前）。 */
function readCanvasInfo() {
  const statePath = path.join(os.homedir(), '.campus-agent', 'state.json');
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return { ok: false, error: '未找到 campus-agent 状态' };
  }
  const canvas = state.canvas;
  if (!canvas || !Array.isArray(canvas.items)) return { ok: false, error: 'Canvas 未同步' };
  const nameById = new Map((canvas.courses || []).map((c) => [c.id, c.name || c.code]));
  const assignments = canvas.items
    .filter((i) => i.kind === 'assignment')
    .map((i) => ({
      title: i.name || '',
      course: nameById.get(i.courseId) || '',
      dueAt: i.dueAt || null,
    }))
    .sort((a, b) => {
      const ta = a.dueAt ? Date.parse(a.dueAt) : Infinity;
      const tb = b.dueAt ? Date.parse(b.dueAt) : Infinity;
      return ta - tb;
    })
    .slice(0, 5);
  return { ok: true, syncedAt: canvas.syncedAt || null, assignments };
}

async function getInfo() {
  const [deepseek, campus, canvas, todayCost] = await Promise.all([
    fetchDeepSeekBalance(),
    readCampusInfo(),
    readCanvasInfo(),
    fetchTodayCost(),
  ]);
  return { deepseek, todayCost, campus, canvas, now: new Date().toISOString() };
}

function createPetWindow() {
  petWin = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  petWin.setAlwaysOnTop(true, 'screen-saver');
  // 初始放到主屏工作区右下角
  const wa = screen.getPrimaryDisplay().workArea;
  petWin.setBounds({
    x: wa.x + wa.width - PET_WIDTH - 24,
    y: wa.y + wa.height - PET_HEIGHT - 24,
    width: PET_WIDTH,
    height: PET_HEIGHT,
  });
  petWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function createPanelWindow() {
  panelWin = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  panelWin.setAlwaysOnTop(true, 'screen-saver');
  panelWin.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
}

function togglePanel() {
  if (!panelWin || !petWin) return;
  if (panelWin.isVisible()) {
    panelWin.hide();
    return; // 不重置 panelOffset，记住上次拖动的位置，下次打开沿用
  }
  const [x, y] = petWin.getPosition();
  const [w, h] = petWin.getSize();
  const display = screen.getDisplayMatching({ x, y, width: w, height: h });
  const wa = display.workArea;
  let px;
  let py;
  if (panelOffset) {
    // 沿用上次拖动记住的相对位置（相对鱼当前坐标）
    px = x + panelOffset.dx;
    py = y + panelOffset.dy;
  } else {
    // 首次打开：默认放鱼右侧，放不下放左侧
    px = x + w + 12;
    py = y;
    if (px + PANEL_WIDTH > wa.x + wa.width) px = x - PANEL_WIDTH - 12;
  }
  // 夹紧到工作区（鱼移动后记住的偏移若越界，拉回可视区）
  px = Math.max(wa.x, Math.min(px, wa.x + wa.width - PANEL_WIDTH));
  py = Math.max(wa.y, Math.min(py, wa.y + wa.height - PANEL_HEIGHT));
  px = Math.round(px);
  py = Math.round(py);
  panelWin.setBounds({ x: px, y: py, width: PANEL_WIDTH, height: PANEL_HEIGHT });
  panelOffset = { dx: px - x, dy: py - y };
  panelWin.show();
  panelWin.webContents.send('panel:refresh');
}

app.whenReady().then(() => {
  createPetWindow();
  createPanelWindow();
  console.log('[pet] 启动成功，窗口已创建');
});

process.on('uncaughtException', (err) => {
  console.error('[pet] 未捕获异常:', err && err.stack ? err.stack : err);
});

app.on('window-all-closed', () => app.quit());

ipcMain.handle('pet:get-position', () => (petWin ? petWin.getPosition() : [0, 0]));
ipcMain.on('pet:move', (_e, x, y) => {
  // 用 setBounds 显式锁定宽高：高 DPI 下 setPosition 会因 DIP 舍入累积把窗口撑宽
  const nx = Math.round(x);
  const ny = Math.round(y);
  if (petWin) petWin.setBounds({ x: nx, y: ny, width: PET_WIDTH, height: PET_HEIGHT });
  // 面板跟随鱼，保持相对位置
  if (panelWin && panelWin.isVisible() && panelOffset) {
    panelWin.setBounds({ x: nx + panelOffset.dx, y: ny + panelOffset.dy, width: PANEL_WIDTH, height: PANEL_HEIGHT });
  }
});
ipcMain.handle('pet:get-panel-position', () => (panelWin ? panelWin.getPosition() : [0, 0]));
ipcMain.on('panel:move', (_e, x, y) => {
  const nx = Math.round(x);
  const ny = Math.round(y);
  if (panelWin) panelWin.setBounds({ x: nx, y: ny, width: PANEL_WIDTH, height: PANEL_HEIGHT });
  // 更新相对偏移，之后鱼移动时面板按新位置跟随
  if (petWin) {
    const [fx, fy] = petWin.getPosition();
    panelOffset = { dx: nx - fx, dy: ny - fy };
  }
});
ipcMain.on('pet:toggle-panel', () => togglePanel());
ipcMain.on('pet:close-panel', () => {
  if (panelWin) panelWin.hide();
});
ipcMain.handle('pet:get-info', () => getInfo());
