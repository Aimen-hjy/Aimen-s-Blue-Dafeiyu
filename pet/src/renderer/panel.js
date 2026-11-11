const campusEl = document.getElementById('campus');
const dsEl = document.getElementById('deepseek');
const closeBtn = document.getElementById('close');

function render(info) {
  const c = info.campus || {};
  if (!c.ok) {
    campusEl.innerHTML = `<div class="dim">${c.error || '无数据'}</div>`;
  } else {
    let html = `<div>学期 ${c.semester} · 已同步 <b>${c.lessonCount}</b> 门课</div>`;
    if (c.semesterStart) html += `<div class="dim">开学 ${c.semesterStart}</div>`;
    if (c.today && c.today.length) {
      html += '<ul>' + c.today.map((t) => `<li>${t.periods} ${t.course}${t.room ? ' · ' + t.room : ''}</li>`).join('') + '</ul>';
    } else {
      html += '<div class="dim">今天没有课 🎉</div>';
    }
    campusEl.innerHTML = html;
  }

  const d = info.deepseek || {};
  const t = info.todayTokens;
  let parts = [];
  if (!d.ok) {
    parts.push(`<div class="dim">${d.error || '无数据'}</div>`);
  } else {
    parts.push(`<div>余额 <b>¥${d.totalBalance ?? '—'}</b>${d.currency ? ' ' + d.currency : ''}</div>`);
  }
  if (t && typeof t.total === 'number') {
    parts.push(`<div>当日 token 消耗 <b>${t.total.toLocaleString()}</b></div>`);
  } else {
    parts.push(`<div class="dim">当日 token 消耗 —</div>`);
  }
  dsEl.innerHTML = parts.join('');
}

async function refresh() {
  try {
    const info = await window.petAPI.getInfo();
    render(info);
  } catch (e) {
    campusEl.innerHTML = `<div class="dim">读取失败</div>`;
    dsEl.innerHTML = `<div class="dim">读取失败</div>`;
  }
}

closeBtn.addEventListener('click', () => window.petAPI.closePanel());
window.petAPI.onRefresh(refresh);
refresh();
setInterval(refresh, 30000);

// —— 拖动标题栏移动面板 ——
const header = document.getElementById('header');
let dragging = false;
let moved = false;
let startX = 0;
let startY = 0;
let winX = 0;
let winY = 0;

header.addEventListener('mousedown', (e) => {
  if (e.target.closest('#close')) return; // 点关闭按钮不触发拖动
  dragging = true;
  moved = false;
  startX = e.screenX;
  startY = e.screenY;
  window.petAPI.getPanelPosition().then(([x, y]) => {
    winX = x;
    winY = y;
  });
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - startX;
  const dy = e.screenY - startY;
  if (Math.abs(dx) + Math.abs(dy) > 4) {
    moved = true;
    window.petAPI.movePanel(winX + dx, winY + dy);
  }
});

window.addEventListener('mouseup', () => {
  dragging = false;
});
