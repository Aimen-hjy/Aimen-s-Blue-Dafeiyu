const react = document.getElementById('react');
const fish = document.getElementById('fish');
const bubble = document.getElementById('bubble');

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

fish.addEventListener('mousedown', (e) => {
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
  if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
  if (moved) {
    window.petAPI.move(winX + dx, winY + dy);
    react.style.transform = `rotate(${Math.max(-9, Math.min(9, dx * 0.4))}deg)`;
  }
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  react.style.transform = '';
  if (!moved) {
    squash();
    showBubble(PHRASES[Math.floor(Math.random() * PHRASES.length)]);
  }
});

fish.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.petAPI.togglePanel();
});

fish.addEventListener('dblclick', () => {
  window.petAPI.togglePanel();
});

function squash() {
  react.style.transition = 'transform 0.12s ease';
  react.style.transform = 'scale(0.92, 1.08)';
  setTimeout(() => {
    react.style.transform = 'scale(1.05, 0.95)';
  }, 120);
  setTimeout(() => {
    react.style.transform = '';
    react.style.transition = '';
  }, 240);
}

function showBubble(text) {
  bubble.textContent = text;
  bubble.classList.remove('hidden');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), 2600);
}
