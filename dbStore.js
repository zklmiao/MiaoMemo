// 纯 Node 持久化模块：无 electron 依赖，可被 tests 直接 require 做真模块测试。
const fs = require('node:fs');

function backupCorruptedFile(dbPath) {
  const backupPath = `${dbPath}.corrupt-${Date.now()}.bak`;
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function atomicWriteFileSync(targetPath, content) {
  const tmpPath = `${targetPath}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

// 启动时清理上次崩溃残留的 .tmp（主文件完好时直接删除，避免堆积）。
function cleanupStaleTmp(dbPath) {
  const tmpPath = `${dbPath}.tmp`;
  try {
    if (fs.existsSync(tmpPath)) {
      fs.rmSync(tmpPath, { force: true });
    }
  } catch (e) {
    console.error('Failed to clean stale tmp file:', e);
  }
}

function loadDBFromDisk(dbPath) {
  try {
    if (!fs.existsSync(dbPath)) {
      return { notes: [] };
    }
    const raw = fs.readFileSync(dbPath, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      // JSON 损坏：备份后返回空库，绝不直接覆盖原文件
      try {
        const backupPath = backupCorruptedFile(dbPath);
        console.error(`notes.json corrupted, backed up to ${backupPath}:`, parseErr.message);
      } catch (backupErr) {
        console.error('Failed to back up corrupted notes.json:', backupErr);
      }
      return { notes: [] };
    }
    if (!parsed || !Array.isArray(parsed.notes)) {
      // 结构损坏（合法 JSON 但 notes 缺失/非数组）：同样备份，不能静默丢弃
      try {
        const backupPath = backupCorruptedFile(dbPath);
        console.error(`notes.json has invalid structure, backed up to ${backupPath}`);
      } catch (backupErr) {
        console.error('Failed to back up malformed notes.json:', backupErr);
      }
      return { notes: [] };
    }
    return parsed;
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return { notes: [] };
    }
    console.error('Error reading notes database:', e);
    return { notes: [] };
  }
}

// 通用内存缓存 + 单防抖刷盘（main.js 用它接磁盘，tests 用它接内存断言，测的是真实逻辑）。
function createMemoryStore({ load, delay, onFlush }) {
  let cache = null;
  let dirty = false;
  let timer = null;

  function get() {
    if (!cache) {
      cache = load();
    }
    return cache;
  }

  function flushSync() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    // 修 B5：未加载且不脏时绝不能写空库覆盖磁盘
    if (!dirty) {
      return false;
    }
    if (!cache) {
      return false;
    }
    onFlush(cache);
    dirty = false;
    return true;
  }

  function schedule() {
    dirty = true;
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      flushSync();
    }, delay);
  }

  function setCache(data) {
    cache = data;
    schedule();
  }

  return { get, schedule, flushSync, setCache };
}

module.exports = {
  atomicWriteFileSync,
  loadDBFromDisk,
  cleanupStaleTmp,
  createMemoryStore
};
