const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// 自动发现 tests/test-*.js，避免新增测试文件被硬编码列表漏跑（虚假 pass 风险）。
const tests = fs
  .readdirSync(__dirname)
  .filter((name) => /^test-.*\.js$/.test(name))
  .sort();

if (tests.length === 0) {
  console.error('未发现任何 tests/test-*.js 测试文件');
  process.exit(1);
}

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
