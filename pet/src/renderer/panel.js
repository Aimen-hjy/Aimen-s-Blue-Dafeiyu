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
  if (!d.ok) {
    dsEl.innerHTML = `<div class="dim">${d.error || '无数据'}</div>`;
  } else {
    dsEl.innerHTML =
      `<div>余额 <b>¥${d.totalBalance ?? '—'}</b>${d.currency ? ' ' + d.currency : ''}</div>` +
      `<div class="dim">充值 ¥${d.toppedUpBalance ?? '—'} · 赠送 ¥${d.grantedBalance ?? '—'}</div>`;
  }
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
