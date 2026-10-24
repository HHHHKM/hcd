# B4 历史对比与审核展示收尾记录

## 实现

- `packages/server/src/change-worker-client.ts`：每个应用一个惰性启动的 CPU worker。缓存键为不可变的文档/起止版本三元组；LRU 上限 32 项、32 MiB。同键在途工作合并；队列上限 16 项、32 MiB；每项 60 秒超时。关闭应用时清理 worker、队列和缓存。
- `packages/server/src/change-worker.ts`：在 worker 内计算历史差异与审核展示，历史响应直接返回 JSON 字符串，使缓存命中路径不在主线程重新计算/序列化完整差异。
- `packages/server/src/change-presentation.ts`：分离不可变数据采集与展示计算；worker 不持有数据库，不执行授权或写入。
- `packages/server/src/app.ts`：历史对比独立限频为每用户每分钟 10 次。审核/恢复展示移出主线程；按预览 revision 和 NULL presentation 条件保存结果，防止旧展示覆盖新候选。
- worker await 后重新查询 Cookie/PAT、账号、管理员状态、成员、AI 开关及令牌范围；对比、只读 prepare、保存预览、冲突更新、恢复路径都在返回结果前校验。使用 `currentUser` 和 `requireRole`，不再次计入用户请求额度。发布 IMMEDIATE 事务及候选重新校验未改。
- `deploy/Dockerfile` 打包并复制 `change-worker.mjs`，生产 `server.mjs` 通过相邻入口加载 worker；源代码运行使用 tsx/cjs。

## 测试先行证据

- `B4-performance-red.log`：原同步版本的 5000 段比较、恢复审核展示、独立限频三条真实失败。
- `B4-performance-green.log`：初次实现后 2 文件 / 10 测试通过（当时为 3 条 B4 性能测试 + 7 条既有 change-presentation）。
- `B4-access-red.log`：前一轮新增的比较/恢复成员撤销用例各返回 200，真实失败。其最初预期 403 与现有「无成员隐藏资源」404 语义不符；本次将这两条 **本轮新增测试** 校正为 404，再执行红阶段。没有改 550 基线断言。
- `B4-reauth-red.log`：成员撤销比较/恢复 2 条 + Cookie 会话撤销比较/恢复/只读准备/保存预览 4 条，6 条真实失败（均错误返回 200）。之后才加入重新授权补丁。
- `B4-reauth-typecheck.log`：补丁后的 typecheck 通过。
- 缓存方向、LRU 项数、字节上限、同键合并、队列满 503：`change-worker.test.ts`，3 条。

## 基准与生产加载

`history-diff-benchmark.json` 完整保留旧同步测量，在 `workerMeasurement` 下附加 `B4-green-metrics.json` 的真实数据：5000 段、1,804,072 字节、5000 个变化；并发 health 12.44 ms，且比较当时尚未完成；首次比较 1350.03 ms，缓存响应 5.51 ms。测量基于 Fastify app.inject，未将其算作浏览器或真实 HTTP 基准；与历史夹具不同，不直接比较 CPU 总耗时。

`B4-production-bundle.log`：实际 esbuild 主入口/worker 输出后，运行不含 TypeScript 源码的 bundle，通过本地 HTTP 登录与 compare；返回 200。未运行 Docker 容器，未部署生产。

## 聚焦验证

- 重新授权补丁前：`B4-regression-green.log` 4 文件 / 20 测试通过，包含 change-presentation 与 SQLite 独立连接并发发布验证。
- 重新授权补丁后：`verify-B.log` 全量测试 612 条 / 89 文件，610 条通过，只有已披露的 B1/B2 基线断言冲突失败；B4 的 9 条性能/权限测试与 3 条 worker 测试全部通过，既有 change-presentation 与 SQLite 并发发布测试也通过。未额外重复聚焦运行。verify 因上述两条冲突返回非零，不能称整阶段通过；根任务另跑 build 并记录。

- 交付复现脚本：scripts/acceptance-production-bundle.ts（从本轮工作脚本归档，生产main/worker bundle本地HTTP smoke，无Docker）。
