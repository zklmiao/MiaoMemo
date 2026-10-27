// 原子写 + 损坏备份真模块测试：直测 dbStore.js（非复刻）
// 运行: node tests/test-atomic-persist.js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { atomicWriteFileSync, loadDBFromDisk, cleanupStaleTmp } = require('../dbStore');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miaomemo-test-'));
const dbPath = path.join(tmpDir, 'notes.json');
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

// 1. 不存在返回空库且不建文件
check('不存在返回空库', () => {
  const db = loadDBFromDisk(dbPath);
  assert.deepStrictEqual(db, { notes: [] });
  assert.strictEqual(fs.existsSync(dbPath), false);
});

// 2. 原子写不留 .tmp 且内容完整
check('原子写无残留tmp', () => {
  atomicWriteFileSync(dbPath, JSON.stringify({ notes: [{ id: 'a' }] }, null, 2));
  assert.strictEqual(fs.existsSync(dbPath + '.tmp'), false);
  const read = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  assert.strictEqual(read.notes[0].id, 'a');
});

// 3. JSON 语法损坏：备份后返回空库，且 load 阶段不覆盖原文件
check('损坏JSON备份后返回空库', () => {
  fs.writeFileSync(dbPath, '{corrupted!!!', 'utf8');
  const before = fs.readFileSync(dbPath, 'utf8');
  const db = loadDBFromDisk(dbPath);
  assert.deepStrictEqual(db, { notes: [] });
  const baks = fs.readdirSync(tmpDir).filter(f => f.startsWith('notes.json.corrupt-') && f.endsWith('.bak'));
  assert.ok(baks.length >= 1, '备份文件必须存在');
  const backed = fs.readFileSync(path.join(tmpDir, baks[baks.length - 1]), 'utf8');
  assert.strictEqual(backed, before, '备份内容必须等于损坏原文');
  const still = fs.readFileSync(dbPath, 'utf8');
  assert.strictEqual(still, before, 'load 不得覆盖原损坏文件');
});

// 4. 结构损坏（合法 JSON 但 notes 非数组）：同样备份返回空库
check('结构损坏同样备份', () => {
  fs.writeFileSync(dbPath, JSON.stringify({ notes: { broken: true } }), 'utf8');
  const before = fs.readFileSync(dbPath, 'utf8');
  const countBefore = fs.readdirSync(tmpDir).filter(f => f.includes('.corrupt-')).length;
  const db = loadDBFromDisk(dbPath);
  assert.deepStrictEqual(db, { notes: [] });
  const countAfter = fs.readdirSync(tmpDir).filter(f => f.includes('.corrupt-')).length;
  assert.ok(countAfter > countBefore, '结构损坏必须产生新备份');
  const baks = fs.readdirSync(tmpDir).filter(f => f.startsWith('notes.json.corrupt-')).sort();
  const backed = fs.readFileSync(path.join(tmpDir, baks[baks.length - 1]), 'utf8');
  assert.strictEqual(backed, before, '结构损坏备份内容必须等于原文');
});

// 5. tmp 残留清理：主文件完好时删 tmp
check('cleanupStaleTmp删除残留tmp', () => {
  atomicWriteFileSync(dbPath, JSON.stringify({ notes: [{ id: 'ok' }] }));
  fs.writeFileSync(dbPath + '.tmp', 'half-written', 'utf8');
  cleanupStaleTmp(dbPath);
  assert.strictEqual(fs.existsSync(dbPath + '.tmp'), false);
  const read = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  assert.strictEqual(read.notes[0].id, 'ok');
});

fs.rmSync(tmpDir, { recursive: true, force: true });

if (failed > 0) {
  console.error(`\n${failed} 个断言失败`);
  process.exit(1);
}
console.log('\n全部通过');
