# MiaoMemo (喵喵便签)

<p align="center">
  <img src="screenshot.png" alt="MiaoMemo Screenshot" width="600">
</p>

> A minimalist translucent glassmorphism sticky notes app for Windows, built with Tauri 2, Rust and WebView2.

MiaoMemo 是一款专为 Windows 设计的极简风格桌面悬浮便签。它采用半透明玻璃拟态外观，支持多页翻页、Markdown 实时渲染以及可交互的圆角复选框清单。

**Key Features:** Translucent glassmorphism design · 6 color themes · Markdown live preview · Interactive checklists · Multi-level unordered lists · Multi-page notes · Always-on-top pinning · System tray integration · Auto-save with debounced disk writes · Single-instance protection.

---

## 🗒️ 功能特性

*   **极简半透明美学**：透明 WebView2 窗口搭配半透明 CSS 材质与噪点纹理，贴合现代桌面审美。
*   **多主题切换**：支持 **经典白**、**暖阳黄**、**蜜桃粉**、**晴空蓝**、**薄荷绿**、**薰衣紫** 六种色彩，在便签区域内右键即可切换。
*   **智能双模交互**：
    *   **编辑模式**：点击文本框直接输入，支持 Markdown 语法。
    *   **预览模式**：失焦后自动渲染标题、粗体、斜体、列表和复选框。
*   **可交互复选框**：预览模式下点击圆角复选框即可切换 `- [ ]` / `- [x]`，无需进入编辑状态。
*   **多级无序列表**：支持 `-`、`*`、`+`，按缩进识别最多 3 级嵌套。
*   **多页卡片**：每个便签支持新建、删除、翻页，以及点击页码弹出页面列表跳转。
*   **始终置顶 📌**：点击图钉锁定便签在最上层。
*   **系统托盘**：双击托盘新建便签；右键支持新建、显示所有、退出。
*   **数据安全**：内存缓存 + 250ms 防抖落盘 + 原子写（tmp→rename）+ 损坏 JSON 备份；关闭/退出时同步刷盘。
*   **单实例保护**：重复启动会聚焦已有实例，避免两个进程互相覆盖 `notes.json`。
*   **旧数据迁移**：首次启动自动导入旧 Electron 版本的 `notes.json`。

---

## 🛠️ 技术栈

*   **Tauri 2** + **Rust**：窗口、托盘、单实例、持久化和 IPC。
*   **Vanilla HTML / CSS / JavaScript**：`src/` 下的静态前端，无打包器、无前端运行时依赖。
*   **WebView2**：Windows 上的 WebView 运行时。
*   **Serde / serde_json**：`notes.json` 序列化与容错迁移。
*   **Pillow**：生成 `src-tauri/icons/` 图标资源。

---

## 📁 项目结构

```bash
MiaoMemo/
├── src/                    # Frontend: HTML/CSS/JS served by Tauri
│   ├── index.html
│   ├── style.css
│   ├── renderer.js         # Note UI, Markdown preview, pages, menus
│   ├── api.js              # Tauri IPC adapter (window.memoAPI)
│   ├── noteUtils.js        # UMD helpers shared with JS tests
│   ├── fonts.css
│   └── fonts/              # Local Outfit woff2 files
├── src-tauri/              # Rust backend
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   ├── icons/              # Generated Tauri icon set
│   └── src/
│       ├── main.rs         # Windows, tray, commands, single instance
│       └── store.rs        # Persistence, debounce, migration + Rust tests
├── tests/                  # JS unit tests + manual GUI checklist
├── generate_icons.py       # Regenerate src-tauri/icons from icon.ico
├── icon.ico                # Source app icon
├── screenshot.png
└── package.json            # Tauri CLI scripts & JS tests
```

---

## 🚀 快速开始

### 运行环境

*   Windows 10/11（需要 WebView2 Runtime；Windows 11 通常已预装）
*   [Node.js](https://nodejs.org/) 20+
*   Rust stable（MSVC toolchain）
*   Visual Studio Build Tools（“Desktop development with C++” 工作负载）

### 1. 安装依赖

```bash
npm install
```

### 2. 开发模式

```bash
npm run dev
# 或
npm start
```

### 3. 打包

```bash
npm run build
```

打包成功后，NSIS 安装包位于：

```text
src-tauri/target/release/bundle/nsis/MiaoMemo_1.0.1_x64-setup.exe
```


### 4. 测试

```bash
npm test              # JS 单元测试 + Rust 单元测试
npm run test:js       # 仅 JS（noteUtils）
npm run test:rust     # 仅 Rust（store/persistence）
```

手工 GUI 回归清单见 [`tests/MANUAL.md`](tests/MANUAL.md)。

### 5. 重新生成图标

修改 `icon.ico` 后执行：

```bash
npm run icons
# 等价于 python generate_icons.py
```

---

## 💾 数据位置与迁移

Windows 上数据默认位于：

```text
%APPDATA%\com.miaomemo.desktop\notes.json
```

首次启动时，如果目标文件不存在，会自动尝试导入旧 Electron 版本的数据：

```text
%APPDATA%\MiaoMemo\notes.json
%APPDATA%\miao-memo\notes.json
```

测试或便携使用时可以用环境变量覆盖数据目录：

```powershell
$env:MIAOMEMO_DATA_DIR = "$env:TEMP\miaomemo-test"
npm run dev
```

也支持命令行参数：

```text
miao-memo.exe --user-data-dir="D:\miaomemo-data"
```

---

## ⌨️ 快捷操作

*   **移动窗口**：按住顶部拖拽条（`data-tauri-drag-region` 区域）拖动。
*   **右键菜单**：便签内右键，可**新建便签**或**更换主题**。
*   **关闭便签**：右上角 × 弹出菜单，可关闭当前窗口（保留数据）或退出应用；空白便签关闭时自动清理。
*   **删除单页**：底部垃圾桶图标，确认后仅删除当前页。
*   **翻页/跳页**：底部左右箭头翻页；点击页码弹出页面列表。

---

## License

MIT © [MiaoMemo](https://github.com/miaomemo/miaomemo)
