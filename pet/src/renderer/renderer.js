// 大肥鱼桌宠 —— 透明 webm 动画播放（素材参考 dsh-pet，MIT 许可）
const video = document.getElementById('pet-video');
const bubble = document.getElementById('bubble');

const BASE = '../../assets/webm/';
const IDLE = BASE + encodeURIComponent('待机呼吸休闲') + '.webm';
const CLICKS = [
  '点击回应-开心跃动',
  '点击回应-害羞惊讶',
  '点击回应-傲娇生气',
  '点击回应-挠痒咯咯笑',
  '点击回应-元气挥手',
].map((n) => BASE + encodeURIComponent(n) + '.webm');

const PHRASES = [
  '咕噜咕噜～',
  '你好呀！',
  '今天也要加油哦',
  '我饿了 🐟',
  '点我可以聊天 / 截屏提问 📸',
  '右击 / 双击看状态',
];

let dragging = false;
let moved = false;
let startX = 0;
let startY = 0;
let winX = 0;
let winY = 0;
let bubbleTimer = null;
let currentSrc = null;

// 预加载点击动画，避免首次点击的解码卡顿
for (const src of CLICKS) {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = src;
  v.style.display = 'none';
  document.body.appendChild(v);
}

function play(src, { loop = false, onEnd = null } = {}) {
  video.loop = loop;
  video.onended = onEnd;
  if (currentSrc === src) {
    video.currentTime = 0;
    video.play().catch(() => {});
    return;
  }
  currentSrc = src;
  video.src = src;
  video.play().catch(() => {});
}

function playIdle() {
  play(IDLE, { loop: true });
}

function playClick() {
  const src = CLICKS[Math.floor(Math.random() * CLICKS.length)];
  play(src, { loop: false, onEnd: playIdle });
}

video.addEventListener('mousedown', (e) => {
  dragging = true;
  moved = false;
  startX = e.screenX;
  startY = e.screenY;
  window.petAPI.getPosition().then(([x, y]) => {
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
    window.petAPI.move(winX + dx, winY + dy);
    // 拖拽反馈：跟随方向轻微倾斜（不换片段、不改大小，避免“变大”）
    const tilt = Math.max(-10, Math.min(10, dx * 0.35));
    video.style.transform = `rotate(${tilt}deg)`;
  }
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  video.style.transition = 'transform 0.2s ease';
  video.style.transform = '';
  setTimeout(() => {
    video.style.transition = '';
  }, 220);
  if (!moved) {
    playClick();
    showBubble(PHRASES[Math.floor(Math.random() * PHRASES.length)]);
    window.petAPI.toggleChat();
  }
});

video.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.petAPI.togglePanel();
});

video.addEventListener('dblclick', () => {
  window.petAPI.togglePanel();
});

function showBubble(text) {
  bubble.textContent = text;
  bubble.classList.remove('hidden');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), 2600);
}

playIdle();
