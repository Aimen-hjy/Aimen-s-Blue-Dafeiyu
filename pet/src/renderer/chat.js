// 大肥鱼对话窗：文字聊天走 DSH（会话连续）+ 截屏提问（视觉问答）+ 启动完整 DSH
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const shotBtn = document.getElementById('shot');
const openDshBtn = document.getElementById('open-dsh');
const closeBtn = document.getElementById('close');
const hintEl = document.getElementById('hint');
const historyBtn = document.getElementById('history');
const newChatBtn = document.getElementById('new-chat');
const historyPanel = document.getElementById('history-panel');

let sessionId = null; // DSH 会话 id，续聊用
let pendingImage = null; // 截屏后待发送的 data URL
let busy = false;
let streamingEl = null; // 正在流式输出的气泡
let streamText = '';
let historyOpen = false; // 历史下拉是否展开

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addBubble(role, text, imageUrl) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
  let inner = '';
  if (imageUrl) inner += `<img class="shot" src="${imageUrl}" alt="截图" />`;
  if (text) inner += `<div class="text">${esc(text)}</div>`;
  div.innerHTML = inner;
  messagesEl.appendChild(div);
  scrollBottom();
  return div;
}

function addStreamingBubble() {
  const div = document.createElement('div');
  div.className = 'msg bot';
  div.textContent = '…';
  messagesEl.appendChild(div);
  scrollBottom();
  return div;
}

function setHint(text) {
  if (!text) {
    hintEl.classList.remove('on');
    hintEl.textContent = '';
    return;
  }
  hintEl.textContent = text;
  hintEl.classList.add('on');
}

function fmtRelTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d < 7) return d + ' 天前';
  const dt = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

async function toggleHistory() {
  if (!historyOpen) {
    historyPanel.innerHTML = '<div class="hitem"><span class="hmeta">加载中…</span></div>';
    historyPanel.classList.add('on');
    historyOpen = true;
    let res = null;
    try {
      res = await window.petAPI.listSessions();
    } catch (e) {
      res = { ok: false, error: String(e) };
    }
    if (res && res.ok && Array.isArray(res.sessions)) {
      const items = res.sessions
        .map((s) => {
          const cur = s.sessionId === sessionId ? ' current' : '';
          return `<div class="hitem${cur}" data-id="${esc(s.sessionId)}" title="${esc(s.cwd || '')}">` +
            `<span class="htitle">${esc(s.title)}</span>` +
            `<span class="hmeta">${esc(fmtRelTime(s.updatedAt))}</span>` +
            '</div>';
        })
        .join('');
      historyPanel.innerHTML = items || '<div class="hitem"><span class="hmeta">暂无历史对话</span></div>';
      historyPanel.querySelectorAll('.hitem[data-id]').forEach((el) => {
        el.addEventListener('click', () => openSession(el.dataset.id));
      });
    } else {
      historyPanel.innerHTML = '<div class="hitem"><span class="hmeta">' +
        esc((res && res.error) || '读取失败') + '</span></div>';
    }
  } else {
    historyPanel.classList.remove('on');
    historyOpen = false;
  }
}

async function openSession(id) {
  historyPanel.classList.remove('on');
  historyOpen = false;
  if (busy) return;
  sessionId = id;
  pendingImage = null;
  messagesEl.innerHTML = '';
  setHint('正在加载历史对话…');
  let res = null;
  try {
    res = await window.petAPI.loadSession(id);
  } catch (e) {
    res = { ok: false, error: String(e) };
  }
  setHint('');
  if (res && res.ok && Array.isArray(res.messages)) {
    if (!res.messages.length) addBubble('bot', '（该会话暂无文字记录）');
    for (const m of res.messages) addBubble(m.role === 'user' ? 'user' : 'bot', m.text);
    addBubble('bot', '已加载历史对话，直接输入即可接着聊。');
  } else {
    addBubble('bot', '加载历史失败：' + ((res && res.error) || '未知错误'));
  }
  inputEl.focus();
}

function newChat() {
  if (busy) return;
  historyPanel.classList.remove('on');
  historyOpen = false;
  sessionId = null;
  pendingImage = null;
  messagesEl.innerHTML = '';
  addBubble('bot', '已开始新对话。');
  inputEl.focus();
}

async function send() {
  if (busy) return;
  const q = inputEl.value.trim();
  const img = pendingImage;
  if (!img && !q) return;

  const question = img ? (q || '请描述这张屏幕截图，说说上面有什么、重点信息是什么。') : q;
  addBubble('user', question, img);
  pendingImage = null;
  inputEl.value = '';
  setHint('');
  busy = true;
  sendBtn.disabled = true;

  if (img) {
    // 截图：直连 deepseek-flash 视觉问答（DSH CLI 不吃图片）
    streamingEl = addStreamingBubble();
    streamingEl.textContent = '大肥鱼在看屏幕…';
    try {
      const res = await window.petAPI.chatAskImage(img, question);
      if (res && res.ok && res.text) streamingEl.textContent = res.text;
      else streamingEl.textContent = '（出错了：' + ((res && res.error) || '未知错误') + '）';
    } catch (e) {
      streamingEl.textContent = '（调用失败：' + String(e) + '）';
    } finally {
      streamingEl = null;
      busy = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  } else {
    // 文字聊天：走 DSH（session 连续），流式回显
    streamText = '';
    streamingEl = addStreamingBubble();
    window.petAPI.chatSend(question, sessionId);
  }
}

sendBtn.addEventListener('click', send);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send();
});
historyBtn.addEventListener('click', toggleHistory);
newChatBtn.addEventListener('click', newChat);
document.addEventListener('click', (e) => {
  if (historyOpen && !e.target.closest('#history') && !e.target.closest('#history-panel')) {
    historyPanel.classList.remove('on');
    historyOpen = false;
  }
});

window.petAPI.onChatToken((t) => {
  streamText += t;
  if (streamingEl) {
    streamingEl.textContent = streamText;
    scrollBottom();
  }
});

window.petAPI.onChatDone((d) => {
  if (streamingEl) {
    if (d && d.ok) {
      if (d.sessionId) sessionId = d.sessionId;
      if (!streamText && d.text) streamingEl.textContent = d.text;
    } else {
      streamingEl.textContent = '（出错了：' + ((d && d.error) || '未知错误') + '）';
    }
    streamingEl = null;
    streamText = '';
  }
  busy = false;
  sendBtn.disabled = false;
  inputEl.focus();
});

shotBtn.addEventListener('click', async () => {
  if (busy) return;
  setHint('截屏中…');
  try {
    const res = await window.petAPI.screenshot();
    if (res && res.ok) {
      pendingImage = res.dataUrl;
      setHint('已截屏 📸，输入你的问题后按 Enter 发送（留空则自动描述屏幕）');
      inputEl.focus();
    } else {
      setHint('截屏失败：' + ((res && res.error) || '未知错误'));
    }
  } catch (e) {
    setHint('截屏失败：' + String(e));
  }
});

openDshBtn.addEventListener('click', async () => {
  setHint('正在启动 DSH…');
  const res = await window.petAPI.openDsh();
  setHint('');
  if (res && res.ok) {
    addBubble('bot', '已启动 DSH Web UI 🚀（浏览器打开 http://127.0.0.1:3080）。没弹出的话点右上角 🚀 DSH 再试一次。');
  } else {
    addBubble('bot', '启动 DSH 失败：' + ((res && res.error) || '未知错误'));
  }
});

closeBtn.addEventListener('click', () => window.petAPI.closeChat());
window.petAPI.onChatFocus(() => inputEl.focus());

// —— 拖动标题栏移动对话窗 ——
const header = document.getElementById('header');
let dragging = false;
let startX = 0;
let startY = 0;
let winX = 0;
let winY = 0;

header.addEventListener('mousedown', (e) => {
  if (e.target.closest('button')) return;
  dragging = true;
  startX = e.screenX;
  startY = e.screenY;
  window.petAPI.getChatPosition().then(([x, y]) => {
    winX = x;
    winY = y;
  });
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  window.petAPI.moveChat(winX + (e.screenX - startX), winY + (e.screenY - startY));
});

window.addEventListener('mouseup', () => {
  dragging = false;
});

// —— 右下角把手拖动缩放对话窗 ——
const grip = document.getElementById('grip');
let resizing = false;
grip.addEventListener('mousedown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  resizing = true;
  const sx = e.screenX;
  const sy = e.screenY;
  window.petAPI.getChatSize().then(([w0, h0]) => {
    const move = (ev) => {
      if (!resizing) return;
      window.petAPI.resizeChat(w0 + (ev.screenX - sx), h0 + (ev.screenY - sy));
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

// 首次打开：欢迎语
if (!localStorage.getItem('chat-greeted')) {
  localStorage.setItem('chat-greeted', '1');
  addBubble('bot', '这里直接连着你的 DSH，直接聊就行；点「📸 截屏」可以针对屏幕内容提问。');
}
inputEl.focus();
