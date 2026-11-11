# 第二阶段：桌宠（蓝色大肥鱼 · DeepSeek 拟人形象）

## 目标

一个 Windows 桌面宠物：透明、置顶、可拖拽的蓝色大肥鱼，挂载在桌面上。第一版包含：

1. **待机动作**：循环播放「待机呼吸休闲」透明 webm；**互动独立动作**：单击随机「点击回应」（5 选 1）、拖拽倾斜跟随（保持待机画面，不换片段）。
2. **校园信息**：读 `~/.campus-agent/state.json`，显示课表同步状态、今日课程。
3. **DeepSeek 平台数据**：显示余额 / 用量（`api.deepseek.com/user/balance`），后续可扩展 token 消耗明细。

## 动画方案

参考/使用 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT）的**透明 webm 片段**方案：
每个动作一段 VP9-alpha 视频，渲染进程用 `<video>` 切换播放（待机 loop，点击一次性回落待机）。
素材从 dsh-pet 的 `assets/webm/` 拷贝到 `pet/assets/webm/`，无需 3D 建模、无需逐帧手画。

> 拖拽不用「被鼠标拖拽悬空反馈」片段：该片段里鱼被拎起时更宽、且整体上移，直接换片会显得「变大」。改为在待机画面上加 `rotate` 倾斜跟随。

## 约束

- 性能：动画交给 Chromium 视频解码器，空闲时 JS 主循环不参与持续动画。
- 素材：webm 为 640×360（16:9），窗口按 16:9（400×225）等比缩放。
- 拖拽移动：高 DPI（如 150%）下 `setPosition` 会因 DIP 舍入累积把窗口撑宽（拖一次 +1px），必须用 `setBounds` 显式锁定宽高。

## 技术形态

- Electron 透明置顶无边框窗口（与 Dela 同栈）。
- 两个窗口：`petWin`（鱼）+ `panelWin`（信息面板，右键/双击切换）。
- 放在仓库 `pet/` 目录，与 campus-agent 同仓。

## 目录

```
pet/
  package.json
  src/
    main.js            # 主进程：窗口、IPC、余额/校园信息读取
    preload.js         # contextBridge 暴露 petAPI
    renderer/
      index.html       # 鱼（<video>）
      renderer.js      # 动画状态机：idle/click/drag + 拖拽/点击/气泡
      styles.css
      panel.html       # 信息面板
      panel.js
  assets/
    webm/              # 透明动画片段（来自 dsh-pet，MIT）
    fish.png           # 早期占位静态图
    fish-source.jpg    # 用户最初提供的原始图
```

## 待办 / 后续

- [x] 用户提供 `大肥鱼.jpg` → 抠黑底 → 透明 `pet/assets/fish.png`（已被 webm 动画取代）
- [x] Electron 骨架（透明置顶窗口 + 拖拽/点击/待机动画 + 信息面板）
- [x] 动画升级为 dsh-pet 透明 webm 片段（待机 + 点击回应；拖拽改用倾斜跟随，避免换片“变大”）
- [ ] DeepSeek token 消耗明细（当前 balance 接口只有余额，无逐日 token；需确认数据源）
- [ ] 校园信息提醒（上课前/作业截止前气泡）
- [ ] 可选扩展：接入更多 dsh-pet 片段（睡觉三段接力、余额分档、工作状态、随机小动作）
- [ ] MiniMax key（已本地保存未入库）：后续可用 `image-01` 生成额外表情/姿态帧
