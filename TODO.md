# MiaoMemo Tauri 版待办

> 来源：2026-10-27 对当前 Tauri 2 + Rust 代码的审计。
> 基线：JS 测试 2/2、Rust 测试 11/11；窗口、托盘、单实例、拖拽、关闭、退出已做运行时验证。
> 说明：按 P0 → P1 → P2 排序。每项包含位置、问题和验收标准；完成后勾选并补充修复说明。

## OpenSpec 规划索引

- `openspec/changes/p0-data-safety/` — P0 数据安全 ticket
- `openspec/changes/p1-stability-and-ux/` — P1 稳定性/窗口/交互 ticket
- `openspec/changes/p2-editor-and-boundaries/` — P2 编辑器/边界/打包 ticket
- `openspec/changes/backlog-optimizations/` — 优化 backlog ticket
- `openspec/specs/project-development/spec.md` — 项目开发基线规范
- `openspec/specs/testing/spec.md` — 测试基线规范

> 以上提案只完成规划，tasks 尚未勾选；实现需走 `/opsx:apply` 或明确的开发请求。

## P0 数据安全（优先处理）

- [x] **DATA-01 关闭/退出握手，消除最后 IPC 竞态**
  - 位置：`src-tauri/src/main.rs:236`、`src/renderer.js:194`
  - 问题：输入通过异步 IPC 发送；Alt+F4 或托盘退出可能在 IPC 到达前销毁窗口，导致最后一段输入丢失，甚至把刚输入的便签误判为空并删除。
  - 方案：拦截 `CloseRequested`，先请求 renderer flush，收到确认后再关闭；托盘退出同样先广播 flush，超时再强制退出。避免 OS 关闭路径直接 `remove_if_empty`。
  - 验收：输入唯一标记后立即 Alt+F4 / 托盘退出，重开后标记仍在；空便签正常清理；改动补充自动化或手工用例。

- [x] **DATA-02 读取失败进入只读保护，绝不覆盖原库**
  - 位置：`src-tauri/src/store.rs:386`
  - 问题：`fs::read_to_string` 的任何错误都被当成空库；随后创建欢迎便签并写盘，可能覆盖只是暂时不可读的 `notes.json`。
  - 方案：区分 `NotFound` 和其他读错误；其他错误进入只读/启动失败模式，禁止写盘，尽量备份原文件并提示用户。
  - 验收：模拟文件被占用/权限拒绝/瞬时 IO 错误，启动后原文件内容不变；有可见错误提示或日志。

- [x] **DATA-03 写盘失败可见、可重试、退出前不静默丢数据**
  - 位置：`src-tauri/src/store.rs:503`、`src-tauri/src/main.rs:1`
  - 问题：写失败只 `eprintln!`，release 无控制台；worker 只重试一次；`quit_app` 在 flush 失败后仍退出。
  - 方案：接入文件日志；失败保留 dirty 并指数退避；退出前 flush 失败时提示用户或阻止退出；保存状态透出到 UI。
  - 验收：模拟磁盘满/只读，界面显示保存失败；数据保留；日志可查；退出行为可预期。

## P1 稳定性 / 窗口 / 交互

- [x] **WIN-01 快速新建便签坐标不重叠**
  - 修复（P1）：级联槽位（cascade_slot）+ 工作区夹取，`rapid_cascade_slots_produce_distinct_positions` 单测 + T-P1-5 手工验证。
  - 位置：`src-tauri/src/main.rs:161`、`src-tauri/src/main.rs:282`
  - 问题：级联位置依赖 `webview_windows().len()`，而窗口创建是异步的；连续创建可能得到相同坐标。
  - 验收：连续快速创建 3 个便签，坐标互不相同；托盘双击同样验证。

- [x] **WIN-02 窗口恢复到可见显示器范围内**
  - 修复（P1）：按 `available_monitors()` 工作区夹取，完全不可见回退主屏；夹取单测 4 例 + 手工离屏恢复。
  - 位置：`src-tauri/src/main.rs:190`
  - 问题：直接使用数据库中的 `x/y`，副屏拔掉后窗口可能出现在屏幕外，且应用无任务栏图标。
  - 方案：按 `available_monitors()` 的工作区夹取；完全不可见时移到主屏。
  - 验收：手工修改 `notes.json` 到屏幕外坐标，启动/显示所有便签后窗口可见。

- [x] **WIN-03 翻页/删页双击防重**
  - 修复（P1）：`createPageActionGuard()` 动作串行化（noteUtils 真模块 + 3 断言单测），双击只执行一次。
  - 位置：`src/renderer.js:619`、`src/renderer.js:655`
  - 问题：在 `await flushPendingSave()` 前检查索引；快速双击可能跳过一页或连续删除两页。
  - 方案：加 `pageActionBusy` 锁，或在 await 后重新检查索引/页数。
  - 验收：快速双击下一页/删除页，只执行一次；补充手工或自动化用例。

- [x] **UI-01 主题子菜单不被窗口右侧裁切**
  - 修复（P1）：按最终夹取位置计算翻转到 `submenu-left`，release CDP 验证子菜单完整可见。
  - 位置：`src/style.css:541`、`src/style.css:121`、`src/renderer.js:422`
  - 问题：子菜单固定 `left: 98%`，容器 `overflow: hidden`；靠右右键时大部分不可见。
  - 方案：接近右边界翻到左侧，或把菜单渲染到不受裁剪的浮层，并把子菜单宽度纳入夹取。
  - 验收：默认 300px 宽便签右边缘右键，主题子菜单完整可见。

- [x] **UI-02 菜单与对话框键盘可达**
  - 修复（P1）：菜单 roving focus + Menu/Shift+F10 打开 + 对话框焦点陷阱 + Esc；页码 ARIA 修正（无嵌套按钮，aria-live）。
  - 位置：`src/renderer.js:486`、`src/style.css:541`、`src/index.html:57`、`src/index.html:110`、`src/index.html:131`、`src/index.html:147`
  - 问题：页面菜单项无 `tabindex`/键盘处理；主题子菜单只靠 hover；对话框无焦点陷阱/Esc；`role=button` 容器内嵌按钮。
  - 验收：仅用键盘可打开/跳转页面、切换主题、关闭确认框；Tab 焦点不逃出对话框；屏幕阅读器可读。

- [x] **UI-03 增加非空便签删除入口**
  - 修复（P1）：右键菜单新增“删除当前便签”+ 确认框；删除同步 `notes.json` 与窗口关闭（CDP 验证磁盘）。
  - 位置：`src/api.js:19`、`src-tauri/src/main.rs` 的 `delete_note`
  - 问题：命令和 API 已存在，但 renderer 没有调用；用户无法删除非空便签。
  - 验收：右键菜单可删除当前便签，带确认；`notes.json` 与窗口同步更新；或明确移除死接口。

- [x] **UI-04 保存状态反馈**
  - 修复（P1）：footer 保存状态（保存中/已保存/保存失败/只读），失败可点击重试；`lastUpdateFailed` 阻止虚假 ack。
  - 位置：`src/renderer.js:70`
  - 问题：`safeUpdateNote` 只 `console.error`，`update_note` 返回 `false` 也被忽略；用户无法知道保存失败。
  - 验收：保存中/成功/失败有明确 UI；失败后不显示“已保存”；关键路径有重试或提示。

- [x] **SEC-01 导航与 IPC 调用方校验**
  - 修复（P1）：`on_navigation` 仅本地来源、`on_new_window` 拒绝、命令校验调用窗口 label、更新载荷上限校验（Rust 单测）。
  - 位置：`src-tauri/src/main.rs` 窗口创建、`get_note_data`/`update_note`
  - 问题：未显式禁止远程导航/新窗口；命令未校验调用窗口 label 与 `note_id` 一致。
  - 验收：远程 URL 导航被拒绝；其他窗口无法用伪造 `note_id` 读写不属于自己的便签；保留现有 CSP 与最小 capabilities。

## P2 UI / 编辑器 / 边界

- [x] **EDIT-01 Markdown 与列表编辑边界**
  - 修复（P2）：强调扫描器（`***`/`**`/`*` 平衡嵌套，未配对保持字面）+ 空项退出 + Shift+Enter 换行 + Tab/Shift+Tab 缩进（≤3 层）+ 标题保留日期连字符（JS/Rust 对齐共享用例）+ 复选框内容指纹防切错行。
  - `***bold italic***` 嵌套强调解析错误（`src/renderer.js:287`）。
  - 空 `- [ ]` 行按 Enter 无法退出列表（`src/renderer.js:585`）。
  - Shift+Enter 被当成续列表；Tab 不能缩进列表。
  - `extractTitleFromText` 删除所有 `-`，日期标题会变形（`src/noteUtils.js:13`）。
  - 预览复选框 `data-line-index` 在内容程序化变化后可能切错行（低概率）。

- [x] **UI-05 预览滚动条与占位状态**
  - 修复（P2）：预览滚动条 thumb `rgba(0,0,0,0.18/0.32)`；初始页码 `— / —`；`getNoteData` 失败/缺失时显式不可用态（隐藏编辑器/页脚，重试/关闭，绝不假页码）。
  - 浅色主题下预览滚动条 thumb 几乎不可见（`src/style.css:316`）。
  - 初始页码 `2 / 2` 是占位；`getNoteData` 返回 null 时应显示错误/关闭窗口，而不是假页码。

- [x] **DATA-04 损坏数据与重复 ID 加固**
  - 修复（P2）：重复 id 加载修复（先备份）；`schemaVersion`（旧文件内存升级、更高版本拒载只读）；备份保留 10 份只清自身命名；`lock_inner` 中毒恢复 + worker 失联 `degraded` 直写。
  - 重复 note id 未去重，窗口 label 冲突时第二个窗口创建失败。
  - 备份文件无轮转/清理；建议增加 schema 版本与备份保留策略。
  - `Mutex` poison、worker 线程退出、channel send 失败目前未处理。

- [x] **WIN-04 窗口创建失败反馈**
  - 修复（P1）：窗口创建/关闭失败统一 `log::error` 记录（tauri-plugin-log，文件 + stdout 可查）。
  - 修复（P2）：启动恢复所有便签窗口（原仅首条；与旧 Electron 行为一致，重复 id 修复后各便签独立成窗）。
  - `create_note` 在窗口创建前就返回成功；创建失败只写 stderr，用户看到便签在库中但无窗口。
  - 建议通过事件/状态把失败反馈给前端，或重试/回滚。

- [x] **BUILD-01 安装与分发**
  - 修复（P2）：默认包 `embedBootstrapper` + README 网络前提；`npm run build:offline`（`offlineInstaller`，实测 209.94 MiB）；NSIS 中/英语言选择；`scripts/check-versions.mjs` 构建前版本一致性门禁；README/AGENTS 记录不签名（SmartScreen 警告）与无自动更新器。
  - 配置 WebView2 `embedBootstrapper`，避免离线安装失败。
  - 评估代码签名、自动更新、NSIS 语言/安装体验。
  - 保持 `Cargo.toml`、`tauri.conf.json`、`package.json` 版本同步。

## 优化 backlog（非阻塞）

- [ ] **PERF-01 保存协议瘦身**：renderer 每个按键发送完整 `pages` 数组且 `saveChain` 逐个排队；改为 latest-wins 合并，编辑时只发当前页，结构变更才发完整 `pages`。
- [ ] **PERF-02 几何更新节流**：move/resize 事件每次加锁 + 发 channel；可 100ms 节流。
- [ ] **WIN-05 窗口管理重构**：用单一线程/命令队列管理创建、关闭、置顶，替代每次 `std::thread::spawn`；`on_page_load` 完成后再 show，减少空白闪烁。
- [ ] **UX-01 显示所有便签管理**：便签多时不要一次打开几十个窗口，改为列表/分页/聚焦已有窗口。
- [ ] **UX-02 视觉增强**：深色模式、`prefers-reduced-motion`、菜单主题适配；如需要真亚克力，评估 `window-vibrancy`/`backgroundMaterial`（当前只是半透明 CSS）。
- [ ] **ENG-01 代码组织**：拆分 `main.rs`（窗口/托盘/命令）与 `store.rs`（模型/持久化/测试）；清理未使用变量和 `deleteNote` 死接口（若 UI-03 不实现）。
- [ ] **ENG-02 质量门禁**：`cargo clippy -- -D warnings`、`cargo fmt --check`、JS lint、CI（Windows runner）、依赖审计。
- [ ] **TEST-01 测试补齐**：
  - Rust：读错误、写失败、重复 ID、级联位置、关闭/退出竞态。
  - Renderer/e2e：翻页双击、子菜单几何、键盘导航、Markdown 边界、Alt+F4 立即退出。
  - 手工清单补充：托盘退出立即输入、外接屏拔插、快速连续新建。

## 完成标准

- P0 全部修复并有回归测试/可复现验证。
- P1 修复后 `npm test`（JS + Rust）通过，`npm run build` 成功。
- 手工清单覆盖 Alt+F4/托盘退出、离屏恢复、快速新建、菜单键盘操作。
- 每项修复记录 commit/PR，更新本文件勾选状态。
