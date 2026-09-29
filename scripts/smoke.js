'use strict';

/*
 * 网页 HTTP 冒烟：对运行中的 web 服务检查健康端点与静态资源。
 * 目标地址由 WEB_URL 环境变量指定（Compose 内默认为 http://web:80）。
 */

const base = (process.env.WEB_URL || 'http://web:80').replace(/\/+$/, '');

const CHECKS = [
  { path: '/healthz', expect: 'ok', desc: 'HTTP 健康检查端点' },
  { path: '/', expect: '限制性内切酶图谱复原', desc: '首页可访问且包含应用标题' },
  { path: '/', expect: 'solver.js', desc: '首页引用求解器脚本' },
  { path: '/solver.js', expect: 'solveMap', desc: '求解器脚本可访问' },
  { path: '/app.js', expect: '复原', desc: '页面脚本可访问' },
  { path: '/styles.css', expect: 'map-bar', desc: '样式表可访问' }
];

const RETRY_DELAYS = [0, 1000, 2000, 3000, 5000, 5000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url) {
  let lastErr;
  for (const delay of RETRY_DELAYS) {
    if (delay) await sleep(delay);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      return res;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function main() {
  let failures = 0;
  for (const c of CHECKS) {
    const url = base + c.path;
    try {
      const res = await fetchWithRetry(url);
      const body = await res.text();
      if (res.status !== 200) {
        failures++;
        console.error('  ✗ ' + c.desc + '：GET ' + url + ' 返回 ' + res.status);
      } else if (!body.includes(c.expect)) {
        failures++;
        console.error('  ✗ ' + c.desc + '：GET ' + url + ' 响应中未找到「' + c.expect + '」');
      } else {
        console.log('  ✓ ' + c.desc);
      }
    } catch (err) {
      failures++;
      console.error('  ✗ ' + c.desc + '：GET ' + url + ' 请求失败：' + err.message);
    }
  }
  if (failures > 0) {
    console.error('HTTP 冒烟失败：' + failures + ' 项未通过');
    process.exit(1);
  }
  console.log('HTTP 冒烟全部通过（' + base + '）');
}

main();
