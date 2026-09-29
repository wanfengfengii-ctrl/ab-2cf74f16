'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Solver = require('../web/solver.js');

function fragLengths(map) {
  return map.fragments.map((f) => f.length);
}

function siteEnzymes(map) {
  return map.sites.map((s) => s.enzyme);
}

function sortedCopy(arr) {
  return arr.slice().sort((a, b) => a - b);
}

/* ---------------- 输入校验 ---------------- */

test('非法输入：总长度非正整数', () => {
  const r = Solver.solveMap({ total: 0, aFragments: [1], bFragments: [1], doubleFragments: [1] });
  assert.equal(r.status, 'invalid');
});

test('非法输入：片段含非正整数或空组', () => {
  const r1 = Solver.solveMap({ total: 2, aFragments: [1, -1], bFragments: [2], doubleFragments: [2] });
  assert.equal(r1.status, 'invalid');
  const r2 = Solver.solveMap({ total: 2, aFragments: [], bFragments: [2], doubleFragments: [2] });
  assert.equal(r2.status, 'invalid');
  const r3 = Solver.solveMap({ total: 2, aFragments: [1.5, 0.5], bFragments: [2], doubleFragments: [2] });
  assert.equal(r3.status, 'invalid');
});

/* ---------------- 长度和校验：最先无法满足的消化组 ---------------- */

test('长度和不符时按 A、B、双酶切顺序报告首个失败组', () => {
  const rA = Solver.solveMap({ total: 6, aFragments: [2, 2], bFragments: [6], doubleFragments: [1, 1, 4] });
  assert.deepEqual([rA.status, rA.failure.group, rA.failure.reason], ['none', 'A', 'sum']);
  const rB = Solver.solveMap({ total: 6, aFragments: [6], bFragments: [2, 2], doubleFragments: [1, 1, 4] });
  assert.deepEqual([rB.status, rB.failure.group, rB.failure.reason], ['none', 'B', 'sum']);
  const rD = Solver.solveMap({ total: 6, aFragments: [6], bFragments: [6], doubleFragments: [1, 1, 3] });
  assert.deepEqual([rD.status, rD.failure.group, rD.failure.reason], ['none', 'D', 'sum']);
});

/* ---------------- 细化检查 ---------------- */

test('单酶切无法由双酶切合并得到时报告对应消化组', () => {
  const rA = Solver.solveMap({ total: 6, aFragments: [3, 3], bFragments: [6], doubleFragments: [1, 1, 4] });
  assert.deepEqual([rA.status, rA.failure.group, rA.failure.reason], ['none', 'A', 'refine']);
  const rB = Solver.solveMap({ total: 6, aFragments: [2, 4], bFragments: [3, 3], doubleFragments: [1, 1, 4] });
  assert.deepEqual([rB.status, rB.failure.group, rB.failure.reason], ['none', 'B', 'refine']);
});

test('canRefine 基本行为', () => {
  assert.equal(Solver.canRefine([3, 3], [1, 2, 3]), true);
  assert.equal(Solver.canRefine([4, 4], [1, 2, 4]), false);
  assert.equal(Solver.canRefine([6], [1, 2, 3]), true);
  assert.equal(Solver.canRefine([2, 2, 2], [2, 2]), false);
});

/* ---------------- 唯一图谱 ---------------- */

test('唯一图谱：含重复片段的双酶切', () => {
  const r = Solver.solveMap({ total: 4, aFragments: [2, 2], bFragments: [1, 3], doubleFragments: [1, 1, 2] });
  assert.equal(r.status, 'unique');
  assert.deepEqual(fragLengths(r.map), [1, 1, 2]);
  assert.deepEqual(siteEnzymes(r.map), ['B', 'A']);
  // 坐标
  assert.deepEqual(r.map.fragments.map((f) => [f.start, f.end]), [[0, 1], [1, 2], [2, 4]]);
  assert.deepEqual(r.map.sites.map((s) => s.position), [1, 2]);
  // 单酶切合并明细与输入多重集吻合
  assert.deepEqual(sortedCopy(r.map.aRuns.map((x) => x.length)), [2, 2]);
  assert.deepEqual(sortedCopy(r.map.bRuns.map((x) => x.length)), [1, 3]);
});

test('唯一图谱：全不同片段，规范方向展示', () => {
  const r = Solver.solveMap({ total: 6, aFragments: [3, 3], bFragments: [2, 4], doubleFragments: [1, 2, 3] });
  assert.equal(r.status, 'unique');
  assert.deepEqual(fragLengths(r.map), [2, 1, 3]);
  assert.deepEqual(siteEnzymes(r.map), ['B', 'A']);
});

test('整体反向视为同一图谱：输入顺序不影响结论', () => {
  const r1 = Solver.solveMap({ total: 4, aFragments: [2, 2], bFragments: [1, 3], doubleFragments: [1, 1, 2] });
  const r2 = Solver.solveMap({ total: 4, aFragments: [2, 2], bFragments: [3, 1], doubleFragments: [2, 1, 1] });
  assert.equal(r1.status, 'unique');
  assert.equal(r2.status, 'unique');
  assert.deepEqual(fragLengths(r2.map), fragLengths(r1.map));
  assert.deepEqual(siteEnzymes(r2.map), siteEnzymes(r1.map));
});

test('单片段构建体：无内部切点', () => {
  const r = Solver.solveMap({ total: 5, aFragments: [5], bFragments: [5], doubleFragments: [5] });
  assert.equal(r.status, 'unique');
  assert.deepEqual(fragLengths(r.map), [5]);
  assert.deepEqual(r.map.sites, []);
  assert.deepEqual(r.map.aRuns.map((x) => x.length), [5]);
  assert.deepEqual(r.map.bRuns.map((x) => x.length), [5]);
});

/* ---------------- 多解：两份见证与首个分歧 ---------------- */

test('多解（片段顺序分歧）：给出两份见证并定位首个分歧片段', () => {
  const r = Solver.solveMap({ total: 5, aFragments: [1, 2, 2], bFragments: [1, 4], doubleFragments: [1, 1, 1, 2] });
  assert.equal(r.status, 'multiple');
  assert.equal(r.maps.length, 2);
  // 两份见证非反向等价
  const k1 = Solver.mapKey(fragLengths(r.maps[0]), siteEnzymes(r.maps[0]));
  const k2 = Solver.mapKey(fragLengths(r.maps[1]), siteEnzymes(r.maps[1]));
  assert.notEqual(k1, k2);
  // 首个分歧：第 2 个双酶切片段（起始坐标 1），1 vs 2
  assert.deepEqual(r.divergence, { kind: 'fragment', index: 1, coordinate: 1, first: 1, second: 2 });
  // 两份见证自身都满足两组单酶切
  for (const m of r.maps) {
    assert.deepEqual(sortedCopy(m.aRuns.map((x) => x.length)), [1, 2, 2]);
    assert.deepEqual(sortedCopy(m.bRuns.map((x) => x.length)), [1, 4]);
  }
});

test('多解（切点归属分歧）：首个分歧落在内部切点上', () => {
  const r = Solver.solveMap({ total: 4, aFragments: [1, 1, 2], bFragments: [1, 1, 2], doubleFragments: [1, 1, 1, 1] });
  assert.equal(r.status, 'multiple');
  assert.equal(r.maps.length, 2);
  assert.deepEqual(r.divergence, { kind: 'site', index: 1, coordinate: 2, first: 'A', second: 'B' });
});

/* ---------------- 无可行图谱：联合排列失败 ---------------- */

test('两组单酶切各自可细化但无法同时满足时，报告双酶切组', () => {
  const r = Solver.solveMap({ total: 6, aFragments: [3, 3], bFragments: [2, 4], doubleFragments: [1, 1, 2, 2] });
  assert.deepEqual([r.status, r.failure.group, r.failure.reason], ['none', 'D', 'joint']);
});

/* ---------------- 规模保护 ---------------- */

test('双酶切片段数超过上限时返回 limit', () => {
  const r = Solver.solveMap({
    total: 13,
    aFragments: [13],
    bFragments: [13],
    doubleFragments: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  });
  assert.equal(r.status, 'limit');
});
