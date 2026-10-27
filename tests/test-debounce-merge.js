// 跨便签防抖真模块测试：直测 dbStore.createMemoryStore（main.js 同款逻辑）
// 旧“单timer+读旧盘”只作负对照，证明本测试能复现 D1；新逻辑走真实模块。
// 运行: node tests/test-debounce-merge.js
const assert = require('node:assert');
const { createMemoryStore } = require('../dbStore');

// --- 旧逻辑模拟（修复前 main.js 语义），仅负对照 ---
function simulateOld() {
  return new Promise((resolve) => {
    let disk = { notes: [{ id: 'A', content: 'a0' }, { id: 'B', content: 'b0' }] };
    let timer = null;
    function oldUpdate(id, content) {
      if (timer) clearTimeout(timer);
      const snapshot = JSON.parse(JSON.stringify(disk)); // 读旧盘
      const idx = snapshot.notes.findIndex(n => n.id === id);
      snapshot.notes[idx].content = content;
      timer = setTimeout(() => { disk = snapshot; }, 250);
    }
    oldUpdate('A', 'a1');
    setTimeout(() => oldUpdate('B', 'b1'), 50);
    setTimeout(() => resolve(disk), 450);
  });
}

(async () => {
  let failed = 0;

  const oldDisk = await simulateOld();
  try {
    assert.strictEqual(oldDisk.notes.find(n => n.id === 'A').content, 'a0', '旧逻辑应丢失A');
    assert.strictEqual(oldDisk.notes.find(n => n.id === 'B').content, 'b1');
    console.log('PASS: 旧逻辑确实丢失 A（复现 D1，负对照有效）');
  } catch (e) {
    failed++;
    console.error('FAIL: 旧逻辑负对照无效: ' + e.message);
  }

  // --- 新逻辑：真实 createMemoryStore + 真实落盘回调 ---
  try {
    let flushed = null;
    const store = createMemoryStore({
      load: () => ({ notes: [{ id: 'A', content: 'a0' }, { id: 'B', content: 'b0' }] }),
      delay: 250,
      onFlush: (data) => { flushed = JSON.parse(JSON.stringify(data)); }
    });
    // 模拟两便签 50ms 内各 update 一次（与负对照同时序）
    const db = store.get();
    db.notes.find(n => n.id === 'A').content = 'a1';
    store.schedule();
    await new Promise(r => setTimeout(r, 50));
    const db2 = store.get();
    db2.notes.find(n => n.id === 'B').content = 'b1';
    store.schedule();
    await new Promise(r => setTimeout(r, 350));
    assert.ok(flushed, '新逻辑应在 350ms 内刷盘');
    assert.strictEqual(flushed.notes.find(n => n.id === 'A').content, 'a1', '新逻辑必须保留 A');
    assert.strictEqual(flushed.notes.find(n => n.id === 'B').content, 'b1', '新逻辑必须保留 B');
    console.log('PASS: 真模块 A/B 均保留（D1 修复）');
  } catch (e) {
    failed++;
    console.error('FAIL: 真模块未保留双改动: ' + e.message);
  }

  // --- flushSync 语义：不脏不写（修 B5），脏才写 ---
  try {
    let writes = 0;
    const s = createMemoryStore({ load: () => ({ notes: [] }), delay: 50, onFlush: () => { writes++; } });
    s.get();
    const r1 = s.flushSync();
    assert.strictEqual(r1, false, '未加载且不脏时不得写盘');
    assert.strictEqual(writes, 0);
    s.schedule();
    const r2 = s.flushSync();
    assert.strictEqual(r2, true, '脏时应写盘');
    assert.strictEqual(writes, 1);
    console.log('PASS: flushSync 脏标记语义正确（B5 修复）');
  } catch (e) {
    failed++;
    console.error('FAIL: flushSync 语义: ' + e.message);
  }

  if (failed > 0) {
    console.error(`\n${failed} 个断言失败`);
    process.exit(1);
  }
  console.log('\n全部通过');
})();
