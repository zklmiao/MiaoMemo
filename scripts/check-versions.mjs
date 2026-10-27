#!/usr/bin/env node
// 构建前版本一致性检查（project-development 基线规则）：
// package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml 三处版本必须一致，
// 否则以非零码退出并给出清晰的逐文件对照。
// `npm run build` / `npm run build:offline` 会先运行本脚本。
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

// --root <dir>：测试用覆盖根目录（默认脚本所在包的根），避免为测试改动真实清单。
const rootArgIndex = process.argv.indexOf('--root');
const root = rootArgIndex !== -1
  ? resolve(process.argv[rootArgIndex + 1])
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function cargoVersion(path) {
  let inPackage = false;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      inPackage = line === '[package]';
      continue;
    }
    if (!inPackage) continue;
    const match = line.match(/^version\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  }
  return null;
}

const manifests = [
  ['package.json', () => readJson(resolve(root, 'package.json')).version],
  ['src-tauri/tauri.conf.json', () => readJson(resolve(root, 'src-tauri/tauri.conf.json')).version],
  ['src-tauri/Cargo.toml', () => cargoVersion(resolve(root, 'src-tauri/Cargo.toml'))],
];

const versions = [];
for (const [file, read] of manifests) {
  try {
    versions.push([file, read()]);
  } catch (error) {
    console.error(`check-versions: cannot read version from ${file}: ${error.message}`);
    process.exit(1);
  }
}

const missing = versions.filter(([, version]) => !version);
if (missing.length) {
  console.error(`check-versions: missing version in: ${missing.map(([file]) => file).join(', ')}`);
  process.exit(1);
}

const unique = new Set(versions.map(([, version]) => version));
if (unique.size > 1) {
  console.error('check-versions: version mismatch, refusing to build:');
  for (const [file, version] of versions) {
    console.error(`  ${file}: ${version}`);
  }
  console.error('Align all three manifests to the same version before building.');
  process.exit(1);
}

console.log(`check-versions: ok (${versions[0][1]})`);
