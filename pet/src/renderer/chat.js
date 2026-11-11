// 大肥鱼对话窗：文字聊天（DeepSeek）+ 截屏提问（视觉问答）+ 启动完整 DSH
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const shotBtn = document.getElementById('shot');
const openDshBtn = document.getElementById('open-dsh');
const closeBtn = document.getElementById('close');
const hintEl = document.getElementById('hint');

let history = []; // OpenAI 兼容 [{ role, content }]
let pendingImage = null; // 截屏后待发送的 data URL
let busy = false;

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
  const hasImage = !!pendingImage;
  if (!hasImage && !q) return;

  const question = hasImage ? (q || '请描述这张屏幕截图，说说上面有什么、重点信息是什么。') : q;
  const content = hasImage
    ? [
        { type: 'image_url', image_url: { url: pendingImage } },
        { type: 'text', text: question },
      ]
    : question;

  history.push({ role: 'user', content });
  addBubble('user', question, hasImage ? pendingImage : null);
  pendingImage = null;
  inputEl.value = '';
  setHint('');
  busy = true;
  sendBtn.disabled = true;

  const status = document.createElement('div');
  status.className = 'msg bot';
  status.style.color = '#9ca3af';
  status.textContent = '大肥鱼思考中…';
  messagesEl.appendChild(status);
  scrollBottom();

  try {
    const res = await window.petAPI.chatSend(history);
    if (res && res.ok && res.text) {
      history.push({ role: 'assistant', content: res.text });
      addBubble('bot', res.text);
    } else {
      addBubble('bot', '（出错了：' + ((res && res.error) || '未知错误') + '）');
    }
  } catch (e) {
    addBubble('bot', '（调用失败：' + String(e) + '）');
  } finally {
    status.remove();
    busy = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

sendBtn.addEventListener('click', send);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send();
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

// 首次打开：欢迎语
if (!localStorage.getItem('chat-greeted')) {
  localStorage.setItem('chat-greeted', '1');
  addBubble('bot', '你好呀，我是大肥鱼 🐟 有什么想问的？点「📸 截屏」我可以看看你屏幕上的内容哦。');
}
inputEl.focus();
