# 大肥鱼桌宠（campus-agent pet）

Electron 透明置顶窗口的桌面宠物，蓝色大肥鱼（DeepSeek 拟人形象）。

## 运行

```bash
cd pet
npm install   # 会下载 Electron（约 158MB）
npm start
```

## 交互

- **拖拽**：移动位置
- **单击**：挤压反应 + 随机气泡
- **右键 / 双击**：打开状态面板（校园信息 + DeepSeek 余额）

## 数据来源

- **校园信息**：读取 `~/.campus-agent/state.json`（需先 `campus-agent sync_timetable` 同步课表）
- **DeepSeek 余额**：读取 `~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY`，调 `api.deepseek.com/user/balance`

## 素材

- `assets/fish.png`：透明底的大肥鱼（由 `fish-source.jpg` 抠黑底生成）
- `assets/fish-source.jpg`：用户提供的原始图

## 性能说明

待机动画只走 CSS `transform`/`opacity`（GPU 合成层），持续动画不经过 JS 主循环；拖拽/点击期间才短暂用 JS，空闲 CPU 占用极低。
