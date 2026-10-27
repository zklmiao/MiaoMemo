// extractTitleFromText + makeNoteId 真模块测试：直测 noteUtils.js
// 与 Rust 侧 store.rs::extract_title_from_text 共用同一组用例（保持对齐）。
// 运行: node tests/test-title-extract.js
const assert = require('node:assert');
const { extractTitleFromText, makeNoteId } = require('../src/noteUtils');

const cases = [
  { name: '空返回空', input: '', expect: '' },
  { name: 'null返回空', input: null, expect: '' },
  { name: '取首行', input: 'hello\nworld', expect: 'hello' },
  { name: '去标题标记', input: '# 欢迎使用', expect: '欢迎使用' },
  { name: '二级标题', input: '## 二级标题', expect: '二级标题' },
  { name: '截断16', input: '12345678901234567890', expect: '1234567890123456' },
  { name: '仅符号行变空', input: '---', expect: '' },
  { name: '三星分隔线变空', input: '***', expect: '' },
  { name: '前后空格', input: '  hi  ', expect: 'hi' },
  // --- 日期/连字符保留（P2 修复点）---
  { name: '日期连字符保留', input: '2026-10-27 会议记录', expect: '2026-10-27 会议记录' },
  { name: '连字符词保留', input: 'co-op 项目', expect: 'co-op 项目' },
  // --- 剥离更多前置标记 ---
  { name: '剥离三重强调', input: '***重要***', expect: '重要' },
  { name: '剥离列表与复选框', input: '- [ ] 买牛奶', expect: '买牛奶' },
  { name: '剥离列表标记', input: '- 项目', expect: '项目' },
  { name: '剥离行内代码反引号', input: '`代码`', expect: '代码' },
  // 正文中间的连字符/星号不受影响
  { name: '中间标记保留', input: 'A-B *C* 测试', expect: 'A-B *C* 测试' },
];

let failed = 0;
for (const c of cases) {
  const got = extractTitleFromText(c.input);
  try {
    assert.strictEqual(got, c.expect);
    console.log(`PASS: ${c.name}`);
  } catch {
    failed++;
    console.error(`FAIL: ${c.name} expect=${JSON.stringify(c.expect)} got=${JSON.stringify(got)}`);
  }
}

// id 唯一性：连产 5000 个不得碰撞（旧 Date.now() 在同毫秒必碰撞）
try {
  const ids = new Set();
  for (let i = 0; i < 5000; i++) {
    ids.add(makeNoteId());
  }
  assert.strictEqual(ids.size, 5000, 'id 必须唯一');
  console.log('PASS: id 5000 连产无碰撞');
} catch (e) {
  failed++;
  console.error('FAIL: id 唯一性: ' + e.message);
}

if (failed > 0) {
  console.error(`\n${failed} 个断言失败`);
  process.exit(1);
}
console.log('\n全部通过');
