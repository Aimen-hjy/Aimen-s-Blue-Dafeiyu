// 大肥鱼对话窗：文字聊天走 DSH（会话连续）+ 截屏提问（视觉问答）+ 启动完整 DSH
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const shotBtn = document.getElementById('shot');
const openDshBtn = document.getElementById('open-dsh');
const closeBtn = document.getElementById('close');
const hintEl = document.getElementById('hint');

let sessionId = null; // DSH 会话 id，续聊用
let pendingImage = null; // 截屏后待发送的 data URL
let busy = false;
let streamingEl = null; // 正在流式输出的气泡
let streamText = '';

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
  addBubble('bot', '你好呀，我是大肥鱼 🐟 这里直接连着你的 DSH，可以直接聊天；点「📸 截屏」我能看看你屏幕上的内容。');
}
inputEl.focus();
