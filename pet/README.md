# 大肥鱼桌宠（campus-agent pet）

Electron 透明置顶窗口的桌面宠物，蓝色大肥鱼（DeepSeek 拟人形象）。

动画素材使用 **透明 webm**（VP9-alpha）片段，每个动作一段，来自
[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT 许可），
已拷贝常用片段到 `assets/webm/`。

## 运行

```bash
cd pet
npm install   # 会下载 Electron（约 158MB）
npm start
```

## 交互

- **待机**：循环播放「待机呼吸休闲」（透明 webm）
- **单击**：随机播放一个「点击回应」动画（5 选 1）+ 随机气泡
- **拖拽**：跟随鼠标移动，鱼随方向轻微倾斜（保持待机画面，不改变大小）
- **右键 / 双击**：打开状态面板（校园信息 + DeepSeek 余额）
- **状态面板**：拖动标题栏可移动；拖动鱼时面板保持相对位置跟随；点 × 或再次右键/双击关闭

## 数据来源

- **校园信息**：读取 `~/.campus-agent/state.json`（需先 `campus-agent sync_timetable` 同步课表）
- **DeepSeek 余额**：读取 `~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY`，调 `api.deepseek.com/user/balance`

## 素材

- `assets/webm/`：透明动画片段（待机 1 段 + 点击回应 5 段），来源 dsh-pet
- `assets/fish.png`：透明底的大肥鱼静态图（早期占位，现已改用 webm 动画）
- `assets/fish-source.jpg`：用户最初提供的原始图

## 动画实现

渲染进程用单个 `<video>` 元素切换 `src` 播放不同片段（`renderer.js`）：

- 待机用 `loop`，点击回应是一次性（`ended` 后回落待机）
- 拖拽不换片段，只在待机画面上加 `rotate` 倾斜反馈——因为「被鼠标拖拽悬空反馈」片段里鱼被拎起时更宽、且整体上移，直接换片会显得「变大」
- 点击片段在启动时用隐藏 `<video preload="auto">` 预加载，避免首次点击解码卡顿
- 窗口为 16:9（400×225），与 640×360 素材等比，`object-fit: contain` 避免变形

## 性能说明

动画完全由 Chromium 的视频解码器处理，空闲时 JS 主循环不参与持续动画；拖拽/点击期间才短暂走 JS。
