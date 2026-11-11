const campusEl = document.getElementById('campus');
const canvasEl = document.getElementById('canvas');
const dsEl = document.getElementById('deepseek');
const closeBtn = document.getElementById('close');

function formatDue(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso || '');
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function render(info) {
  // 今日课程：只显示课程名 / 地点 / 具体时间
  const c = info.campus || {};
  if (!c.ok) {
    campusEl.innerHTML = `<div class="dim">${c.error || '无数据'}</div>`;
  } else if (c.today && c.today.length) {
    campusEl.innerHTML =
      '<ul>' +
      c.today
        .map((t) => `<li>${[t.course, t.room, t.time].filter(Boolean).join(' · ')}</li>`)
        .join('') +
      '</ul>';
  } else {
    campusEl.innerHTML = '<div class="dim">今天没有课 🎉</div>';
  }

  // 最近 Canvas 任务（作业，按截止时间最近的排前）
  const cv = info.canvas;
  if (!cv || !cv.ok) {
    canvasEl.innerHTML = `<div class="dim">${(cv && cv.error) || '无数据'}</div>`;
  } else if (!cv.assignments.length) {
    canvasEl.innerHTML = '<div class="dim">暂无作业</div>';
  } else {
    canvasEl.innerHTML =
      '<ul>' +
      cv.assignments
        .map((a) => {
          const head = `${a.title}${a.course ? ' <span class="dim">· ' + a.course + '</span>' : ''}`;
          const due = a.dueAt ? '截止 ' + formatDue(a.dueAt) : '无截止';
          return `<li><div>${head}</div><div class="dim">${due}</div></li>`;
        })
        .join('') +
      '</ul>';
  }

  const d = info.deepseek || {};
  const cost = info.todayCost;
  let parts = [];
  if (!d.ok) {
    parts.push(`<div class="dim">${d.error || '无数据'}</div>`);
  } else {
    parts.push(`<div>余额 <b>¥${d.totalBalance ?? '—'}</b>${d.currency ? ' ' + d.currency : ''}</div>`);
  }
  if (cost && cost.ok && typeof cost.amount === 'number') {
    parts.push(`<div>当日消费金额 <b>¥${parseFloat(cost.amount.toFixed(4))}</b></div>`);
  } else {
    parts.push(`<div class="dim">当日消费金额 ${cost && cost.error ? cost.error : '—'}</div>`);
  }
  dsEl.innerHTML = parts.join('');
}

async function refresh() {
  try {
    const info = await window.petAPI.getInfo();
    render(info);
  } catch (e) {
    campusEl.innerHTML = `<div class="dim">读取失败</div>`;
    canvasEl.innerHTML = `<div class="dim">读取失败</div>`;
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

// —— 右下角把手拖动缩放面板 ——
const grip = document.getElementById('grip');
let resizing = false;

grip.addEventListener('mousedown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  resizing = true;
  const sx = e.screenX;
  const sy = e.screenY;
  window.petAPI.getPanelSize().then(([w0, h0]) => {
    const move = (ev) => {
      if (!resizing) return;
      window.petAPI.resizePanel(w0 + (ev.screenX - sx), h0 + (ev.screenY - sy));
    };
    const up = () => {
      resizing = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
});
