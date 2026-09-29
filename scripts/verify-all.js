'use strict';

/*
 * verify 一次性服务入口：依次执行
 *   1. 代码测试（node --test）
 *   2. 构建（scripts/build.js）
 *   3. 三种业务结论验证（scripts/verify-business.js）
 *   4. 网页 HTTP 冒烟（scripts/smoke.js）
 * 全部完成后自行退出，退出码 0 表示全部通过，1 表示存在失败步骤。
 */

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

const STEPS = [
  { name: '代码测试', cmd: [process.execPath, '--test', 'tests/solver.test.js'] },
  { name: '构建', cmd: [process.execPath, 'scripts/build.js'] },
  { name: '三种业务结论', cmd: [process.execPath, 'scripts/verify-business.js'] },
  { name: '网页 HTTP 冒烟', cmd: [process.execPath, 'scripts/smoke.js'] }
];

let failed = 0;

for (const step of STEPS) {
  console.log('\n=== [' + step.name + '] ===');
  const res = spawnSync(step.cmd[0], step.cmd.slice(1), { cwd: root, stdio: 'inherit' });
  if (res.status !== 0) {
    failed++;
    console.error('--- [' + step.name + '] 失败（退出码 ' + res.status + '）');
  } else {
    console.log('--- [' + step.name + '] 通过');
  }
}

console.log('\n========================================');
if (failed > 0) {
  console.error('verify 结果：失败（' + failed + '/' + STEPS.length + ' 个步骤未通过）');
  process.exit(1);
}
console.log('verify 结果：全部通过（' + STEPS.length + '/' + STEPS.length + '）');
process.exit(0);
