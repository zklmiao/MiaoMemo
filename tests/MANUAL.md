# 手工 GUI 验证清单（Electron，需真机，不虚假 pass）

> 原则：每个用例必须检查**磁盘 `notes.json` 内容**（而非“无报错”），先在隔离目录复现，
> 记录 PASS/FAIL + 文件 diff。隔离目录用法（已在 `main.js` 实现）：

```powershell
# 每次用全新空目录，互不污染真实便签
$td = "$env:TEMP\miaomemo-test-1"
Remove-Item -Recurse -Force $td -ErrorAction SilentlyContinue
New-Item -ItemType Directory $td | Out-Null
npm start -- --user-data-dir="$td"
# 用例结束后检查：
Get-Content "$td\notes.json"
```

## T-P0-1 跨便签并发（D1）
1. 隔离启动，开两个便签（底部 `+`）。
2. 10s 内在 A 输入 `AAA-时间戳`，紧接着在 B 输入 `BBB-时间戳`。
3. 等 2s → 完全退出（托盘 → 退出）→ 重开同一隔离目录。
4. oracle：`notes.json` 同时含 AAA 与 BBB。缺任一 = FAIL。

## T-P0-2 拖动不丢（D2/D8）
1. A 输入 `POS-TEST`，不关闭。
2. 持续拖动 B 窗口 5s（move 事件高频），同时 A 再追加 `MORE`。
3. 退出重开。oracle：A 的两次输入都在，且 B 的 x/y 为最后位置。内容回退 = FAIL。

## T-P0-3 退出 flush（D3）
1. 输入 `QUIT-时间戳` 后 1s 内立即托盘退出。
2. 重开。oracle：`QUIT-时间戳` 仍在。丢失 = FAIL。

## T-P0-4 关闭 flush + 空清理（D4/D7）
1. 新便签输入 `CLOSE-时间戳`，400ms 内点右上 × → 关闭窗口。
2. 查 `notes.json`：含 `CLOSE-时间戳` = PASS，丢失 = FAIL。
3. 新建空便签（标题内容全空）→ × 关闭 → 查盘：该 note id 不存在 = PASS，残留 = FAIL。

## T-P0-5 损坏恢复（D6）
1. 关闭 app，打开 `$td\notes.json`，截断为 `{corrupted` 保存。
2. 启动。oracle：目录出现 `notes.json.corrupt-*.bak` 且内容等于截断前原文；app 不崩溃并显示欢迎页。无 bak 或直接变空无备份 = FAIL。

## T-P0-6 翻页竞态（N2）
1. 第 1 页输入 `PAGE1-时间戳`，400ms 内立即点 `+` 加页，输入 `PAGE2-时间戳`。
2. 退出重开。oracle：两页都在且顺序正确。PAGE1 丢失/覆盖 = FAIL。

## T-P1-1 旧 isCollapsed 兼容（N1/N3）
1. 手工在 `notes.json` 给某 note 加 `"isCollapsed": true`，启动。
2. oracle：无弹窗报错、无 `headerTitle` TypeError（DevTools Console 为空），窗口正常高度。崩溃 = FAIL。

## T-P1-2 列表/复选（N5/D11/D15）
1. 输入 `* item` 回车 → 应续 `* `；`+ item` 回车 → 应续 `+ `；`- [ ] t` 回车 → 应续 `- [ ] `。
2. 失焦进预览，鼠标点复选框 → 勾选且切回编辑可见 `- [x]`；键盘 Tab 到复选框按空格 → 同样切换。
3. 任一不符 = FAIL。

## T-P1-3 IPC 容错（D5）
1. 观察 Console，无未捕获 `UnhandledPromiseRejection`。如有 = FAIL（允许有 `console.error` 记录）。

## T-P2 回归
- 6 主题右键切换 + 重开保持；置顶高亮 + 重开保持；分页增删跳；托盘双击新建 / 显示所有 / 退出。
- `npm run build` 成功（Windows x64 portable），产物可启动。
- 无障碍抽查：Tab 可达 pin/新建/关闭/翻页/复选框，焦点有可见 outline；屏幕阅读器可读出按钮 label。

## 记录模板
| 用例 | 隔离目录 | 结果 | notes.json diff/截图 | 备注 |
|---|---|---|---|---|
| T-P0-1 | ... | PASS/FAIL | ... | ... |
