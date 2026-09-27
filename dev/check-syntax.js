/* 语法自检：用 node --check 逐个校验渲染层脚本（不需要启动 Electron）。
   用法：npm run syntax */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(p, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(ROOT);
let failed = 0;
let mojibake = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed += 1;
    console.log(`✗ 语法错误: ${path.relative(ROOT, file)}`);
    console.log(String(err.stderr || err.message).split('\n').slice(0, 4).join('\n'));
  }
  const text = fs.readFileSync(file, 'utf8');
  const lost = (text.match(/\uFFFD/g) || []).length;
  if (lost > 0) {
    mojibake += lost;
    console.log(`✗ 编码残留 ${lost} 处: ${path.relative(ROOT, file)}`);
  }
}

console.log(`\n检查 ${files.length} 个文件：语法错误 ${failed} 个，编码残留 ${mojibake} 处`);
process.exit(failed + mojibake > 0 ? 1 : 0);
