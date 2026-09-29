# 限制性内切酶图谱复原

基因治疗载体放行质控工具：录入线性质粒构建体的总长度，以及酶A、酶B 单酶切与
双酶切三组片段长度（正整数，无序），在浏览器内联合复原切点顺序——

- 双酶切片段从左端开始的排列、每个内部切点的归属（酶A / 酶B / 两酶共用）与坐标；
- 两组单酶切如何由连续双酶切片段合并得到（多重集完全吻合）；
- 三组长度之和各自等于总长度，整体反向视为同一图谱；
- 存在多个非反向等价图谱时，给出两份首个分歧明确的见证；
- 无可行图谱时，指出最先无法同时满足的消化组；
- 修改任一草稿后自动清除旧结论。

所有计算仅在浏览器内完成（联合枚举双酶切片段的去重排列与内部切点归属），
无任何后端依赖，交付物为纯静态站点。

## 目录结构

```
web/            静态前端（index.html / app.js / solver.js / styles.css）
tests/          求解器单元测试（node:test）
scripts/        build.js 构建、verify-business.js 三种业务结论、
                smoke.js HTTP 冒烟、verify-all.js verify 服务入口
Dockerfile      web 镜像（多阶段：构建 dist/ → nginx 托管，含 HTTP 健康检查）
Dockerfile.verify  verify 一次性服务镜像
docker-compose.yml   web 服务 + verify 一次性服务
```

## 运行网页

```bash
docker compose up --build web          # 默认 http://localhost:8080
WEB_PORT=9090 docker compose up --build web   # 宿主机端口由 WEB_PORT 配置
```

健康检查：`GET /healthz` 返回 `200 ok`（Compose 与 Dockerfile 均已配置）。

## 一次性验证（verify 服务）

```bash
docker compose up --build --abort-on-container-exit --exit-code-from verify verify
echo $?   # 0 = 全部通过；非 0 = 存在失败步骤
```

`verify` 依次完成：代码测试（`node --test`）→ 构建（校验并产出 `dist/`）→
三种业务结论（唯一图谱 / 多解双见证 / 无可行图谱的首个失败消化组）→
网页 HTTP 冒烟（`/healthz`、首页与静态资源），随后自行退出并以退出码报告结果。

不使用 Docker 时，也可以在仓库根目录本地执行同样的验证：

```bash
node --test tests/solver.test.js   # 代码测试
node scripts/build.js              # 构建到 dist/
node scripts/verify-business.js    # 三种业务结论
WEB_URL=http://localhost:8080 node scripts/smoke.js   # 需先有静态服务在运行
```

## 算法说明

输入：总长度 `L` 与三组片段多重集 `A`、`B`、`D`（双酶切）。

1. 依次校验三组长度之和等于 `L`，否则报告最先不符的消化组；
2. 必要条件：单酶切多重集必须能由双酶切多重集分组求和得到
   （双酶切切点是两组单酶切切点的并集），否则报告对应消化组；
3. 深度优先联合枚举：双酶切片段按取值去重的排列 × 每个内部切点的归属
   （酶A / 酶B / 两酶共用，相邻双酶切片段之间至少一酶切割）。
   枚举中维护尚未匹配的单酶切片段多重集与当前运行长度，超限即剪枝；
4. 每个候选图谱与其整体反向取字典序较小者为规范形并去重，
   收集到 2 个非反向等价图谱即停止；
5. 0 个解 → 报告双酶切组无法同时满足；1 个 → 唯一图谱；
   ≥2 个 → 展示前两个见证及其首个分歧（片段或切点，含坐标）。

规模保护：双酶切片段数上限 12，枚举节点上限 2×10⁶，超限给出明确提示。
