# 第二阶段：桌宠（蓝色大肥鱼 · DeepSeek 拟人形象）

## 目标

一个 Windows 桌面宠物：透明、置顶、可拖拽的蓝色大肥鱼，挂载在桌面上。第一版包含：

1. **待机动作**：漂浮、游动倾斜、呼吸缩放、点击挤压反应、拖拽跟随。用单张图 + CSS transform 实现，GPU 合成、低 CPU。
2. **校园信息**：读 `~/.campus-agent/state.json`，显示课表同步状态、今日课程。
3. **DeepSeek 平台数据**：显示余额 / 用量（`api.deepseek.com/user/balance`），后续可扩展 token 消耗明细。

## 约束

- 素材：**单张图片**（用户提供），只能做整体变换动画，不做逐帧动画（摆尾/眨眼/口型需多帧素材）。
- 性能：动画只走 `transform`/`opacity`（合成器线程），不用 JS 高频循环做持续动画；拖拽用 JS 但只在拖拽期间生效。

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
      index.html       # 鱼
      renderer.js      # 拖拽/点击/动作/换图
      styles.css
      panel.html       # 信息面板
      panel.js
  assets/
    fish.png           # 用户提供（放这里即自动替换占位图）
```

## 待办 / 后续

- [x] 用户提供 `大肥鱼.jpg` → 抠黑底 → 透明 `pet/assets/fish.png`
- [x] Electron 骨架（透明置顶窗口 + 拖拽/点击/待机动画 + 信息面板）
- [ ] DeepSeek token 消耗明细（当前 balance 接口只有余额，无逐日 token；需确认数据源）
- [ ] 校园信息提醒（上课前/作业截止前气泡）
- [ ] MiniMax key（已本地保存未入库）：后续可用 `image-01` 生成额外表情/姿态帧
