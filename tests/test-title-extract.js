// extractTitleFromText + makeNoteId 真模块测试：直测 noteUtils.js
// 运行: node tests/test-title-extract.js
const assert = require('node:assert');
const { extractTitleFromText, makeNoteId } = require('../noteUtils');

const cases = [
  { name: '空返回空', input: '', expect: '' },
  { name: 'null返回空', input: null, expect: '' },
  { name: '取首行', input: 'hello\nworld', expect: 'hello' },
  { name: '去markdown符号', input: '# 欢迎使用', expect: '欢迎使用' },
  { name: '截断16', input: '12345678901234567890', expect: '1234567890123456' },
  { name: '仅符号行变空', input: '---', expect: '' },
  { name: '前后空格', input: '  hi  ', expect: 'hi' },
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
