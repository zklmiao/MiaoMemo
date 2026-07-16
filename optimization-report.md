# 项目优化报告

生成日期：2026-07-16

---

## 🔴 高优先级（数据安全 / 功能性 Bug）

### 1. 跨便签数据丢失

- **文件**: `main.js` 第 259、274 行
- **问题**: `dbWriteTimeout` 是单个模块级变量，被所有便签窗口共享。当两个不同便签在短时间内触发 `update-note` 时，第一个便签的待写入被第二个的 `clearTimeout` 取消，且第二个调用从磁盘读到的是未包含第一个便签变更的旧数据，第一个便签的变更静默丢失。
- **建议**: 使用 `Map<noteId, timeout>` 实现每个便签独立的防抖定时器，或改用内存缓存 + 单全局防抖写入器。

### 2. 拖拽/缩放时同步 I/O

- **文件**: `main.js` 第 159–173 行
- **问题**: `saveBounds` 在每一次 `move` / `resize` 事件（每秒数十次）中同步调用 `readFileSync` + `writeFileSync`。这会阻塞主进程，导致界面卡顿和大量磁盘写入。
- **建议**: 对 `saveBounds` 做至少 500ms 防抖。更好的方案：在 `windows` Map 中内存缓存坐标，仅在应用退出或间隔持久化时写入磁盘。

### 3. 退出时防抖队列中的内容丢失

- **文件**: `main.js` — 缺少 `before-quit` 处理器
- **问题**: 应用退出时，防抖定时器中尚未刷新的数据永久丢失。没有监听 `app.on('before-quit', ...)` 来刷新待写入队列。
- **建议**: 添加 `before-quit` 处理器，在退出前同步刷新所有待写入。

### 4. 关闭窗口时最后 400ms 内容丢失

- **文件**: `renderer.js` 第 502–509 行
- **问题**: 点击"关闭当前便签窗口"前不刷新 `saveTimeout`，刚刚输入但尚未持久化的内容丢失。
- **建议**: 在关闭处理器中先 `clearTimeout(saveTimeout)`，同步当前页数据，调用 `updateNote` 持久化，然后再 `closeWindow`。

### 5. 全部 `await` IPC 调用无 try/catch

- **文件**: `renderer.js` 多处（第 53、168、372、455、504、510、556、569、586、615、624 行）
- **问题**: 每个 `await window.electronAPI.xxx()` 调用都没有错误处理。如果 IPC 调用失败（磁盘满、JSON 损坏等），Promise 静默 reject，用户无感知，数据可能丢失。
- **建议**: 对所有 IPC 调用包裹 try/catch，至少记录控制台错误；关键路径应向用户展示反馈。

### 6. JSON 损坏后不可恢复

- **文件**: `main.js` 第 22–30 行
- **问题**: `readDB` 遇到损坏 JSON 时返回 `{ notes: [] }`，下次 `writeDB` 会覆盖原文件，之前的数据永久丢失。
- **建议**: 区分"文件不存在"（返回空）和"文件存在但损坏"（备份损坏文件、抛出异常或返回错误标记）。

### 7. `close-window` 空页检查缺陷（上次修复未生效）

- **文件**: `main.js` 第 356 行
- **问题**: `const title = ((page.title || page) || '').toString().trim()` — 当 `page.title` 是空字符串 `""` 时，JS 视为 falsy，`||` 回退到 `page`（对象），`toString()` 产生 `"[object Object]"`，永远不会为空。`allEmpty` 检查永远不触发，空白便签在关闭时永远不会被自动删除。
- **建议**: 移除双重回退 hack。迁移后 `page` 始终是对象，直接用 `(page.title || '').trim()`。

---

## 🟡 中优先级（架构 / 代码质量）

### 8. 位置与内容双写路径冲突

- **文件**: `main.js` 第 159–173 行 vs 第 259–276 行
- **问题**: `saveBounds` 使用实时同步 I/O（位置），`update-note` 使用防抖异步 I/O（内容）。两条路径读/写同一份 `notes.json`，互相竞争覆盖。防抖写入器读到的可能是 `saveBounds` 刚写入但内容陈旧的快照。
- **建议**: 统一为一个持久化层，所有变更通过同一路径写入。

### 9. 默认 note 对象重复定义，高度不一致

- **文件**: `main.js` 第 57–68 行 (`initializeDB`) vs 第 308–319 行 (`handleCreateNewNote`)
- **问题**: 默认 note 对象（id、pages、color、width、height、isPinned、isCollapsed）在两处定义，且高度不一致：380px vs 350px。
- **建议**: 提取为 `createDefaultNote(id, pos)` 工厂函数，使用统一的 `DEFAULT_NOTE_HEIGHT` 常量。

### 10. 当前页同步代码重复 5 次

- **文件**: `renderer.js` 第 447、473、550、563、575 行
- **问题**: 同一 3 行代码块在 5 个位置出现：
  ```js
  notePages[currentPageIndex] = {
    title: memoTitleInput.value,
    content: memoTextarea.value
  };
  ```
- **建议**: 提取为 `syncCurrentPage()` 辅助函数。

### 11. 标题提取正则重复 4 次

- **文件**: `renderer.js` 第 69、82、133、437 行
- **问题**: 同一正则提取逻辑在 `initNote` 迁移路径、回退路径、`renderPagesMenu`、`getCollapseTitle` 中出现。
- **建议**: 提取为 `extractTitleFromText(text, maxLen = 16)` 函数。

### 12. `expandedHeight` 死变量 + 空转 resize 监听器

- **文件**: `renderer.js` 第 42、59、181–185 行
- **问题**: `expandedHeight` 初始化后只会被写入，从未被读取。`window.resize` 监听器每秒数百次更新这个死变量，白做工。
- **建议**: 删除 `expandedHeight` 变量、关联的 resize 监听器、以及初始化代码（第 59 行）。

### 13. `updateCharCount()` 空函数仍在调用

- **文件**: `renderer.js` 第 154–155 行（定义）、第 112 行（调用）
- **问题**: 函数体为空，注释说 UI 已移除。但每次 `loadPageContent()` 仍调用它。
- **建议**: 删除函数定义和调用点。

### 14. 两个全局 `click` 事件监听器

- **文件**: `renderer.js` 第 390–394 行和第 485–489 行
- **问题**: 两个独立的 `document.addEventListener('click', ...)` 分别隐藏 context menu 和 pages menu。每次点击触发两个回调。
- **建议**: 合并为一个 click 处理器。

### 15. Checklist 复选框使用行号索引，文本变化后错位

- **文件**: `renderer.js` 第 313–330 行
- **问题**: `data-line-index` 在渲染时记录行号。如果在预览点击前文本发生变更（如编辑模式下插入/删除了行），点击复选框会切换错误行的状态。
- **建议**: 在每个渲染周期中即时 re-render 预览，或使用基于内容的标识符而非位置索引。

---

## 🟢 低优先级（CSS / 可维护性 / 可访问性）

### 16. 6 个主题块 84 行 CSS 高度重复

- **文件**: `style.css` 第 44–127 行
- **问题**: 6 个 `body.theme-{color}` 块定义完全相同的一系列 CSS 变量，但 11 个变量中仅 3 个（`--bg-color`、`--accent-color`、`--checkbox-checked-bg`）因主题而异。其余 8 个完全一致。
- **建议**: 将公共变量提取到 `body` 规则中，每个主题块只保留 3 个差异化变量。可将 84 行缩减为约 30 行。

### 17. `backdrop-filter` 顺序错误（5 处）

- **文件**: `style.css` 第 137、519、581、629、768 行
- **问题**: 标准属性 `backdrop-filter` 在厂商前缀 `-webkit-backdrop-filter` 之前，应反过来：前缀属性应在标准属性之前。
- **建议**: 5 处均交换两行顺序。

### 18. 死代码

- **文件**: `main.js`
  - 第 14 行：1.5KB `base64Icon` 常量（注释注明"retained for reference"）
  - 第 6 行：被注释的 `app.disableHardwareAcceleration()`
  - 第 238–247 行：macOS-only `activate` 事件处理器（应用为 Windows-only）
- **建议**: 删除无用的死代码。

### 19. 零 ARIA 属性

- **文件**: `renderer.js` + `index.html`
- **问题**: 整个应用没有 ARIA 属性。屏幕阅读器无法识别交互元素、状态和用途。
- **建议**: 添加必要的 `role`、`aria-label`、`aria-expanded`、`aria-checked` 等属性。

### 20. 表单控件无 `<label>`

- **文件**: `index.html` 第 47、49 行
- **问题**: `memoTitleInput` 和 `memoTextarea` 缺少关联的 `<label>` 元素。placeholder 不能替代 label。
- **建议**: 添加 `<label for="memoTitleInput">` 和 `<label for="memoTextarea">`，或使用 `aria-label`。

### 21. Checkbox 预览模式不支持键盘

- **文件**: `renderer.js` 第 298–310 行
- **问题**: 预览模式中的复选框是 `<span>`，无 `tabindex`、无 `keydown` 处理。键盘用户无法在预览模式下切换复选框。
- **建议**: 添加 `tabindex="0"`、`role="checkbox"`、Space/Enter 事件处理。

### 22. `!important` 滥用

- **文件**: `style.css` 第 244–246 行和第 250–252 行
- **问题**: 6 处 `!important`，无明显必要。破坏 CSS 级联。
- **建议**: 移除 `!important`，或注释说明为什么需要。

### 23. `font-weight: 900` 超出 Outfit 加载范围

- **文件**: `style.css` 第 421 行
- **问题**: Outfit 仅加载 `font-weight: 300 600`（见 `fonts.css`），`font-weight: 900` 会 fallback。
- **建议**: 使用 `font-weight: 600`。

### 24. `textContent` 快照方式获取子菜单

- **文件**: `renderer.js` 第 17 行
- **问题**: `const submenuItems = themeSubmenu.querySelectorAll('.submenu-item')` 在模块加载时捕获静态 NodeList。如果子菜单 DOM 动态重建，该变量指向已脱离 DOM 的节点。
- **建议**: 在 `applyTheme` 内部重新查询，或接受当前行为并添加注释说明为静态 DOM。

---

## 建议重点修复（前 5 个）

1. **统一持久化层** — 内存缓存替代实时 `readFileSync`，单路径写磁盘
2. **补救 `close-window` 空页检查** — 修复 `(page.title || page)` 短路 bug
3. **关闭前刷新保存** — 关闭窗口前 `clearTimeout` + 立即持久化
4. **全量 IPC try/catch** — 所有 `await electronAPI.xxx()` 包 try/catch
5. **JSON 写入做原子替换** — 先写 `.tmp` 再 `rename`，崩溃不丢数据
