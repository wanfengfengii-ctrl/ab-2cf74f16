/*
 * 页面交互：解析草稿、调用 Solver 联合复原、渲染结论。
 * 任何草稿被修改后，立即清除旧结论。
 */
(function () {
  'use strict';

  var FIELD_IDS = ['total', 'a-fragments', 'b-fragments', 'double-fragments'];
  var resultEl = document.getElementById('result');

  /* ---------------- 草稿解析 ---------------- */

  function parseTotal(raw) {
    var t = raw.trim();
    if (!/^\d+$/.test(t)) return { value: null, error: '总长度必须是正整数' };
    var v = parseInt(t, 10);
    if (v <= 0) return { value: null, error: '总长度必须是正整数' };
    return { value: v };
  }

  function parseFragments(raw) {
    var t = raw.trim();
    if (!t) return { values: null, error: '请至少输入 1 个片段长度' };
    var tokens = t.split(/[\s,，、;；]+/).filter(Boolean);
    var values = [];
    for (var i = 0; i < tokens.length; i++) {
      if (!/^\d+$/.test(tokens[i])) {
        return { values: null, error: '无法识别的内容「' + tokens[i] + '」，片段长度应为正整数' };
      }
      var v = parseInt(tokens[i], 10);
      if (v <= 0) return { values: null, error: '片段长度必须为正整数' };
      values.push(v);
    }
    return { values: values };
  }

  function readDraft() {
    var errors = [];
    var input = { total: null, aFragments: [], bFragments: [], doubleFragments: [] };
    var total = parseTotal(document.getElementById('total').value);
    if (total.error) errors.push(total.error); else input.total = total.value;
    var groups = [
      ['a-fragments', '酶A单酶切片段', 'aFragments'],
      ['b-fragments', '酶B单酶切片段', 'bFragments'],
      ['double-fragments', '双酶切片段', 'doubleFragments']
    ];
    groups.forEach(function (g) {
      var parsed = parseFragments(document.getElementById(g[0]).value);
      if (parsed.error) errors.push(g[1] + '：' + parsed.error);
      else input[g[2]] = parsed.values;
    });
    return { input: input, errors: errors };
  }

  /* ---------------- 渲染 ---------------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function enzymeText(code) {
    if (code === 'AB') return '酶A+酶B';
    return code === 'A' ? '酶A' : '酶B';
  }

  function mapBarHtml(map) {
    var html = '<div class="map-bar">';
    map.fragments.forEach(function (f, i) {
      html += '<div class="frag" style="flex-grow:' + f.length + '">' +
        '<span class="frag-len">' + f.length + '</span>' +
        '<span class="frag-range">[' + f.start + ', ' + f.end + ')</span>' +
        '</div>';
      if (i < map.sites.length) {
        var s = map.sites[i];
        html += '<div class="site site-' + s.enzyme.toLowerCase() + '">' +
          '<span class="site-enzyme">' + enzymeText(s.enzyme) + '</span>' +
          '<span class="site-line"></span>' +
          '<span class="site-pos">' + s.position + '</span>' +
          '</div>';
      }
    });
    html += '</div>';
    return html;
  }

  function fragmentsTableHtml(map) {
    var rows = map.fragments.map(function (f) {
      return '<tr><td>' + (f.index + 1) + '</td><td>' + f.length + '</td>' +
        '<td>' + f.start + '</td><td>' + f.end + '</td></tr>';
    }).join('');
    return '<table><thead><tr><th>#</th><th>长度</th><th>起点坐标</th><th>终点坐标</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  function sitesTableHtml(map) {
    if (!map.sites.length) return '<p>无内部切点（双酶切仅 1 个片段）。</p>';
    var rows = map.sites.map(function (s) {
      return '<tr><td>' + (s.index + 1) + '</td><td>' + s.position + '</td>' +
        '<td><span class="enzyme-tag enzyme-' + s.enzyme.toLowerCase() + '">' + enzymeText(s.enzyme) + '</span></td></tr>';
    }).join('');
    return '<table><thead><tr><th>#</th><th>坐标</th><th>归属酶</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  function runsTableHtml(runs) {
    var rows = runs.map(function (r, i) {
      var span = r.fromIndex === r.toIndex
        ? '第 ' + (r.fromIndex + 1) + ' 段'
        : '第 ' + (r.fromIndex + 1) + '–' + (r.toIndex + 1) + ' 段';
      return '<tr><td>' + (i + 1) + '</td><td>' + span + '</td>' +
        '<td>' + r.parts.join(' + ') + '</td><td>' + r.length + '</td>' +
        '<td>[' + r.start + ', ' + r.end + ')</td></tr>';
    }).join('');
    return '<table><thead><tr><th>#</th><th>双酶切片段</th><th>合并式</th><th>长度</th><th>区间</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  function mapDetailHtml(map, title) {
    return '<div class="map-detail">' +
      '<h3>' + esc(title) + '</h3>' +
      mapBarHtml(map) +
      '<h4>双酶切片段顺序（从左端开始）</h4>' + fragmentsTableHtml(map) +
      '<h4>内部切点归属</h4>' + sitesTableHtml(map) +
      '<h4>酶A 单酶切：连续双酶切片段合并</h4>' + runsTableHtml(map.aRuns) +
      '<h4>酶B 单酶切：连续双酶切片段合并</h4>' + runsTableHtml(map.bRuns) +
      '</div>';
  }

  function divergenceText(d) {
    if (!d) return '';
    if (d.kind === 'fragment') {
      return '首个分歧：第 ' + (d.index + 1) + ' 个双酶切片段（起始坐标 ' + d.coordinate +
        '）—— 见证一长度 ' + d.first + '，见证二长度 ' + d.second + '。';
    }
    return '首个分歧：第 ' + (d.index + 1) + ' 个内部切点（坐标 ' + d.coordinate +
      '）—— 见证一为' + enzymeText(d.first) + '，见证二为' + enzymeText(d.second) + '。';
  }

  var GROUP_NAMES = { A: '酶A 单酶切组', B: '酶B 单酶切组', D: '双酶切组' };

  function failureReasonText(failure) {
    if (failure.reason === 'sum') {
      return '片段长度之和为 ' + failure.detail.actual + '，与总长度 ' + failure.detail.expected + ' 不一致。';
    }
    if (failure.reason === 'refine') {
      return '其片段多重集无法由双酶切片段合并得到（双酶切切点是两组单酶切切点的并集，必须更细）。';
    }
    return '双酶切片段的任何排列与内部切点归属，都无法同时复现两组单酶切片段多重集。';
  }

  function render(result) {
    resultEl.hidden = false;
    if (result.status === 'invalid') {
      resultEl.innerHTML = '<div class="card error"><h2>输入有误</h2><ul>' +
        result.errors.map(function (e) { return '<li>' + esc(e.message) + '</li>'; }).join('') +
        '</ul></div>';
      return;
    }
    if (result.status === 'limit') {
      resultEl.innerHTML = '<div class="card warn"><h2>枚举规模超限</h2><p>' +
        esc(result.message) + '</p></div>';
      return;
    }
    if (result.status === 'none') {
      resultEl.innerHTML = '<div class="card error"><h2>无可行图谱</h2>' +
        '<p>最先无法同时满足的消化组：<strong>' + GROUP_NAMES[result.failure.group] + '</strong></p>' +
        '<p>' + esc(failureReasonText(result.failure)) + '</p></div>';
      return;
    }
    if (result.status === 'unique') {
      resultEl.innerHTML = '<div class="card ok"><h2>复原成功：唯一图谱</h2>' +
        '<p class="note">整体反向视为同一图谱，以下按规范方向展示。</p>' +
        mapDetailHtml(result.map, '复原图谱') + '</div>';
      return;
    }
    if (result.status === 'multiple') {
      resultEl.innerHTML = '<div class="card warn"><h2>存在多个非反向等价图谱</h2>' +
        '<p class="divergence">' + esc(divergenceText(result.divergence)) + '</p>' +
        mapDetailHtml(result.maps[0], '见证一') +
        mapDetailHtml(result.maps[1], '见证二') + '</div>';
    }
  }

  /* ---------------- 事件 ---------------- */

  function clearResult() {
    resultEl.hidden = true;
    resultEl.innerHTML = '';
  }

  function onSolve() {
    var draft = readDraft();
    if (draft.errors.length) {
      render({ status: 'invalid', errors: draft.errors.map(function (m) { return { message: m }; }) });
      return;
    }
    render(window.Solver.solveMap(draft.input));
  }

  document.getElementById('solve-btn').addEventListener('click', onSolve);
  document.getElementById('sample-btn').addEventListener('click', function () {
    document.getElementById('total').value = '6000';
    document.getElementById('a-fragments').value = '3000, 3000';
    document.getElementById('b-fragments').value = '2000, 4000';
    document.getElementById('double-fragments').value = '1000, 2000, 3000';
    clearResult();
  });
  FIELD_IDS.forEach(function (id) {
    document.getElementById(id).addEventListener('input', clearResult);
  });
})();
