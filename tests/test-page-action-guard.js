// createPageActionGuard 真模块测试：串行化页面动作，防止双击/连点重复执行。
const assert = require('node:assert');
const { createPageActionGuard } = require('../src/noteUtils');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL: ${name}: ${e.message}`);
  }
}

check('begin 首次成功，重复 begin 被拒绝', () => {
  const guard = createPageActionGuard();
  assert.strictEqual(guard.busy, false);
  assert.strictEqual(guard.begin(), true);
  assert.strictEqual(guard.busy, true);
  assert.strictEqual(guard.begin(), false);
  assert.strictEqual(guard.busy, true);
});

check('end 后可再次 begin', () => {
  const guard = createPageActionGuard();
  guard.begin();
  guard.end();
  assert.strictEqual(guard.busy, false);
  assert.strictEqual(guard.begin(), true);
});

check('动作抛错后仍可通过 end 恢复', () => {
  const guard = createPageActionGuard();
  assert.strictEqual(guard.begin(), true);
  let caught = null;
  try {
    throw new Error('boom');
  } catch (e) {
    caught = e;
  } finally {
    guard.end();
  }
  assert.ok(caught, '动作错误应被调用方捕获');
  assert.strictEqual(guard.busy, false);
});

if (failed > 0) {
  console.error(`\n${failed} 个断言失败`);
  process.exit(1);
}
console.log('\n全部通过');
