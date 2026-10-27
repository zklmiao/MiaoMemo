# 手工 GUI 验证清单（Tauri 2 + WebView2，需真机，不虚假 pass）

> 原则：每个用例必须检查**磁盘 `notes.json` 内容**（而非“无报错”），先在隔离目录复现，
> 记录 PASS/FAIL + 文件 diff。隔离目录通过环境变量覆盖，避免污染真实便签：

```powershell
# 每次用全新空目录，互不污染真实便签
$td = "$env:TEMP\miaomemo-test-1"
Remove-Item -Recurse -Force $td -ErrorAction SilentlyContinue
New-Item -ItemType Directory $td | Out-Null
$env:MIAOMEMO_DATA_DIR = $td
npm run dev
# 或运行已构建的 exe：
# & "src-tauri\target\release\miao-memo.exe"
```

用例结束后检查：

```powershell
Get-Content "$td\notes.json"
```

> 注意：`MIAOMEMO_DATA_DIR` 只影响当前 PowerShell 会话；运行已构建 exe 前也要先设置。

## T-P0-1 跨便签并发
1. 隔离启动，开两个便签（底部 `+`）。
2. 10s 内在 A 输入 `AAA-时间戳`，紧接着在 B 输入 `BBB-时间戳`。
3. 等 2s → 托盘“退出 MiaoMemo” → 重开同一隔离目录。
4. oracle：`notes.json` 同时含 AAA 与 BBB。缺任一 = FAIL。

## T-P0-2 拖动/缩放不丢
1. A 输入 `POS-TEST`，不关闭。
2. 持续拖动/缩放 B 窗口 5s，同时 A 再追加 `MORE`。
3. 退出重开。oracle：A 的两次输入都在，且 B 的 x/y/width/height 为最后状态。内容回退 = FAIL。

## T-P0-3 立即退出 flush（关键回归）
1. 输入 `QUIT-时间戳` 后**立即**（<100ms）托盘退出；不要等 1s。
2. 重开。oracle：`QUIT-时间戳` 仍在。
3. 再输入 `ALTF4-时间戳` 后立即按 Alt+F4 关闭窗口；重开。
4. oracle：`ALTF4-时间戳` 仍在。丢失 = FAIL。

## T-P0-4 关闭 flush + 空清理
1. 新便签输入 `CLOSE-时间戳`，立即点右上 × → 关闭当前便签。
2. 查 `notes.json`：含 `CLOSE-时间戳` = PASS，丢失 = FAIL。
3. 新建空便签（标题内容全空）→ × 关闭 / Alt+F4 → 查盘：该 note id 不存在 = PASS，残留 = FAIL。

## T-P0-5 损坏恢复
1. 关闭 app，把 `$td\notes.json` 截断为 `{corrupted` 保存。
2. 启动。oracle：目录出现 `notes.json.corrupt-*.bak` 且内容等于截断前原文；app 不崩溃并显示欢迎页。无 bak 或直接变空无备份 = FAIL。
3. 再构造合法 JSON 但单条 note 的 `pages` 为对象（如 `{"notes":[{"id":"bad","pages":{}}]}`），启动。oracle：跳过坏 note、产生备份、其余 note 正常显示，不得出现 0 窗口。

## T-P0-6 翻页竞态
1. 第 1 页输入 `PAGE1-时间戳`，立即点 `+` 加页，输入 `PAGE2-时间戳`。
2. 退出重开。oracle：两页都在且顺序正确。PAGE1 丢失/覆盖 = FAIL。

## T-P0-7 单实例
1. 启动 app，再双击一次同一个 exe。
2. oracle：第二个进程退出并聚焦/显示已有便签；不得出现两套窗口同时写库。
3. 查 `notes.json`：没有因双实例互相覆盖导致的 note 丢失。

## T-P1-1 旧 Electron 数据迁移
1. 准备 `%APPDATA%\MiaoMemo\notes.json`（或 `miao-memo`），删除 Tauri 数据目录。
2. 启动。oracle：旧便签出现在 `%APPDATA%\com.miaomemo.desktop\notes.json`，内容完整。
3. 旧文件含字符串 `pages` / `isCollapsed`：启动后应自动规范化，无报错。

## T-P1-2 列表/复选/IME
1. 输入 `* item` 回车 → 应续 `* `；`+ item` 回车 → 应续 `+ `；`- [ ] t` 回车 → 应续 `- [ ] `。
2. 中文输入法选词时按回车：不得插入新列表项或打断候选词上屏。
3. 失焦进预览，鼠标点复选框 → 勾选且切回编辑可见 `- [x]`；键盘 Tab 到复选框按空格 → 同样切换。
4. 任一不符 = FAIL。

## T-P1-3 键盘/ARIA
1. Tab 可达 pin/新建/关闭/翻页/复选框，焦点有可见 outline。
2. 在“上一页/下一页”按钮上按 Enter/Space：应翻页，不得打开“跳转至页面”菜单。
3. 右键菜单可打开；确认框可用 Esc 或取消关闭（若实现）。

## T-P1-4 IPC 容错
1. 打开 WebView2 DevTools（debug 构建），观察 Console。
2. 无未捕获 `UnhandledPromiseRejection` / Tauri invoke 错误。允许有 `console.error` 记录。

## T-P2 回归
- 6 主题右键切换 + 重开保持；置顶高亮 + 重开保持；分页增删跳；托盘双击新建 / 显示所有 / 退出。
- 窗口透明/圆角/拖拽区域正常；`data-tauri-drag-region` 区域可拖动，按钮可点击。
- `npm run build` 成功（NSIS），产物可启动。
- 无障碍抽查：屏幕阅读器可读出按钮 label；菜单/对话框焦点行为可接受。
- 数据目录：确认 README 中的 `%APPDATA%\com.miaomemo.desktop\notes.json` 路径与实际一致。

## 记录模板
| 用例 | 隔离目录 | 结果 | notes.json diff/截图 | 备注 |
|---|---|---|---|---|
| T-P0-1 | ... | PASS/FAIL | ... | ... |
