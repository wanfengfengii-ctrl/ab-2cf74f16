/*
 * 限制性内切酶图谱复原核心算法（纯函数，无 DOM 依赖）。
 *
 * 问题：给定线性质粒构建体的总长度，以及酶A单酶切、酶B单酶切、双酶切
 * 三组片段长度（无序多重集），复原双酶切片段从左端的排列与每个内部切点
 * 的归属（酶A / 酶B / 两酶共用），使得：
 *   - 三组片段长度之和各自等于总长度；
 *   - 两组单酶切片段多重集可由连续双酶切片段合并完全吻合地得到；
 *   - 整体反向视为同一图谱。
 *
 * 在浏览器中挂载为 window.Solver，在 Node.js 中通过 module.exports 导出，
 * 供单元测试与 verify 服务复用同一份逻辑。
 */
(function (global) {
  'use strict';

  var MAX_DOUBLE_FRAGMENTS = 12; // 双酶切片段数上限（联合枚举规模保护）
  var MAX_ENUM_NODES = 2000000; // 联合枚举节点数上限
  var MAX_SOLUTIONS = 2; // 只需区分 0 / 1 / ≥2 个非反向等价图谱
  var ENUM_LIMIT = 'ENUM_LIMIT';
  var STOP_ENUM = 'STOP_ENUM';

  /* ---------------- 基础工具 ---------------- */

  function isPositiveInt(v) {
    return typeof v === 'number' && Number.isInteger(v) && v > 0;
  }

  function sum(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s;
  }

  function toMultiset(arr) {
    var m = new Map();
    for (var i = 0; i < arr.length; i++) m.set(arr[i], (m.get(arr[i]) || 0) + 1);
    return m;
  }

  function msHas(m, v) { return (m.get(v) || 0) > 0; }
  function msTake(m, v) { m.set(v, m.get(v) - 1); }
  function msGive(m, v) { m.set(v, (m.get(v) || 0) + 1); }

  function msEmpty(m) {
    for (var c of m.values()) { if (c > 0) return false; }
    return true;
  }

  function msMax(m) {
    var mx = 0;
    for (var e of m.entries()) { if (e[1] > 0 && e[0] > mx) mx = e[0]; }
    return mx;
  }

  /* ---------------- 输入校验 ---------------- */

  var GROUPS = [
    { key: 'aFragments', label: '酶A单酶切片段' },
    { key: 'bFragments', label: '酶B单酶切片段' },
    { key: 'doubleFragments', label: '双酶切片段' }
  ];

  function validateInput(input) {
    var errors = [];
    if (!input || typeof input !== 'object') {
      return [{ field: 'total', message: '输入缺失' }];
    }
    if (!isPositiveInt(input.total)) {
      errors.push({ field: 'total', message: '总长度必须是正整数' });
    }
    GROUPS.forEach(function (g) {
      var arr = input[g.key];
      if (!Array.isArray(arr) || arr.length === 0) {
        errors.push({ field: g.key, message: g.label + '：至少需要 1 个正整数片段' });
        return;
      }
      arr.forEach(function (v, i) {
        if (!isPositiveInt(v)) {
          errors.push({ field: g.key, message: g.label + '：第 ' + (i + 1) + ' 项不是正整数' });
        }
      });
    });
    return errors.length ? errors : null;
  }

  /* ---------------- 细化检查：coarse 能否由 fine 合并得到 ---------------- */
  /*
   * 必要条件：单酶切片段多重集必须能由双酶切片段多重集分组求和得到
   * （双酶切切点是两种单酶切切点的并集，因此双酶切必然更细）。
   * 回溯装箱，输入规模小（受 MAX_DOUBLE_FRAGMENTS 限制），足够快。
   */
  function canRefine(coarse, fine) {
    if (coarse.length > fine.length) return false;
    if (sum(coarse) !== sum(fine)) return false;
    var targets = coarse.slice().sort(function (a, b) { return b - a; });
    var items = fine.slice().sort(function (a, b) { return b - a; });
    var bins = new Array(targets.length).fill(0);

    function dfs(i) {
      if (i === items.length) {
        for (var k = 0; k < targets.length; k++) {
          if (bins[k] !== targets[k]) return false;
        }
        return true;
      }
      var v = items[i];
      var seen = new Set();
      for (var k = 0; k < targets.length; k++) {
        if (bins[k] + v > targets[k]) continue;
        if (seen.has(bins[k])) continue; // 填充量相同的桶彼此等价
        seen.add(bins[k]);
        bins[k] += v;
        if (dfs(i + 1)) return true;
        bins[k] -= v;
        if (bins[k] === 0) break; // 空桶彼此等价，只试第一个
      }
      return false;
    }
    return dfs(0);
  }

  /* ---------------- 图谱规范化：整体反向视为同一图谱 ---------------- */

  function interleaveKey(fragments, sites) {
    var parts = [];
    for (var i = 0; i < fragments.length; i++) {
      parts.push(String(fragments[i]));
      if (i < sites.length) parts.push(sites[i]);
    }
    return parts.join('|');
  }

  function mapKey(fragments, sites) {
    var rf = fragments.slice().reverse();
    var rs = sites.slice().reverse();
    var fwd = interleaveKey(fragments, sites);
    var rev = interleaveKey(rf, rs);
    return fwd <= rev ? fwd : rev;
  }

  function orientCanonically(fragments, sites) {
    var rf = fragments.slice().reverse();
    var rs = sites.slice().reverse();
    var fwd = interleaveKey(fragments, sites);
    var rev = interleaveKey(rf, rs);
    if (fwd <= rev) return { fragments: fragments.slice(), sites: sites.slice() };
    return { fragments: rf, sites: rs };
  }

  /* ---------------- 联合枚举：去重排列 × 内部切点归属 ---------------- */
  /*
   * 深度优先地同时枚举：
   *   - 双酶切片段的排列（按取值去重，重复长度不会产生重复排列）；
   *   - 每个内部切点的归属（酶A / 酶B / 两酶共用，至少一酶切割）。
   * 维护当前尚未完成的 A/B 运行长度与尚未匹配的单酶切片段多重集，
   * 一旦运行长度超过任何剩余片段或完成片段无法匹配即剪枝。
   * 同一图谱的两个方向都会被枚举到，由调用方用规范键去重。
   */
  function enumerateAll(doubleFragments, aFragments, bFragments, onSolution, budget) {
    var n = doubleFragments.length;
    var aRem = toMultiset(aFragments);
    var bRem = toMultiset(bFragments);
    var dRem = toMultiset(doubleFragments);
    var values = Array.from(dRem.keys()).sort(function (a, b) { return a - b; });
    var perm = new Array(n);
    var sites = new Array(Math.max(0, n - 1));
    var aRun = 0;
    var bRun = 0;

    function dfs(i) {
      if (budget.nodes-- <= 0) throw ENUM_LIMIT;
      if (i === n) {
        // 收尾：最后一段 A/B 运行必须各自匹配一个剩余单酶切片段
        if (msHas(aRem, aRun) && msHas(bRem, bRun)) {
          msTake(aRem, aRun);
          msTake(bRem, bRun);
          if (msEmpty(aRem) && msEmpty(bRem)) onSolution(perm.slice(), sites.slice());
          msGive(aRem, aRun);
          msGive(bRem, bRun);
        }
        return;
      }
      for (var vi = 0; vi < values.length; vi++) {
        var v = values[vi];
        if (!msHas(dRem, v)) continue;
        if (i === 0) {
          if (v > msMax(aRem) || v > msMax(bRem)) continue;
          msTake(dRem, v);
          perm[0] = v;
          aRun = v;
          bRun = v;
          dfs(1);
          aRun = 0;
          bRun = 0;
          msGive(dRem, v);
          continue;
        }
        // 枚举第 i-1 个内部切点：酶A是否在此切割
        for (var ai = 0; ai < 2; ai++) {
          var aCut = ai === 0;
          var naRun;
          if (aCut) {
            if (!msHas(aRem, aRun)) continue; // 完成的 A 片段必须匹配剩余多重集
            naRun = v;
          } else {
            naRun = aRun + v;
            if (naRun > msMax(aRem)) continue; // 超过任何剩余 A 片段，剪枝
          }
          if (aCut) msTake(aRem, aRun);
          for (var bi = 0; bi < 2; bi++) {
            var bCut = bi === 0;
            if (!aCut && !bCut) continue; // 双酶切相邻片段之间至少有一酶切割
            var nbRun;
            if (bCut) {
              if (!msHas(bRem, bRun)) continue;
              nbRun = v;
            } else {
              nbRun = bRun + v;
              if (nbRun > msMax(bRem)) continue;
            }
            if (bCut) msTake(bRem, bRun);
            var oaRun = aRun;
            var obRun = bRun;
            aRun = naRun;
            bRun = nbRun;
            sites[i - 1] = aCut && bCut ? 'AB' : aCut ? 'A' : 'B';
            msTake(dRem, v);
            perm[i] = v;
            dfs(i + 1);
            msGive(dRem, v);
            aRun = oaRun;
            bRun = obRun;
            if (bCut) msGive(bRem, obRun);
          }
          if (aCut) msGive(aRem, aRun);
        }
      }
    }

    dfs(0);
  }

  /* ---------------- 解的展开：坐标与单酶切合并明细 ---------------- */

  function mergeRuns(fragInfo, sites, enzyme) {
    var runs = [];
    var from = 0;
    var acc = 0;
    for (var i = 0; i < fragInfo.length; i++) {
      acc += fragInfo[i].length;
      var cutHere = i < sites.length && sites[i].indexOf(enzyme) !== -1;
      if (i === fragInfo.length - 1 || cutHere) {
        runs.push({
          fromIndex: from,
          toIndex: i,
          length: acc,
          start: fragInfo[from].start,
          end: fragInfo[i].end,
          parts: fragInfo.slice(from, i + 1).map(function (f) { return f.length; })
        });
        from = i + 1;
        acc = 0;
      }
    }
    return runs;
  }

  function buildSolution(fragments, sites) {
    var fragInfo = [];
    var pos = 0;
    for (var i = 0; i < fragments.length; i++) {
      fragInfo.push({ index: i, length: fragments[i], start: pos, end: pos + fragments[i] });
      pos += fragments[i];
    }
    var siteInfo = [];
    for (var j = 0; j < sites.length; j++) {
      siteInfo.push({ index: j, position: fragInfo[j].end, enzyme: sites[j] });
    }
    return {
      total: pos,
      fragments: fragInfo,
      sites: siteInfo,
      aRuns: mergeRuns(fragInfo, sites, 'A'),
      bRuns: mergeRuns(fragInfo, sites, 'B')
    };
  }

  /* ---------------- 多解见证的首个分歧 ---------------- */

  function firstDivergence(map1, map2) {
    var n = Math.min(map1.fragments.length, map2.fragments.length);
    for (var i = 0; i < n; i++) {
      if (map1.fragments[i].length !== map2.fragments[i].length) {
        return {
          kind: 'fragment',
          index: i,
          coordinate: map1.fragments[i].start,
          first: map1.fragments[i].length,
          second: map2.fragments[i].length
        };
      }
    }
    var m = Math.min(map1.sites.length, map2.sites.length);
    for (var j = 0; j < m; j++) {
      if (map1.sites[j].enzyme !== map2.sites[j].enzyme) {
        return {
          kind: 'site',
          index: j,
          coordinate: map1.sites[j].position,
          first: map1.sites[j].enzyme,
          second: map2.sites[j].enzyme
        };
      }
    }
    return null;
  }

  /* ---------------- 主入口 ---------------- */

  function failureNone(group, reason, detail) {
    return { status: 'none', failure: { group: group, reason: reason, detail: detail || {} } };
  }

  function solveMap(input) {
    var errors = validateInput(input);
    if (errors) return { status: 'invalid', errors: errors };

    var total = input.total;
    var A = input.aFragments;
    var B = input.bFragments;
    var D = input.doubleFragments;

    // 依次定位“最先无法同时满足的消化组”
    if (sum(A) !== total) return failureNone('A', 'sum', { expected: total, actual: sum(A) });
    if (sum(B) !== total) return failureNone('B', 'sum', { expected: total, actual: sum(B) });
    if (sum(D) !== total) return failureNone('D', 'sum', { expected: total, actual: sum(D) });

    if (D.length > MAX_DOUBLE_FRAGMENTS) {
      return {
        status: 'limit',
        message: '双酶切片段数 ' + D.length + ' 超过上限 ' + MAX_DOUBLE_FRAGMENTS + '，无法保证在浏览器内完成联合枚举'
      };
    }

    if (!canRefine(A, D)) return failureNone('A', 'refine', {});
    if (!canRefine(B, D)) return failureNone('B', 'refine', {});

    var solutions = [];
    var seen = new Set();
    var budget = { nodes: MAX_ENUM_NODES };
    try {
      enumerateAll(D, A, B, function (fragments, sites) {
        var oriented = orientCanonically(fragments, sites);
        var key = mapKey(oriented.fragments, oriented.sites);
        if (seen.has(key)) return; // 反向等价或重复排列，归并
        seen.add(key);
        solutions.push(buildSolution(oriented.fragments, oriented.sites));
        if (solutions.length >= MAX_SOLUTIONS) throw STOP_ENUM;
      }, budget);
    } catch (e) {
      if (e === STOP_ENUM) {
        // 已收集到足够的见证，提前结束
      } else if (e === ENUM_LIMIT) {
        return { status: 'limit', message: '联合枚举规模超限，请减少双酶切片段数后重试' };
      } else {
        throw e;
      }
    }

    if (solutions.length === 0) return failureNone('D', 'joint', {});
    if (solutions.length === 1) return { status: 'unique', map: solutions[0] };
    return {
      status: 'multiple',
      maps: solutions,
      divergence: firstDivergence(solutions[0], solutions[1])
    };
  }

  var Solver = {
    solveMap: solveMap,
    canRefine: canRefine,
    mapKey: mapKey,
    orientCanonically: orientCanonically,
    firstDivergence: firstDivergence,
    limits: { MAX_DOUBLE_FRAGMENTS: MAX_DOUBLE_FRAGMENTS, MAX_ENUM_NODES: MAX_ENUM_NODES }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Solver;
  if (global) global.Solver = Solver;
})(typeof window !== 'undefined' ? window : globalThis);
