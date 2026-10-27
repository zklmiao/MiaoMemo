// isNoteEmpty 真模块回归测试：直测 noteUtils.js（非复刻），避免源码漂移时虚假 pass。
// 运行: node tests/test-empty-check.js  (exit 0 = 全过, 非0 = 有失败)
const assert = require('node:assert');
const { isNoteEmpty } = require('../src/noteUtils');

const cases = [
  { name: '空对象页应判空', note: { pages: [{ title: '', content: '' }] }, expect: true },
  { name: '空白字符串应判空', note: { pages: [{ title: '   ', content: ' \n ' }] }, expect: true },
  { name: '多空页应判空', note: { pages: [{ title: '', content: '' }, { title: '', content: '' }] }, expect: true },
  { name: '有标题不应判空', note: { pages: [{ title: 'x', content: '' }] }, expect: false },
  { name: '有内容不应判空', note: { pages: [{ title: '', content: 'hello' }] }, expect: false },
  { name: '一空一有不应判空', note: { pages: [{ title: '', content: '' }, { title: 't', content: 'c' }] }, expect: false },
  { name: '无pages应判空', note: { pages: [] }, expect: true },
  { name: 'null应判空', note: null, expect: true },
  { name: '字符串空页应判空', note: { pages: ['   '] }, expect: true },
  { name: '字符串有内容不应判空', note: { pages: ['hello'] }, expect: false },
];

let failed = 0;
for (const c of cases) {
  const got = isNoteEmpty(c.note);
  try {
    assert.strictEqual(got, c.expect);
    console.log(`PASS: ${c.name}`);
  } catch {
    failed++;
    console.error(`FAIL: ${c.name} expect=${c.expect} got=${got}`);
  }
}

// 负对照：旧 buggy 逻辑在首个用例上必须为 false，证明本测试能抓到历史 bug。
// 若负对照失效（旧逻辑也返回 true），说明用例本身无法证伪，记为测试失败。
function isNoteEmptyOldBuggy(note) {
  if (!note || !note.pages) return true;
  return note.pages.every(page => {
    const title = ((page.title || page) || '').toString().trim();
    const content = ((page.content || page) || '').toString().trim();
    return title === '' && content === '';
  });
}
const oldGot = isNoteEmptyOldBuggy({ pages: [{ title: '', content: '' }] });
if (oldGot === false) {
  console.log('PASS: 负对照生效（旧bug逻辑确实判非空，测试有效）');
} else {
  failed++;
  console.error('FAIL: 负对照失效，旧逻辑竟返回空，测试无法证伪');
}

// 正对照：真模块必须与复刻语义一致（抽查源码确被加载，而非空壳）
try {
  assert.strictEqual(typeof isNoteEmpty, 'function');
  assert.strictEqual(isNoteEmpty({ pages: ['hello'] }), false, '真模块应可执行');
  console.log('PASS: 真模块加载对照（noteUtils 已实际加载）');
} catch (e) {
  failed++;
  console.error('FAIL: 真模块加载对照: ' + e.message);
}

if (failed > 0) {
  console.error(`\n${failed} 个断言失败`);
  process.exit(1);
}
console.log('\n全部通过');
