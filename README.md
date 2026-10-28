<div align="center">

<img src="src-tauri/icons/128x128.png" width="92" alt="MiaoMemo 图标"/>

# MiaoMemo · 喵喵便签

**极简风格的 Windows 桌面悬浮亚克力便签**

*轻、快、安静 —— 写完即走，无需保存。*

<img src="docs/assets/banner.svg" width="840" alt="MiaoMemo 横幅"/>

[![Version](https://img.shields.io/badge/version-1.0.1-8B5CF6?labelColor=2E1065)](https://github.com/miaomemo/miaomemo/releases/latest) [![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black&labelColor=1C1917)](https://v2.tauri.app/) [![Rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=black&labelColor=1C1917)](src-tauri/) [![Windows 10+](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows&logoColor=white&labelColor=1C1917)](https://www.microsoft.com/windows) [![License](https://img.shields.io/badge/license-MIT-10B981?labelColor=064E3B)](LICENSE)

</div>

---

## ✨ 特性

| | |
|---|---|
| 🪟 **悬浮亚克力便签** | 无边框半透明窗口，自由摆放桌面；图钉一键置顶，按住顶部拖拽条移动 |
| ☑️ **Markdown 任务清单** | 输入 `- [ ] ` 自动渲染圆角复选框，预览中点击即勾选；支持粗体、斜体、标题、多级列表 |
| 🗂️ **多页便签** | 一张便签多个页面，页码指示 + 跳转菜单，翻页不丢字 |
| 🎨 **六套浅色主题** | 经典白 · 暖阳黄 · 蜜桃粉 · 晴空蓝 · 薄荷绿 · 薰衣紫，右键即换 |
| 💾 **写完即存的自动保存** | 每次输入实时提交到 Rust 后端，250ms 防抖 + 原子写入；关闭、退出前同步刷盘，不丢最后一段输入 |
| 🛡️ **数据韧性** | 损坏自动备份、重复 id 自修复、`schemaVersion` 版本管理、数据库不可写时只读保护 |
| ⌨️ **完整的键盘支持** | 菜单、对话框、复选框全程键盘可达；中文输入法组合不被打断 |
| 🧰 **单实例 + 托盘** | 重复启动自动唤起已有便签；托盘新建 / 显示全部 / 退出 |

<div align="center">

## 📸 一览

<img src="docs/assets/hero.png" width="760" alt="MiaoMemo 便签截图"/>

<img src="docs/assets/themes.png" width="760" alt="六套主题"/>

*以上均为应用真实渲染截图。*

</div>

## 🚀 安装

1. 前往 [**Releases**](https://github.com/miaomemo/miaomemo/releases/latest) 下载 `MiaoMemo_x.x.x_x64-setup.exe`。
2. 双击安装（当前用户级，无需管理员）。Windows 10/11 一般已内置 WebView2；如缺失，安装器会自动联网安装运行时。
3. 启动后桌面出现欢迎便签，右下角托盘图标可随时新建。

> 📴 **无网络环境？** 使用离线安装包（内嵌完整 WebView2 运行时，约 200 MB）：
> `npm run build:offline` 自行构建，或查看 Release 附件中的 `offline` 变体。

## 🛠️ 从源码构建

| 环境 | 要求 |
|---|---|
| 操作系统 | Windows 10 / 11 |
| Node.js | 20+（含 npm） |
| Rust | stable，MSVC toolchain |
| 构建工具 | Visual Studio Build Tools（“使用 C++ 的桌面开发”工作负载） |

```bash
git clone https://github.com/miaomemo/miaomemo.git
cd miaomemo
npm install

npm run dev        # 开发模式
npm test           # JS 5 组 + Rust 38 项单元测试
npm run build      # 打包 NSIS 安装包（自动校验三清单版本一致）
```

安装包产出：`src-tauri/target/release/bundle/nsis/MiaoMemo_x.x.x_x64-setup.exe`

## ⌨️ 操作速查

**窗口**

| 操作 | 效果 |
|---|---|
| 按住顶部拖拽条 | 移动便签 |
| 📌 图钉 | 切换始终置顶 |
| 右上 × | 关闭确认（关闭窗口 / 退出应用；空白便签自动清理） |
| 托盘图标 | 菜单：新建 / 显示所有 / 退出；双击 = 新建 |

**编辑器**

| 按键 | 行为 |
|---|---|
| <kbd>Enter</kbd> | 清单续行；**空列表项**上按 = 退出清单 |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | 任务项内换行，不新增条目 |
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | 列表行缩进 / 减缩进（最多三层） |
| 点击预览中的复选框 | 勾选 / 取消任务，自动保存 |
| 编辑态点击 `[ ]` 方括号 | 同样可切换勾选 |
| 右键 / <kbd>Menu</kbd> / <kbd>Shift</kbd>+<kbd>F10</kbd> | 便签菜单：新建、更换主题、删除 |

## 💾 数据与隐私

便签只保存在**你自己的电脑上**，没有任何网络上传：

```text
%APPDATA%\com.miaomemo.desktop\notes.json
```

<details>
<summary><b>备份、迁移与数据格式（点开查看）</b></summary>

- **损坏恢复**：JSON 解析失败时，原文件先备份为 `notes.json.corrupt-<时间戳>.bak`（最多保留 10 份，仅清理应用自己创建的备份），再以空库恢复启动。
- **旧版迁移**：首次启动会自动尝试导入 Electron 旧版数据（`%APPDATA%\MiaoMemo\notes.json` / `%APPDATA%\miao-memo\notes.json`）。
- **重复 id 修复**：加载时发现重复便签 id 会自动去重（首条保留、其余重新生成），修复前先备份。
- **版本管理**：文件顶层携带 `schemaVersion`（当前为 `1`）；旧文件自动升级，**更高版本的数据文件不会被降级覆盖**，应用将以只读模式提示。
- **测试隔离**：`MIAOMEMO_DATA_DIR` 环境变量或 `--user-data-dir=` 参数可重定向数据目录。

当前格式示例：

```json
{
  "schemaVersion": 1,
  "notes": [
    {
      "id": "note-new",
      "pages": [{ "title": "标题", "content": "- [ ] 任务" }],
      "currentPageIndex": 0,
      "color": "yellow",
      "x": 120.0, "y": 90.0,
      "width": 300.0, "height": 350.0,
      "isPinned": false
    }
  ]
}
```

> 该示例被 Rust 单元测试钉住——文档与实际加载行为不一致时 `npm test` 会失败。

</details>

<details>
<summary><b>发布与签名说明（点开查看）</b></summary>

- **WebView2 运行时**：默认安装包使用 `embedBootstrapper` 模式；目标机器缺失运行时且无网络时，引导器会**弹窗中止安装**（不会静默装出不可用的应用）。离线安装请用 `npm run build:offline`（`offlineInstaller` 变体）。
- **安装器语言**：简体中文 + English，带语言选择页。
- **版本一致性**：`package.json` / `tauri.conf.json` / `Cargo.toml` 三处版本由 `scripts/check-versions.mjs` 在构建前强制校验。
- **签名与更新**：当前产物**未做代码签名**，SmartScreen 可能提示“未知发布者”，选择“仍要运行”即可；应用**没有内置自动更新器**。未来若引入更新通道，更新元数据与载荷必须先验证签名。

</details>

## 🗺️ 路线图

规划以 [OpenSpec](openspec/) 变更票据管理（spec → design → tasks → 验证）：

- ✅ **P0 数据安全** · ✅ **P1 稳定性与交互** · ✅ **P2 编辑器与边界**（已交付）
- 🔜 优化 backlog：保存协议瘦身、窗口管理重构、便签管理面板、深色模式、CI 质量门禁 —— 见 [`backlog-optimizations`](openspec/changes/backlog-optimizations/)

## 🤝 贡献

欢迎 Issue 与 PR！请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；提交前请确保 `npm test` 通过，手工 GUI 改动请在隔离数据目录按 [`tests/MANUAL.md`](tests/MANUAL.md) 回归并核对磁盘 `notes.json`。

## 📄 License

[MIT](LICENSE) © MiaoMemo contributors

---

<div align="center">

**MiaoMemo** · 为专注而生的桌面便签 🐾

<sub>若对你有帮助，欢迎点一个 ⭐</sub>

</div>
