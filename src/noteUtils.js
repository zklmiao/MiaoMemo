// 纯函数模块：便签判空 / 标题提取 / id 生成 / 默认便签。
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

  function extractTitleFromText(text, maxLen = 16) {
    if (!text) return '';
    const firstLine = text.trim().split('\n')[0] || '';
    return firstLine.replace(/[#*`_\-]/g, '').trim().substring(0, maxLen);
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

  return {
    DEFAULT_NOTE_WIDTH,
    DEFAULT_NOTE_HEIGHT,
    extractTitleFromText,
    isNoteEmpty,
    makeNoteId,
    createDefaultNote
  };
}));
