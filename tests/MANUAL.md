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
4. oracle：`ALTF4-时间戳` 仍在。
5. 再输入 `INAPP-时间戳` 后立即通过便签内“退出 MiaoMemo”退出；重开。
6. oracle：`INAPP-时间戳` 仍在。任一路径丢失 = FAIL。

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
1. 记录启动前 `notes.json` 的 note 数量与 id 列表。
2. 启动 app，再双击一次同一个 exe。
3. oracle：第二个进程退出码为 0；`Get-Process miao-memo` 计数始终为 1；不得出现两套窗口同时写库。
4. 退出后查 `notes.json`：note 数量与 id 列表与步骤 1 一致（无丢失、无重复、无覆盖）。任一不符 = FAIL。

## T-P0-8 不可读数据库只读启动
1. 隔离目录中把 `notes.json` 建成目录（或占用/拒绝读取），启动 app。
2. oracle：出现“数据库不可读”对话框；原 `notes.json` 路径/内容不变；日志出现 `Cannot read notes database`；不得生成欢迎便签、不得打开便签窗口。
3. 修复路径后点“重试”：应加载原便签并打开窗口，日志出现 `Notes database reloaded after retry`。
4. 再次构造不可读路径并点“退出”：进程退出，路径仍保持不变。

## T-P0-9 保存失败可见与重试
1. 启动后把隔离数据目录改名（模拟父路径消失），输入 `SAVE-FAIL-时间戳`。
2. oracle：footer 保存状态显示“保存失败”，悬停可见错误，日志出现 `Error writing notes database`。
3. 把目录改回原名，点击“保存失败”状态。
4. oracle：状态变回“已保存”，`notes.json` 含 `SAVE-FAIL-时间戳`。

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
1. Tab 可达 pin/新建/关闭/翻页/页码按钮/复选框，焦点有可见 outline。
2. 点击页码按钮打开“跳转至页面”；Esc 关闭后焦点回到页码按钮。
3. 右键菜单可打开；按 `Menu` 键或 `Shift+F10` 也能打开；方向键在菜单内移动，Enter/Space 激活，Esc 关闭并恢复焦点。
4. 键盘切换主题：右键菜单中聚焦“更换主题”，ArrowRight 进入子菜单，选择颜色后主题变化。
5. 确认框：打开后 Tab 焦点圈定在对话框内，Esc 关闭并回到触发按钮。
6. DOM 检查：页码容器为 `role="group"`，页码按钮 `aria-expanded` 随开合变化；页码文本位于 `aria-live` 区域，翻页时内容更新；无嵌套 button 结构。

## T-P1-4 IPC 容错
1. 打开 WebView2 DevTools（debug 构建），观察 Console。
2. 无未捕获 `UnhandledPromiseRejection` / Tauri invoke 错误。允许有 `console.error` 记录。

## T-P1-5 窗口放置与快速创建
1. 连续快速点 `+` 创建 3 个便签。oracle：三个窗口级联位置两两不同（x 或 y 至少差一个级联步长）。
2. 托盘双击 + 立即在便签内点 `+`。oracle：同样位置互不重叠。
3. 手工把 `notes.json` 中某便签坐标改为屏幕外（如 x=5000,y=5000）后启动。oracle：该便签出现在可见工作区内。
4. 把坐标改为任务栏下方（y 超过工作区）后启动。oracle：窗口被拉回工作区内，不被任务栏遮挡。

## T-P1-6 页面动作双击串行
1. 双击“下一页”。oracle：只前进一页；`notes.json` 的 `currentPageIndex` 正确。
2. 双击“上一页”。oracle：只后退一页。
3. 对空页双击“删除当前页”。oracle：只删除一页，至少剩一页。
4. 对非空页删除并在确认框双击“删除当前页”。oracle：只删除一页。

## T-P1-7 删除便签
1. 右键菜单出现“删除当前便签”（键盘可达）。
2. 删除非空便签并确认。oracle：`notes.json` 不再包含该 id，窗口关闭。
3. 取消删除。oracle：便签与内容不变。
4. 删除最后一个便签。oracle：确认后 `notes.json` 为空列表；下次启动出现欢迎便签（行为已知且符合预期）。

## T-P1-8 IPC 安全
1. DevTools 执行 `location.href='https://example.com'`。oracle：导航被拒绝，仍停留在本地页面。
2. DevTools 执行 `window.open('https://example.com')`。oracle：不创建新窗口。
3. 用另一便签窗口的 label 伪造 `update_note`（DevTools 中 `invoke('update_note',{noteId:'其它id',fields:...})`）。oracle：Promise reject，目标便签内容不变，日志记录拒绝。
4. DevTools 发送超大 `pages`（>100k 字符）或 >200 页。oracle：invoke 返回 false，目标便签不变，无部分写入。

## T-P2-1 行内强调与标题提取
1. 输入 `***三重强调***`、`**加粗** 和 *倾斜*`、`**外层 *内层***` 各一行，失焦进预览。
   oracle：三重强调同时粗+斜；预览 HTML（DevTools 检查）无裸星号残留、`<strong>`/`<em>` 开合数量相等；未配对的 `**abc` 保持字面。
2. 新便签首行输入 `2026-10-27 会议记录`，打开底部页码列表。
   oracle：列表显示的标题保留 `2026-10-27`（不得变成 `20261027`）；`notes.json` 中该页 `content` 原样保存。
3. 首行输入 `# 项目计划`。oracle：页码列表标题为 `项目计划`。

## T-P2-2 列表编辑键盘行为（每步后查盘）
1. `- [ ] 买牛奶` 行内光标置于行尾按 Enter。oracle：新增 `- [ ] ` 前缀，磁盘新增该行。
2. 空的 `- [ ] ` 行上按 Enter。oracle：前缀被移除、光标停在普通空行，不再生成新复选框；磁盘上原行变空行。
3. 任务项内按 Shift+Enter。oracle：项内换行（视觉上是同一任务的两行），不新增复选框前缀；磁盘为 `\n` 而非新 `- [ ] `。
4. `- 项目` 行按 Tab。oracle：行首加 2 空格、焦点仍在编辑器；预览中项目符号降一级（或复选框行左移缩进）。再按 Tab 到 3 层后第 4 次 Tab 不再加深。
5. 缩进行按 Shift+Tab。oracle：减少一层（2 空格或 1 个制表符）；0 缩进时 Shift+Tab 无变化且焦点不移出。
6. 非列表行按 Tab。oracle：默认焦点移动行为（不被编辑器吞掉）。
7. 中文输入法组合中按 Tab/Shift+Enter。oracle：组合不中断、无缩进变化、无新列表项。
8. 每一步用 `Get-Content $td\notes.json` 核对 Markdown 原文，任一不符 = FAIL。

## T-P2-3 复选框指纹（陈旧行号防御）
1. 输入两行任务 `- [ ] A任务`、`- [ ] B任务`，失焦进预览。
2. DevTools（debug 构建）执行 `document.querySelector('.memo-textarea').value = '前插入行\n' + 原文`（模拟渲染后文本被程序改动，行号 +1）。
3. 点击 `A任务` 的预览复选框。oracle：翻转的正是 `A任务` 那一行（不是顺移后的 `B任务`），`notes.json` 中仅 A 行变 `[x]`。
4. 构造歧义场景：两行任务改为完全相同文本后，在 DevTools 中把其中一行删除使指纹计数不匹配，再点击复选框。oracle：预览被重建、本次点击不翻转任何行（绝不猜）；再次点击恢复正常翻转。
5. 正常路径回归：不经程序改动直接点击复选框。oracle：立即翻转、磁盘同步。
6. 双向循环：预览态对同一任务连续点击三次（勾选→取消→再勾选）。oracle：状态随每次点击翻转（`[ ]`→`[x]`→`[ ]`→`[x]`），`aria-checked` 同步，磁盘 Markdown 与预览一致。已知回归：曾因比较 `[x]` 与 `x` 导致取消勾选失效。

## T-P2-4 UI 状态（滚动条 / 不可用便签 / 页码占位）
1. 白主题 + 内容超长（>30 行）。oracle：预览右侧滚动条滑块清晰可见，悬停加深但不消失。其余 5 主题抽查一遍。
2. 缺失便签：启动后（debug 构建）在 DevTools 执行 `window.memoAPI.getNoteData = async () => null; initNote();`。
   oracle：编辑器与页脚整体隐藏，出现“便签数据不可用”提示与“重试/关闭窗口”按钮；页码不显示任何 `n / n`（含假 `2 / 2`）；文案不得出现“已保存”字样。
3. 点击“重试”（先恢复 getNoteData）。oracle：错误态消失、便签正常加载。
4. 点击“关闭窗口”。oracle：窗口关闭；`notes.json` 中该便签仍在（错误态不写盘）。
5. 强制加载失败：DevTools 中让 `getNoteData` reject。oracle：同样进入不可用态，Console 有 `getNoteData failed` 记录。
6. 启动瞬间观察页码：加载完成前显示 `— / —` 占位，不得闪现 `1 / 1` 假数据。

## T-P2-5 数据韧性（真实加载路径）
1. 关闭 app，手工把 `notes.json` 中两条 note 的 `id` 改成相同值，启动。
   oracle：两条便签各自独立成窗；磁盘 id 已恢复唯一（首条保留、次条重生成）；目录出现 `notes.json.corrupt-*.bak` 备份且内容为修复前原文。
2. 手工把顶层 `"schemaVersion"` 改为 `99`，启动。
   oracle：弹“数据库不可读/版本过新”对话框；点取消退出后 `notes.json` 原样（版本号仍 99、notes 未动）；点重试在文件未修时保持只读错误态。
3. 把版本号删掉（模拟旧文件），启动后输入任意内容再退出。
   oracle：重开查盘：`notes.json` 顶层出现 `"schemaVersion": 1`，全部数据完好。
4. 恢复目录中已有 ≥10 个 `notes.json.corrupt-*.bak`（可手工造），再制造一次损坏启动。oracle：备份总数收敛到 10 且最新一份仍在；手工创建的非时间戳命名 `.bak` 未被删除。

## T-P2-6 安装器与发布产物
1. 运行 `npm run build`。oracle：`scripts/check-versions.mjs` 先输出 `check-versions: ok`，NSIS 产物生成。
2. 临时把 `package.json` 版本改成与 `tauri.conf.json` 不同，再跑 `npm run build`。oracle：构建立即失败并逐文件列出三个版本号；改回后恢复。
3. 运行 `npm run build:offline`。oracle：构建成功、产物体积明显大于默认包（内嵌 WebView2 Runtime）。【需离线虚拟机】在无网络且无 WebView2 的机器上安装并启动，安装完成、便签可用。
4. 默认包在无 WebView2 且无网络的机器上安装。oracle：出现引导器的可见失败/中止提示，不得表现为“安装成功但应用无法启动”。【需干净虚拟机】
5. 安装界面出现语言选择（简体中文/English），选择后安装向导语言随之切换。

## T-P2-7 通用回归
- 6 主题右键切换 + 重开保持；置顶高亮 + 重开保持；分页增删跳；托盘双击新建 / 显示所有 / 退出。
- 窗口透明/圆角/拖拽区域正常；`data-tauri-drag-region` 区域可拖动，按钮可点击。
- `npm run build` 成功（NSIS），产物可启动。
- 无障碍抽查：屏幕阅读器可读出按钮 label；菜单/对话框焦点行为可接受。
- 数据目录：确认 README 中的 `%APPDATA%\com.miaomemo.desktop\notes.json` 路径与实际一致。

## 记录模板
| 用例 | 隔离目录 | 结果 | notes.json diff/截图 | 备注 |
|---|---|---|---|---|
| T-P0-1 | ... | PASS/FAIL | ... | ... |
