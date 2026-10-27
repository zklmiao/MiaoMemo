const { execFileSync } = require('node:child_process');
const path = require('node:path');

const tests = [
  'test-empty-check.js',
  'test-title-extract.js',
  'test-atomic-persist.js',
  'test-debounce-merge.js',
];

let failed = 0;
for (const t of tests) {
  console.log(`\n=== ${t} ===`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, t)], { stdio: 'inherit' });
  } catch {
    failed++;
    console.error(`--- ${t} FAILED ---`);
  }
}
if (failed > 0) {
  console.error(`\n${failed}/${tests.length} 个测试文件失败`);
  process.exit(1);
}
console.log(`\n${tests.length}/${tests.length} 个测试文件全部通过`);
