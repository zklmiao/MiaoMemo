// 纯函数模块：便签判空 / 标题提取 / 行内 Markdown / id 生成 / 默认便签。
// UMD：Rust 迁移后仍由 renderer 经 <script> 以 window.NoteUtils 使用，JS 测试直接 require。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.NoteUtils = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_NOTE_WIDTH = 300;
  const DEFAULT_NOTE_HEIGHT = 350;

  // 标题提取：只剥离开头的 Markdown 标记（标题 #、列表 -、复选框、强调 * _ `），
  // 保留日期/连字符词内部的 `-`（如 `2026-10-27 会议记录`）。
  // 整行仅由 Markdown 符号构成（如 `---`、`***`）视为无标题。
  // Rust 侧 src-tauri/src/store.rs::extract_title_from_text 与本实现逐例对齐，
  // 共享用例见 tests/test-title-extract.js 与 store.rs 测试。
  function extractTitleFromText(text, maxLen = 16) {
    if (!text) return '';
    const line = String(text).trim().split('\n')[0].trim();
    if (!line) return '';
    // 整行只有符号/空白 → 无有效标题
    if (!/[^\s#*`_\-]/.test(line)) return '';
    let s = line;
    for (let i = 0; i < 3; i += 1) {
      const next = s
        .replace(/^#+\s*/, '')       // ATX 标题
        .replace(/^[-*+]\s+/, '')    // 列表项
        .replace(/^\[[ xX]\]\s*/, '') // 待办复选框
        .replace(/^[*_`]+/, '')      // 前置强调/反引号
        .replace(/[\s*_`]+$/, '');   // 后置强调/空白
      if (next === s) break;
      s = next;
    }
    return s.trim().substring(0, maxLen);
  }

  function isNoteEmpty(note) {
    if (!note || !Array.isArray(note.pages) || note.pages.length === 0) {
      return true;
    }
    return note.pages.every((page) => {
      if (typeof page === 'string') {
        return page.trim() === '';
      }
      const title = (page.title || '').trim();
      const content = (page.content || '').trim();
      return title === '' && content === '';
    });
  }

  // Date.now() 同一毫秒可碰撞（如托盘双击连点），加随机后缀保证唯一。
  function makeNoteId() {
    return 'note-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  function createDefaultNote(id, pos) {
    return {
      id,
      pages: [{ title: '', content: '' }],
      currentPageIndex: 0,
      color: 'white',
      x: pos.x,
      y: pos.y,
      width: DEFAULT_NOTE_WIDTH,
      height: DEFAULT_NOTE_HEIGHT,
      isPinned: false
    };
  }

  // 页面动作串行化状态机：双击/连点时只有一个动作在执行。
  function createPageActionGuard() {
    let busy = false;
    return {
      get busy() {
        return busy;
      },
      begin() {
        if (busy) return false;
        busy = true;
        return true;
      },
      end() {
        busy = false;
      }
    };
  }

  // --- 行内 Markdown（粗体/斜体）---------------------------------------------
  //
  // 语法刻意保持很小：只处理 1..3 个连续 `*` 构成的强调；超过 3 个的星号串
  // 保持原样。一个 run 要么作为闭合标记（从最内层开始逐层关闭，且必须被完全
  // 消耗），要么作为开始标记；未闭合的开始标记在扫描结束后回退为字面文本。
  // 与旧的正则级联相比，`***text***` 产出的标签是平衡嵌套的。

  const EMPHASIS_OPEN = { 1: '<em>', 2: '<strong>', 3: '<strong><em>' };
  const EMPHASIS_CLOSE = { 1: '</em>', 2: '</strong>', 3: '</em></strong>' };

  function escapeHtml(unsafe) {
    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 尝试以 runLen 个 `*` 关闭栈顶的强调层；只有 run 被“恰好用尽”时才成功。
  // 返回要输出的闭合标签，失败返回 null（调用方按字面文本处理）。
  function closeEmphasisFrames(open, runLen) {
    let remaining = runLen;
    let depth = 0;
    while (depth < open.length && open[open.length - 1 - depth].stars <= remaining) {
      remaining -= open[open.length - 1 - depth].stars;
      depth += 1;
    }
    if (depth === 0 || remaining !== 0) return null;
    let html = '';
    for (let k = 0; k < depth; k += 1) {
      html += EMPHASIS_CLOSE[open.pop().stars];
    }
    return html;
  }

  function renderEmphasis(escaped) {
    let out = '';
    const open = []; // { stars, pos, tags }
    let i = 0;
    while (i < escaped.length) {
      if (escaped[i] !== '*') {
        out += escaped[i];
        i += 1;
        continue;
      }
      let j = i;
      while (j < escaped.length && escaped[j] === '*') j += 1;
      const runLen = j - i;
      if (runLen <= 3) {
        const closed = closeEmphasisFrames(open, runLen);
        if (closed !== null) {
          out += closed;
        } else {
          open.push({ stars: runLen, pos: out.length, tags: EMPHASIS_OPEN[runLen] });
          out += EMPHASIS_OPEN[runLen];
        }
      } else {
        out += escaped.slice(i, j); // >3 个星号不参与语法，保持字面
      }
      i = j;
    }
    // 未闭合的强调层回退为字面星号（从后向前 splice，位置才不失效）。
    for (let k = open.length - 1; k >= 0; k -= 1) {
      const frame = open[k];
      out = out.slice(0, frame.pos) + '*'.repeat(frame.stars) + out.slice(frame.pos + frame.tags.length);
    }
    return out;
  }

  function parseMarkdownInline(text) {
    return renderEmphasis(escapeHtml(text));
  }

  return {
    DEFAULT_NOTE_WIDTH,
    DEFAULT_NOTE_HEIGHT,
    extractTitleFromText,
    isNoteEmpty,
    makeNoteId,
    createDefaultNote,
    createPageActionGuard,
    escapeHtml,
    parseMarkdownInline
  };
}));
