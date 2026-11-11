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
- **单击**：随机播放一个「点击回应」动画（5 选 1）+ 随机气泡，并打开对话窗（和 DSH 聊天 / 截屏提问）
- **拖拽**：跟随鼠标移动，鱼随方向轻微倾斜（保持待机画面，不改变大小）
- **右键 / 双击**：打开状态面板（今日课程 + Canvas 任务 + DeepSeek 余额 / 当日消费金额）
- **状态面板**：拖动标题栏可移动；拖动鱼时面板保持相对位置跟随；点 × 或再次右键/双击关闭
- **对话窗**：和 DeepSeek 文字聊天（`deepseek-flash`）；点「📸 截屏」截取当前屏幕并针对屏幕提问（视觉问答）；点「🚀 DSH」启动完整 DSH Web UI（`http://127.0.0.1:3080`）

## 数据来源

- **今日课程**：读取 `~/.campus-agent/state.json` 的课表缓存，按上海交大节次表把节次换算成具体上课时间，只显示课程名 / 地点 / 时间（需先 `campus-agent sync_timetable` 同步课表）
- **Canvas 任务**：读取 `~/.campus-agent/state.json` 的 `canvas` 缓存，列出截止时间最近的作业（需先在 campus-agent 中 `refresh_canvas_courses` + `refresh_canvas_course` 同步）
- **DeepSeek 余额**：读取 `~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY`，调 `api.deepseek.com/user/balance`
- **当日消费金额**：读取 `pet/src/config.json` 的 `deepseekUserToken`（平台登录态，见下），调 `platform.deepseek.com/api/v0/usage/cost` 按天累加今日各模型/各计费项金额
- **对话 / 截屏提问**：读取 `~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY`，调 `api.deepseek.com/chat/completions`（模型 `deepseek-flash`，同时支持文字与图片输入）；截屏由 Electron `desktopCapturer` 抓取主显示器画面

> `deepseekUserToken` 是浏览器登录 `platform.deepseek.com` 后 localStorage 里的 `userToken`（形如 `{"value":"...","__version":"0"}`，取其中 `value`）。公开 API 只有余额，没有逐日金额；该接口是平台私密接口，token 过期后需重新到浏览器里取一次。已存入 `pet/src/config.json`（gitignore，纯本地）。

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
