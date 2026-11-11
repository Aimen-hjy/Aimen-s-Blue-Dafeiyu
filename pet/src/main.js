const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

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

/** 递归列出目录下所有 session JSONL(zstd) 日志文件。 */
function listZstdLogs(dir) {
  let out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listZstdLogs(p));
    else if (e.isFile() && e.name.endsWith('.jsonl.zstd')) out.push(p);
  }
  return out;
}

/** 解压 zstd 文本；文件被截断（活跃会话写入中）时仍返回已解码的完整帧。 */
function zstdDecompressText(file) {
  try {
    return execFileSync('zstd', ['-d', '-c', file], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    return e && e.stdout ? e.stdout : null;
  }
}

/**
 * 计算「当日 token 消耗」（上海时区）：即 DeepSeek 账号在 API 上产生的完整 token
 * 用量 = 输入（缓存未命中 inputTokens + 缓存命中 cacheReadTokens + 缓存写入
 * cacheWriteTokens）+ 输出 outputTokens。balance 接口没有逐日用量，只能从 DSH
 * 会话日志里 assistant/message 事件的 data.usage（每条为增量）累计。
 */
function todayTokenUsage() {
  const sessionsRoot = path.join(os.homedir(), '.dsh', 'sessions');
  // 今天 0 点（上海 UTC+8）对应的 UTC 毫秒时间戳
  const nowSh = new Date(Date.now() + 8 * 3600000);
  const todayMidUtc =
    Date.UTC(nowSh.getUTCFullYear(), nowSh.getUTCMonth(), nowSh.getUTCDate()) - 8 * 3600000;

  let input = 0;
  let output = 0;
  let cache = 0;
  for (const f of listZstdLogs(sessionsRoot)) {
    const text = zstdDecompressText(f);
    if (!text) continue;
    for (const line of text.split('\n')) {
      if (line.indexOf('assistant/message') < 0) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const t = o.time;
      const usage = (o.data && o.data.usage) || null;
      if (!usage || typeof t !== 'number' || t < todayMidUtc) continue;
      input += usage.inputTokens || 0;
      output += usage.outputTokens || 0;
      cache += (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
    }
  }
  return { input, output, cache, total: input + output + cache };
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
      periods: l.periodsText || `${l.startPeriod}-${l.endPeriod}节`,
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
  return {
    ok: true,
    semester,
    lessonCount: lessons.length,
    semesterStart,
    today: todayClasses(lessons, semesterStart),
  };
}

async function getInfo() {
  const [deepseek, campus] = await Promise.all([fetchDeepSeekBalance(), readCampusInfo()]);
  return { deepseek, todayTokens: todayTokenUsage(), campus, now: new Date().toISOString() };
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
