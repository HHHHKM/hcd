# HCD 测试计划

快照：`hcd-ai-test-20261024-665`。本轮按 `source/CODEX_FIX_GUIDE.md` 完成 A→B→C→D 修复交付；完整规格见 `reference/BUILD_SPEC.md`。

最终 D 阶段完整验证为 665 项 / 108 文件：663 通过、2 条相同旧断言冲突失败，`verify-D.log` 退出码 1。ESLint 0 error / 2 warning（AuthLink 缺 `t`、SpaceIntegrations 缺 `report`），安全扫描、浅深色 27 组对比度和类型检查通过。verify 未进入 build；单独 `build-D.log` 退出码 0，主包 646.84kB / gzip 202.64kB，有 Vite >500kB 提示。实际 Chrome 核心流程和本地设备授权→MCP 已通过；各宽度、主题与分支范围以最终验收报告为准，不宣称完整 BUILD_SPEC 或全量 verify 通过。

## 证据和判定方法

- `FIX_REPORT.md`：逐阶段实际命令、结果、失败项、迁移、测试流程披露和待决定项。
- `source/outputs/AT-coverage.md`：每个 AT 的自动化通过 / 部分覆盖 / 未实现 / 人工待做状态及文件。下表为复测重点，不替代逐项覆盖表。
- `source/outputs/browser-acceptance.md`：真实浏览器的步骤、宽度、主题、截图与遗漏。早期截图不作为修改后页面的验收。
- `source/outputs/cli-acceptance.md`：本地设备授权、令牌与 MCP 命令执行证据。API、jsdom、SSR 或组件测试不能替代真实浏览器或 CLI 进程结果。

明确未执行的项目不能记为通过。verify 包含 3 项 Chrome CSS/布局测试，它们不替代 D2 真实应用全流程；本地 CLI 已实际完成 login --no-open→Chrome 批准→MCP initialize、列出 20 工具和 read_document。仅使用临时数据库、临时文件和本地 SMTP/飞书/OAuth fixture；不发真实消息，不部署生产环境。

## 风险与复测矩阵

| 优先级 | 范围 | 复测重点 | 当前证据边界 |
| --- | --- | --- | --- |
| P0 | 草稿与发布隔离 | 两编辑者同基线编辑；保存/提交不改正式版；负责人预览发布才产生新版本 | 核心/API 回归；D 浏览器结果单列 |
| P0 | 合并冲突 | 不同段落、同段不同位置和重叠；未解决提交整体排除；keep_current/take_incoming/manual 含格式 | AT-01/02/03 HTTP 与核心测试；完整结构组合按 AT 表 |
| P0 | 并发与幂等 | 不同 open 预览只能一次发布；同预览并发返回同版本；提交重试不重复 | 独立 SQLite worker/HTTP 测试；不推导 PostgreSQL 支持 |
| P0 | 撤权竞态 | 等锁时退出、禁用、降权，拒绝后不写 head/历史/待审/通知；异步历史读取完成后再校验权限 | 独立连接并发与 B4 权限回归；非每接口完整矩阵 |
| P0 | 固定版本分享 | v2 成员根评论对固定 v1 不可见；v1 评论可见；访客发起主题的全部回复可见；不可见父评论返回 404；不返回 currentVersion | B2 API/迁移/UI 回归；D 浏览器验收单列 |
| P0 | 账户与令牌 | logout-all 撤销全部 Cookie 会话且保留 PAT；改密校验旧密码、保留当前会话、撤销其他会话及重置链接；令牌使用时间/IP 每分钟最多写一次 | B6/B7/B8 自动化与旧库升级覆盖；D 设置页实操单列 |
| P0 | 限频与真实 IP | 仅信任配置代理；不同转发客户端隔离；忘记密码统一响应且按邮件/IP限频；MCP 内部调用不重复扣额 | A1/B3/B10 自动化；拒绝伪造内部标记和未信任转发头 |
| P0 | 历史恢复 | 新增版本、不覆盖历史；保留 pending；恢复后按新 head 重新预览 | AT-07 HTTP；完整浏览器恢复另列 |
| P0 | 权限隔离 | owner/editor/commenter/viewer/非成员/未登录；PAT/OAuth 范围、AI 开关、私有草稿；参与主题者才可解决 | 角色、范围和 B9 定向回归；完整逐接口六身份矩阵按 AT 表 |
| P1 | 请求日志与启动 | JSON 路由模板/状态/耗时/actor/request ID；不含原始路径、查询、正文、凭据；生产演示种子拒绝启动 | B5/B11 定向自动化；LOG_LEVEL 可控制级别 |
| P1 | 历史对比性能 | 大历史对比时其他请求仍可响应；缓存命中；并发合并；有界队列及用户限频；过载和超时明确错误 | B4 worker、LRU 与异步服务测试；旧“约 1.4 秒同步未修”已过时 |
| P1 | HTML/ZIP 往返 | 14 块、嵌套容器、Unicode/BR/marks、表图引用、主题碰撞；路径/CRC/hash/大小边界；冻结导出快照 | 固定种子 120 文档属性测试及定向回归；全部导入样本按 AT 表 |
| P1 | 评论与访客定位 | 表格、嵌套列表、重复文本、surrogate、跨字段、过期锚点；保留正文且无虚假高亮；访客仅高亮精确文字 | API、DOM 和 CSS 回归；D 实际选词、360/1440 截图单列 |
| P1 | 路由与异步状态 | 文档/空间/历史/对比/审核/设置刷新与前后退；query/hash；快速切文档取消旧请求；旧响应不得覆盖新页 | C1/C2 集成与时序回归；D 浏览器结果单列 |
| P1 | 双语、主题与布局 | 词典键一致、Intl；系统浅深色及本机偏好；字号≥12px；正文15–16px；360/805/1440 无截断；1280/1440 正文≥680px | C3/C4 扫描、27 对对比度、组件与 Chrome CSS 测试；非 D 完整流程验收 |
| P1 | 交互可用性 | 键盘更多菜单、Esc/焦点；手机隐藏编辑发布；删除页内确认；外部主题回复警告；目录/评论收起持久化 | C5/C6/C8 回归；真实触摸/IME 未由桌面视口检查证明 |
| P1 | CLI/MCP/OAuth | mdoc login→mdoc mcp；hcd_pat_+32 位 base32；pull/diff/submit/retry/receipts/cancel；账户绑定与撤销 | A2 自动化及 D 本地 CLI 实操通过；自动浏览器开启未测；真实外部 OAuth 不在本轮 |
| P1 | 外部集成、raw/PDF | 本地邮件/飞书队列重试；独立渲染源、短期签名、无主站 Cookie；真实 PDF/隔离需要独立证据 | fixture 和协议测试不证明真实送达、Chromium PDF 或生产部署 |

## 两条保留失败

1. `packages/web/src/VersionComparison.test.tsx` 旧断言要求 `Created by: u_owner`；B1 明确要求名字或 Unknown user，禁止内部编号。
2. `packages/server/test/comment-selection.test.ts` 的旧 “preserving discussion bodies” 断言要求固定 v1 返回 v2 创建的成员根主题，和已确认 D-1 冲突。

两条均未改断言、未跳过；记录在 `FIX_REPORT.md`“待决定”。复测应复现并如实报告，不能将它们计为已通过。

## 指导第 8 节的推迟项

- 模块负责人、自动发布、PostgreSQL、备份恢复、审计日志：后续功能，保留已有或在研代码，本轮不扩展。
- 每模块 ProseMirror、远端事务编号、NodeView 等完整编辑器架构（AT-44）。
- JPEG 末尾附加数据拒绝规则暂不改变。
- 已移出文档的编辑者，其待审提交是否仍可发布：待产品决定。
- 每邮箱 5 次失败锁定 15 分钟可能遭恶意触发：规格取舍，暂不改。
- 整体视觉改版由 Claude 在本轮之后进行。

物理设备触摸/IME、完整权限与导入样本矩阵、真实 OAuth/PDF、干净 Linux/容器/HTTPS 部署的未验收部分按 AT 表和验收报告保留。任意 HTML 无损可编辑、私有未提交草稿引用评论不属于本轮承诺。AT-35 的本地假飞书服务覆盖不等于真实租户送达。

## 独立复测命令

在新的临时目录解压后，于 `source/` 执行并保留日志与退出码：

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm exec vitest run packages/server/test/merge-acceptance.test.ts packages/server/test/concurrent-publication.test.ts
pnpm exec vitest run packages/core/src/spec-html-property.test.ts packages/core/src/spec-html.test.ts packages/core/src/model.test.ts
pnpm exec vitest run packages/web/src/SharedDocument.test.tsx packages/web/src/comment-selection.test.tsx
```

浏览器流程按指导 D2 完整记录：登录→阅读→选词评论→编辑提交→负责人审核发布→历史对比→固定 v1 访客链接→设置改密码与退出全部设备，覆盖 360/805/1440 和浅深色；没有实际执行的组合写明原因。新增缺陷先保留会失败的回归测试，再修复；不改既有断言。超出指导且需要产品判断的事项写入“待决定”，继续其他工作。
