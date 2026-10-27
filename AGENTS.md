# AGENTS.md

## 命令
- `npm install`              — 安装 Tauri CLI（devDependency）
- `npm run dev` / `npm start` — Tauri 开发模式启动
- `npm run build`            — 打包 Windows NSIS 安装包（`src-tauri/target/release/bundle/nsis/`）
- `npm test`                 — JS 单元测试 + Rust 单元测试
- `npm run test:js`          — 仅跑 `tests/run-all.js`（noteUtils 真模块）
- `npm run test:rust`        — 仅跑 `cargo test --manifest-path src-tauri/Cargo.toml`
- `python generate_icons.py` — 从 `icon.ico` 生成 `src-tauri/icons/`（需要 Pillow）

## 架构
- Tauri 2 桌面应用；Rust 后端入口 = `src-tauri/src/main.rs`；前端静态资源 = `src/`（`tauri.conf.json` 的 `build.frontendDist: "../src"`）
- 每个便签 = 一个独立 `WebviewWindow`，窗口 label 即 note id；前端通过 `window.__TAURI__.window.getCurrentWindow().label` 取 id
- 前端 IPC 门面 = `src/api.js`，暴露 `window.memoAPI`（方法签名沿用旧 preload：`getNoteData(noteId)`、`updateNote(noteId, fields)` 等）
- IPC 命令（Tauri invoke）：`get_note_data`、`update_note`、`create_note`、`delete_note`、`close_window`、`quit_app`
- 数据：单个 `notes.json`，位于 `app_data_dir()`（Windows = `%APPDATA%\com.miaomemo.desktop`），仅 Rust 后端读写；内存缓存 + 250ms 单防抖刷盘 + 原子写（tmp→rename）+ 损坏/结构异常 JSON 备份；`CloseRequested`/`quit`/`RunEvent::Exit` 同步刷盘；启动清理或提升残留 `.tmp`
- 旧 Electron 数据迁移：目标文件不存在时，自动尝试 `%APPDATA%\MiaoMemo\notes.json` / `%APPDATA%\miao-memo\notes.json`
- 纯逻辑归属：`src/noteUtils.js`（判空/标题/id/默认便签，UMD 供 renderer+JS tests）、`src-tauri/src/store.rs`（数据模型/原子写/加载迁移/防抖/单测）；测试必须使用真模块，禁止复刻断言
- 测试隔离：`MIAOMEMO_DATA_DIR=<空目录>` 或 `--user-data-dir=<目录>` 覆盖数据目录，避免污染真实便签
- 单实例：`tauri-plugin-single-instance`；第二次启动显示已有便签并退出

## 关键约束
- `.memo-header` 和 `.memo-footer`：必须保留 `flex-shrink: 0`。`.memo-body`、`.memo-textarea`、`.memo-preview`：必须保留 `flex-shrink: 1; min-height: 0`。破坏这些规则会导致窗口缩放时布局重叠。
- 窗口透明效果依赖 WebView2 透明窗口与合成；不要移除 `transparent(true)`。当前是半透明 CSS 材质，不是桌面级亚克力模糊。
- 拖拽依赖 `data-tauri-drag-region` 属性与 `core:window:allow-start-dragging` capability；不要只保留旧的 `-webkit-app-region`。
- **中文字体使用 Windows 系统字体**：`Microsoft YaHei` / `PingFang SC`，不依赖任何远程字体加载；仅 `Outfit`（拉丁/英文）本地化在 `src/fonts/` 中。
- 图标由 `generate_icons.py` 生成到 `src-tauri/icons/`；修改 `icon.ico` 后必须重新生成，`tauri.conf.json` 的 `bundle.icon` 引用这些文件。
- 新增前端源文件时必须放进 `src/`；`tauri.conf.json` 的 CSP 需要允许其来源（脚本/样式/字体）。
- `Cargo.lock` 必须提交；`src-tauri/target/` 与 `src-tauri/gen/` 不入库。
- 前端每次输入都通过 IPC 发到 Rust；磁盘防抖只在 Rust 侧做。不要重新引入 renderer 侧长防抖，否则 Alt+F4/托盘退出会丢最后一段输入。

## 测试
- `npm run test:js`：noteUtils 判空/标题/id 真模块测试。
- `npm run test:rust`：原子写、损坏备份、坏 note 跳过、legacy pages 迁移、空库欢迎便签、`.tmp` 提升/清理、防抖落盘、颜色/页码校验。
- 手工 GUI 回归见 `tests/MANUAL.md`；每个用例必须检查磁盘 `notes.json`，不能只以“无报错”判 PASS。
