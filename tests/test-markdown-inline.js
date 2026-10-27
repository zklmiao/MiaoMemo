// parseMarkdownInline 真模块测试：直测 noteUtils.js 的行内强调扫描器。
// 覆盖：三重强调、混合强调、嵌套、未配对标记、长 run、HTML 转义。
// 运行: node tests/test-markdown-inline.js
const assert = require('node:assert');
const { parseMarkdownInline, escapeHtml } = require('../src/noteUtils');

const cases = [
  // 三重强调：平衡嵌套，无裸星号
  { name: '三重强调', input: '***important***', expect: '<strong><em>important</em></strong>' },
  // 混合强调：同行独立 span
  { name: '同行粗体+斜体', input: '**bold** and *italic*', expect: '<strong>bold</strong> and <em>italic</em>' },
  // 粗体内嵌斜体（闭合 run 跨层消耗）
  { name: '粗体嵌套斜体', input: '**bold and *italic***', expect: '<strong>bold and <em>italic</em></strong>' },
  // 斜体内嵌粗体
  { name: '斜体嵌套粗体', input: '*outer **inner** outer*', expect: '<em>outer <strong>inner</strong> outer</em>' },
  // 未配对：保持字面
  { name: '未配对双星', input: '**abc', expect: '**abc' },
  { name: '未配对单星', input: 'a *b', expect: 'a *b' },
  // 内层闭合成功，外层 opener 回退为字面（标签仍平衡）
  { name: '仅内层闭合', input: '**a *b*', expect: '**a <em>b</em>' },
  // 闭合 run 无法被完全消耗（1 星关不动 2 星的 strong）→ 整个 run 字面，opener 全部回退
  { name: '闭合run跨层不足', input: '**a *b**', expect: '**a *b**' },
  // 普通成对
  { name: '成对粗体', input: '**bold**', expect: '<strong>bold</strong>' },
  { name: '成对斜体', input: '*italic*', expect: '<em>italic</em>' },
  // 超过 3 个星号的 run 不参与语法
  { name: '四星保持字面', input: '****x****', expect: '****x****' },
  // HTML 先转义，标签不生效
  { name: 'HTML转义', input: '<script>alert(1)</script>', expect: '&lt;script&gt;alert(1)&lt;/script&gt;' },
  { name: '属性转义', input: 'a"b\'c&d', expect: 'a&quot;b&#039;c&amp;d' },
  // 空串
  { name: '空串', input: '', expect: '' },
];

let failed = 0;
for (const c of cases) {
  try {
    assert.strictEqual(parseMarkdownInline(c.input), c.expect);
    console.log(`PASS: ${c.name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL: ${c.name}\n  expect=${JSON.stringify(c.expect)}\n  got=${JSON.stringify(e.actual)}`);
  }
}

// 回归（任务 1.3）：粗体与斜体同行的输出不得含裸星号、不得有未配对标签
try {
  const mixed = parseMarkdownInline('**加粗** 与 *倾斜* 以及 ***两者***');
  const expected = '<strong>加粗</strong> 与 <em>倾斜</em> 以及 <strong><em>两者</em></strong>';
  assert.strictEqual(mixed, expected);
  assert.ok(!mixed.includes('*'), '输出不得残留裸星号');
  const opens = (mixed.match(/<(strong|em)>/g) || []).length;
  const closes = (mixed.match(/<\/(strong|em)>/g) || []).length;
  assert.strictEqual(opens, closes, '开合标签数量必须相等');
  console.log('PASS: 混合强调回归（无裸星号、标签平衡）');
} catch (e) {
  failed++;
  console.error(`FAIL: 混合强调回归: ${e.message}`);
}

// escapeHtml 导出自检（renderer 降级路径也依赖同一实现）
try {
  assert.strictEqual(escapeHtml('<b>'), '&lt;b&gt;');
  console.log('PASS: escapeHtml 导出');
} catch (e) {
  failed++;
  console.error(`FAIL: escapeHtml 导出: ${e.message}`);
}

if (failed > 0) {
  console.error(`\n${failed} 个断言失败`);
  process.exit(1);
}
console.log('\n全部通过');
