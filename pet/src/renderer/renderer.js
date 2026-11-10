// 大肥鱼桌宠 —— 透明 webm 动画播放（素材参考 dsh-pet，MIT 许可）
const video = document.getElementById('pet-video');
const bubble = document.getElementById('bubble');

const BASE = '../../assets/webm/';
const IDLE = BASE + encodeURIComponent('待机呼吸休闲') + '.webm';
const DRAG = BASE + encodeURIComponent('被鼠标拖拽悬空反馈') + '.webm';
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
  '右击我 / 双击看状态',
  '拖我可以搬家哦',
];

let dragging = false;
let moved = false;
let startX = 0;
let startY = 0;
let winX = 0;
let winY = 0;
let bubbleTimer = null;
let currentSrc = null;
let currentState = 'idle';

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
  currentState = 'idle';
  play(IDLE, { loop: true });
}

function playDrag() {
  currentState = 'drag';
  play(DRAG, { loop: true });
}

function playClick() {
  currentState = 'click';
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
    if (!moved) {
      moved = true;
      playDrag();
    }
    window.petAPI.move(winX + dx, winY + dy);
  }
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  if (moved) {
    playIdle();
  } else {
    playClick();
    showBubble(PHRASES[Math.floor(Math.random() * PHRASES.length)]);
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
