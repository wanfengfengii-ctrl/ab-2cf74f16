'use strict';

/*
 * 三种业务结论验证：
 *   1. 唯一图谱：复原出唯一的切点顺序（整体反向视为同一图谱）；
 *   2. 多解：给出两份首个分歧明确的见证；
 *   3. 无可行图谱：指出最先无法同时满足的消化组。
 */

const Solver = require('../web/solver.js');

let failures = 0;

function check(name, cond, extra) {
  if (cond) {
    console.log('  ✓ ' + name);
  } else {
    failures++;
    console.error('  ✗ ' + name + (extra ? ' —— ' + extra : ''));
  }
}

function sortedCopy(arr) {
  return arr.slice().sort((a, b) => a - b);
}

function mapSignature(map) {
  return Solver.mapKey(
    map.fragments.map((f) => f.length),
    map.sites.map((s) => s.enzyme)
  );
}

/* 结论一：唯一图谱 */
console.log('业务结论 1/3：唯一图谱复原');
{
  const r = Solver.solveMap({
    total: 6000,
    aFragments: [3000, 3000],
    bFragments: [2000, 4000],
    doubleFragments: [1000, 2000, 3000]
  });
  check('状态为 unique', r.status === 'unique', JSON.stringify(r));
  if (r.status === 'unique') {
    check(
      '双酶切片段顺序为 [2000, 1000, 3000]',
      JSON.stringify(r.map.fragments.map((f) => f.length)) === '[2000,1000,3000]'
    );
    check(
      '内部切点归属为 [酶B, 酶A]，坐标 [2000, 3000]',
      JSON.stringify(r.map.sites.map((s) => s.enzyme)) === '["B","A"]' &&
        JSON.stringify(r.map.sites.map((s) => s.position)) === '[2000,3000]'
    );
    check(
      '酶A 单酶切由连续双酶切片段合并吻合',
      JSON.stringify(sortedCopy(r.map.aRuns.map((x) => x.length))) === '[3000,3000]'
    );
    check(
      '酶B 单酶切由连续双酶切片段合并吻合',
      JSON.stringify(sortedCopy(r.map.bRuns.map((x) => x.length))) === '[2000,4000]'
    );
  }
}

/* 结论二：多解时给出两份首个分歧明确的见证 */
console.log('业务结论 2/3：多解的两份见证与首个分歧');
{
  const r = Solver.solveMap({
    total: 5,
    aFragments: [1, 2, 2],
    bFragments: [1, 4],
    doubleFragments: [1, 1, 1, 2]
  });
  check('状态为 multiple', r.status === 'multiple', JSON.stringify(r));
  if (r.status === 'multiple') {
    check('恰好给出两份见证', r.maps.length === 2);
    check('两份见证非反向等价', mapSignature(r.maps[0]) !== mapSignature(r.maps[1]));
    check(
      '首个分歧定位在第 2 个双酶切片段（起始坐标 1）',
      r.divergence &&
        r.divergence.kind === 'fragment' &&
        r.divergence.index === 1 &&
        r.divergence.coordinate === 1,
      JSON.stringify(r.divergence)
    );
    check(
      '两份见证各自都复现两组单酶切',
      r.maps.every(
        (m) =>
          JSON.stringify(sortedCopy(m.aRuns.map((x) => x.length))) === '[1,2,2]' &&
          JSON.stringify(sortedCopy(m.bRuns.map((x) => x.length))) === '[1,4]'
      )
    );
  }
}

/* 结论三：无可行图谱时指出最先无法同时满足的消化组 */
console.log('业务结论 3/3：无可行图谱时的首个失败消化组');
{
  const rJoint = Solver.solveMap({
    total: 6,
    aFragments: [3, 3],
    bFragments: [2, 4],
    doubleFragments: [1, 1, 2, 2]
  });
  check(
    '联合排列无解时报告双酶切组',
    rJoint.status === 'none' && rJoint.failure.group === 'D' && rJoint.failure.reason === 'joint',
    JSON.stringify(rJoint)
  );

  const rRefine = Solver.solveMap({
    total: 6,
    aFragments: [3, 3],
    bFragments: [6],
    doubleFragments: [1, 1, 4]
  });
  check(
    '酶A 无法由双酶切合并得到时报告酶A 组',
    rRefine.status === 'none' && rRefine.failure.group === 'A' && rRefine.failure.reason === 'refine',
    JSON.stringify(rRefine)
  );

  const rSum = Solver.solveMap({
    total: 6,
    aFragments: [2, 2],
    bFragments: [6],
    doubleFragments: [1, 1, 4]
  });
  check(
    '长度和不符时报告对应消化组',
    rSum.status === 'none' && rSum.failure.group === 'A' && rSum.failure.reason === 'sum',
    JSON.stringify(rSum)
  );
}

if (failures > 0) {
  console.error('业务结论验证失败：' + failures + ' 项未通过');
  process.exit(1);
}
console.log('三种业务结论全部验证通过');
