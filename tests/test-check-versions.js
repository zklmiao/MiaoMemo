// check-versions.mjs 真脚本测试：用临时目录构造一致/不一致的三个清单，
// 通过 `--root` 覆盖根目录运行真实脚本，验证退出码与输出（不触碰真实清单）。
// 运行: node tests/test-check-versions.js
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const SCRIPT = join(__dirname, '..', 'scripts', 'check-versions.mjs');

function writeManifests(root, version) {
  mkdirSync(join(root, 'src-tauri'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
  writeFileSync(
    join(root, 'src-tauri', 'tauri.conf.json'),
    JSON.stringify({ version })
  );
  writeFileSync(
    join(root, 'src-tauri', 'Cargo.toml'),
    `[package]\nname = "miao-memo"\nversion = "${version}"\n`
  );
}

let failed = 0;
function run(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL: ${name}: ${e.message}`);
  }
}

run('一致版本通过（exit 0）', () => {
  const root = mkdtempSync(join(tmpdir(), 'miao-check-'));
  try {
    writeManifests(root, '2.3.4');
    const out = execFileSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.ok(out.includes('ok (2.3.4)'), `stdout 应包含 ok，实际: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

run('版本不一致失败（exit 1 + 逐文件对照）', () => {
  const root = mkdtempSync(join(tmpdir(), 'miao-check-'));
  try {
    writeManifests(root, '1.0.0');
    // 故意制造不一致：tauri.conf.json 落后
    writeFileSync(join(root, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version: '0.9.0' }));
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.strictEqual(result.status, 1, '退出码必须是 1');
    assert.ok(/version mismatch/.test(result.stderr), `stderr 应说明 mismatch: ${result.stderr}`);
    assert.ok(result.stderr.includes('package.json: 1.0.0'), '应列出 package.json 版本');
    assert.ok(result.stderr.includes('tauri.conf.json: 0.9.0'), '应列出 tauri.conf.json 版本');
    assert.ok(result.stderr.includes('Cargo.toml: 1.0.0'), '应列出 Cargo.toml 版本');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

run('缺失 version 字段失败（exit 1）', () => {
  const root = mkdtempSync(join(tmpdir(), 'miao-check-'));
  try {
    writeManifests(root, '1.0.0');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x' }));
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.strictEqual(result.status, 1);
    assert.ok(/missing version/.test(result.stderr), `stderr 应说明 missing: ${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 对照：真实项目根当前必须一致（防止有人改清单忘了同步）
run('真实项目根当前一致', () => {
  const out = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.ok(/ok \(\d+\.\d+\.\d+\)/.test(out), `真实清单应通过: ${out}`);
});

if (failed > 0) {
  console.error(`\n${failed} 个断言失败`);
  process.exit(1);
}
console.log('\n全部通过');
