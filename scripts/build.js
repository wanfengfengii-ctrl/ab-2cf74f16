'use strict';

/*
 * 静态站点构建：校验 web/ 下的资源并复制到 dist/。
 *  - 必需文件存在；
 *  - JS 文件通过 node --check 语法检查；
 *  - index.html 引用的本地资源均存在；
 *  - 输出 build-info.json（文件清单与 SHA-256）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const webDir = path.join(root, 'web');
const outDir = path.join(root, 'dist');

const REQUIRED = ['index.html', 'app.js', 'solver.js', 'styles.css'];

function fail(message) {
  console.error('构建失败：' + message);
  process.exit(1);
}

// 1. 必需文件存在
for (const name of REQUIRED) {
  if (!fs.existsSync(path.join(webDir, name))) fail('缺少文件 web/' + name);
}

// 2. JS 语法检查
for (const name of REQUIRED.filter((n) => n.endsWith('.js'))) {
  const res = spawnSync(process.execPath, ['--check', path.join(webDir, name)], { encoding: 'utf8' });
  if (res.status !== 0) fail('web/' + name + ' 语法错误：\n' + (res.stderr || res.stdout));
}

// 3. index.html 引用的本地资源存在
const html = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
const refs = [];
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const ref = m[1];
  if (/^(https?:)?\/\//.test(ref) || ref.startsWith('#') || ref.startsWith('data:')) continue;
  refs.push(ref);
}
for (const ref of refs) {
  if (!fs.existsSync(path.join(webDir, ref))) fail('index.html 引用了不存在的资源：' + ref);
}

// 4. 复制到 dist/ 并生成构建信息
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const files = [];
for (const name of fs.readdirSync(webDir).sort()) {
  const src = path.join(webDir, name);
  if (!fs.statSync(src).isFile()) continue;
  const content = fs.readFileSync(src);
  fs.writeFileSync(path.join(outDir, name), content);
  files.push({ name, bytes: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') });
}
fs.writeFileSync(
  path.join(outDir, 'build-info.json'),
  JSON.stringify({ builtAt: new Date().toISOString(), files }, null, 2) + '\n'
);

console.log('构建完成：dist/ 共 ' + files.length + ' 个文件（' + files.map((f) => f.name).join(', ') + '）');
