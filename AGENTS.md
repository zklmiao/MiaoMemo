# AGENTS.md

## 命令
- `npm start`          — 开发模式启动应用
- `npm run build`      — 打包 Windows x64 便携版 exe
- `python fix_icon.py` — 修复 icon.ico 尺寸为 256x256（需要 Pillow）

## 架构
- Electron 桌面应用；入口 = `main.js`；`contextIsolation: true`，`nodeIntegration: false`
- 每个便签 = 一个独立的 `BrowserWindow`；渲染进程通过 `window.electronAPI`（`preload.js` 暴露）与主进程通信
- IPC 通道：`get-note-data`、`update-note`、`create-note`、`delete-note`、`toggle-collapse`（均为 handle/invoke）；`create-new-note-event`（on/send）
- 数据：单个 `notes.json`，位于 `app.getPath('userData')`，仅主进程读写；写入防抖 250ms

## 关键约束
- `.memo-header` 和 `.memo-footer`：必须保留 `flex-shrink: 0`。`.memo-body`、`.memo-textarea`、`.memo-preview`：必须保留 `flex-shrink: 1; min-height: 0`。破坏这些规则会导致窗口缩放时布局重叠。
- 窗口透明效果依赖 GPU 加速 —— 绝不能调用 `app.disableHardwareAcceleration()`
- **中文字体使用 Windows 系统字体**：`Microsoft YaHei` / `PingFang SC`，不依赖任何远程字体加载；仅 `Outfit`（拉丁/英文）本地化在 `fonts/` 目录中
- `icon.ico` 必须同时存在于项目根目录和 `build/` 目录中，否则 electron-builder NSIS 打包报错
- electron-builder 配置在 `package.json` 的 `"build"` 字段中；只有 `build.files` 中列出的文件会被打包 —— 新增源文件时记得添加

## 无测试、无 Lint、无 CI
本项目没有测试套件、代码检查、类型检查或 CI 流水线。
