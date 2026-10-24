# AT-01–AT-44 验收覆盖表

依据：`reference/BUILD_SPEC.md` §27，并按 `CODEX_FIX_GUIDE.md` 第 8 节保留推迟范围。更新日期：2026-10-24。

“自动化通过”只表示表中所列自动化标准与证据通过；API、SSR、jsdom 均不代替真实浏览器。部分覆盖不表示整项验收通过；“未实现”包括本轮明确推迟的功能或验收设施。部署和真实客户端连接须由人完成。

最终完整测试证据为 `outputs/verify-D.log`：108 文件、665 测试，663 通过、2 失败；C阶段历史记录为106文件/662测试、660通过/2失败。本轮没有宣称verify全通过。两项保留的旧断言冲突是版本作者缺省时仍期待内部编号，以及固定 v1 链接仍期待 v2 新建成员主题可见。D1 只重命名测试标题，不改断言、fixture、skip 或生产代码。D 阶段的完整验证与真实浏览器结果由 `FIX_REPORT.md` 和 `browser-acceptance.md` 单独记录；真实浏览器部分故事不扩大本表的规格覆盖结论。

以下路径相对于 `source/`。一个测试涉及多个验收项时，标题可含多个 AT 编号；编号只用于定位，不扩大该测试实际证明的范围。

| 编号 | 状态 | 对应测试文件 / 证据 | 已证明的行为与限制 |
| --- | --- | --- | --- |
| AT-01 | 自动化通过 | `packages/server/test/merge-acceptance.test.ts` | 两个作者修改不同段落，预览并发布同时保留两处修改，原版不变；SQLite 集成测试。 |
| AT-02 | 自动化通过 | `packages/server/test/merge-acceptance.test.ts`；`packages/core/src/merge.test.ts` | TM-3 同段不同位置标记合并，发布为组合文字；另有核心合并测试。 |
| AT-03 | 自动化通过 | `packages/server/test/merge-acceptance.test.ts`；`packages/server/test/operation-review.test.ts`；`packages/server/test/app.test.ts` | TM-2 未解决时阻止发布，keep_current、take_incoming、manual 三种最终发布结果均测试。 |
| AT-04 | 自动化通过 | `packages/server/test/concurrent-publication.test.ts`；`packages/server/test/operation-review.test.ts` | 正式版本变化或已保存候选被改后，旧预览发布返回 PREVIEW_STALE，拒绝额外写入。 |
| AT-05 | 自动化通过 | `packages/server/test/app.test.ts`；`packages/server/test/submission-input.test.ts`；`packages/server/test/concurrent-publication.test.ts` | 重试幂等提交与重复/并发发布返回同一份提交、同一版本；临时编号结果也稳定。 |
| AT-06 | 部分覆盖 | `packages/core/src/merge.test.ts`；`packages/server/test/operation-review.test.ts` | 核心覆盖 delete_modified、target_deleted、缺失插入锚点 append_end、恢复与放置；API 覆盖结构放置/恢复。没有把 MG-3、MG-4 及锚点失效 append_end/drop 全部组合逐一做成接口级验收。 |
| AT-07 | 自动化通过 | `packages/server/test/merge-acceptance.test.ts` | 恢复产生新 restore 版本，保留历史及 pending 提交，并按恢复后的正式版本重新评估待审内容。 |
| AT-08 | 自动化通过 | `packages/server/test/anchors.test.ts`；`packages/server/test/comment-selection.test.ts`；`packages/core/src/anchors.test.ts` | 发布后 ok/text_changed/block_deleted/lost 重定位、Unicode/上下文、移动、丢失通知去重及负责人迁移均有测试。固定链接的旧断言冲突另列 AT-32。 |
| AT-09 | 部分覆盖 | `packages/server/test/render-origin.test.ts`；`packages/server/test/app.test.ts`；`packages/server/test/assets.test.ts`；`packages/render/src/index.test.ts`；`packages/web/src/lint-rules.test.ts`；`packages/web/src/BlockRead.test.tsx` | 自动化覆盖恶意 HTML/SVG/链接清理、独立渲染域路由、CSP、sandbox、签名过期及 ESLint 禁止规则；没有在真实浏览器中完成恶意 iframe 读 Cookie/带 Cookie 请求/脚本执行的整套隔离验收，也没有逐一加载规格样本 9。 |
| AT-10 | 部分覆盖 | `packages/web/src/App-comment-selection.test.tsx`；`packages/web/src/inline-codec.test.ts` | 有 Unicode、组合期选词评论和文本往返的合成 DOM 测试；没有规格要求的 CDP Input.imeSetComposition/Input.insertText 编辑器测试，没有 Windows/macOS 四种输入法人工完成记录。 |
| AT-11 | 部分覆盖 | `packages/server/test/app.test.ts`；`packages/server/test/accounts-members.test.ts`；`packages/server/test/comment-permissions.test.ts`；`packages/server/test/comment-selection.test.ts`；`packages/server/test/b-auth.test.ts`；`packages/server/test/concurrent-publication.test.ts` | 多类接口验证角色、成员关系、PAT 范围、CSRF 与 Origin，发布时重验身份；尚无逐个接口乘以 owner/editor/commenter/viewer/非成员/未登录的完整矩阵。 |
| AT-12 | 部分覆盖 | `packages/server/test/concurrent-publication.test.ts` | 真实 HTTP 并发下 SQLite 两个 open 预览只有一个发布成功，另一方 PREVIEW_STALE；PostgreSQL 验证本轮推迟。 |
| AT-13 | 自动化通过 | `packages/core/src/spec-html-property.test.ts`；`packages/core/src/spec-html.test.ts` | fast-check 120 次固定 seed，生成文档每次含全部块类型，HTML 往返规范化相等且源输入不变；包含主题编号碰撞情况。 |
| AT-14 | 自动化通过 | `packages/core/src/diff-property.test.ts`；`packages/core/src/diff.test.ts` | fast-check 120 次固定 seed，独立表格、图表、列表文档的增删、排序、跨模块移动，diff 后 applyOpsStrict 经编号映射等于目标；输入不变。生成器范围在测试中明确。 |
| AT-15 | 部分覆盖 | `packages/web/src/i18n.test.ts`；`packages/web/src/app/error-translation.test.ts`；`packages/web/src/Administration-i18n.test.tsx`；`packages/web/src/ShareLinks-i18n.test.tsx`；`packages/server/test/outbox.test.ts` | 两份词典键集合、16 命名空间、静态键调用扫描、旧内联写法扫描、语言优先级/独立渲染、Intl、错误码及中英通知邮件均测试；不等同于全部主要页面切换语言和所有邮件模板的真实浏览器验收。 |
| AT-16 | 部分覆盖 | `packages/server/test/merge-acceptance.test.ts`；`packages/server/test/app.test.ts`；`packages/server/test/comment-selection.test.ts`；`packages/web/src/App-comment-selection.test.tsx`；`packages/web/src/VersionComparison.test.tsx` | 登录、导入、编辑提交、评论、审核冲突、历史、恢复分散测试存在；未执行完整“样本 2 + 两模块 + @ + 第二账号冲突 + 恢复 v1”的单一浏览器故事。历史组件保留 1 条旧作者编号断言失败。D 浏览器流程由独立记录说明，不能用分散测试代替。 |
| AT-17 | 未实现 | 无完整验收测试；`packages/server/test/snapshot-submissions.test.ts` 的 db.backup 仅用于迁移 fixture | SQLite/PostgreSQL 完整备份→删除→恢复→文档/版本/评论/附件一致性本轮推迟；迁移测试中的数据库复制不算备份恢复验收。 |
| AT-18 | 部分覆盖 | `packages/core/src/import-patterns.test.ts`；`packages/server/test/import-source.test.ts`；`packages/server/test/import-images.test.ts`；`packages/server/test/app.test.ts` | 合成 HTML 的结构识别、图片、原始来源、确认和安全转换有测试；交付 reference/ 只有 BUILD_SPEC.md，未找到规格 12 个独立样本，也无 12 样本报告/快照全覆盖测试。 |
| AT-19 | 部分覆盖 | `packages/server/test/app.test.ts`（显式 seed 开关）；其他集成 fixture 使用 seed 数据 | 能验证未显式 seed 时不创建演示账号；未对演示 A/B/C clean、E text_overlap、F requested 的整组结果作专门断言。生产禁 seed 的 B11 测试是额外安全覆盖，不能替代本项。 |
| AT-20 | 人工待做 | 无干净 Linux + HTTPS 部署完成记录 | 按指导禁止部署生产；本轮本机运行不等于干净 Linux install.sh 部署。 |
| AT-21 | 自动化通过 | `packages/server/test/mcp.test.ts`；`packages/server/test/app.test.ts`；`packages/server/test/cli-auth.test.ts`；`packages/server/test/accounts-members.test.ts` | 缺 scope、超文档范围、已撤销、已过期、用户停用的 PAT 行为；设备授权 PAT 与网页 PAT 使用同一权限体系。OAuth 另列 AT-37。 |
| AT-22 | 部分覆盖 | `packages/server/test/mcp.test.ts`；`packages/server/test/ai-tasks.test.ts`；`packages/cli/src/mcp-relay.test.ts` | 工具列表无发布/拒绝/恢复等正式版本变更工具；评论、提交、预览、任务完成/AI 建议路径有正式版本未变断言。没有为每个工具的每次正常与失败调用统一断言 current_version 不变。 |
| AT-23 | 自动化通过 | `packages/server/test/ai-tasks.test.ts`；`packages/server/test/submission-input.test.ts` | 带任务的文档元数据、其他模块、排序、增删模块等越界返回 TOKEN_SCOPE；包含越界后同请求又撤销该修改的操作序列。 |
| AT-24 | 部分覆盖 | `packages/server/test/ai-tasks.test.ts` | 人为到期的租约回收、旧 claim 写入隔离、fail 回 approved、3 次尝试后的 failed 与审计记录有测试；测试组合为 expired/failed/expired，未分别证明精确 30 分钟边界和连续 3 次显式 fail 的全部标准。 |
| AT-25 | 部分覆盖 | `packages/server/test/ai-tasks.test.ts`；`packages/server/test/guests.test.ts`；`packages/server/test/app.test.ts` | commenter、令牌、外部访客 @AI 保持 requested 且需人批准；未找到对“批准前 claim 必须拒绝”的专门接口断言。 |
| AT-26 | 自动化通过 | `packages/server/test/mcp.test.ts`；`packages/server/test/ai-tasks.test.ts`；`packages/server/test/app.test.ts` | AI 关闭时 MCP 读取/评论报 AI_DISABLED；@AI 写系统说明且不创建任务。 |
| AT-27 | 部分覆盖 | `packages/server/test/submission-input.test.ts`；`packages/server/test/operation-review.test.ts`；`packages/core/src/reconcile.test.ts`；`packages/core/src/merge.test.ts` | HTML 模块插入/替换/删除、强弱匹配、重复/外来编号、uncertain accept/drop 与发布候选有覆盖；尚无按 RC-1 至 RC-4 原样组织的完整接口级案例组。 |
| AT-28 | 部分覆盖 | `packages/cli/src/index.test.ts`；`packages/cli/src/submission-plan.test.ts`；`packages/cli/src/native-submission-integration.test.ts` | 本地 set/move/delete/insert 规划与真实本地 HTTP pull/submit、稳定编号及丢响应重试有覆盖；没有一个完整命令行进程故事同时串起四种文件改动再 submit。 |
| AT-29 | 部分覆盖 | `packages/server/test/ai-tasks.test.ts`；`packages/cli/src/mcp-relay.test.ts` | resolve 建议需完成任务后由负责人采用，候选值正确，revision/withdrawal/version/replacement 导致过期；测试明确采用不自动发布，未继续发布并断言最终正式版本等于建议。 |
| AT-30 | 部分覆盖 | `packages/cli/src/mcp-relay.test.ts`；`packages/server/test/mcp.test.ts` | SDK 经 HTTP 与 stdio relay 覆盖读取、评论/回复、提交/撤回、任务、预览、建议与错误；A2 还覆盖设备令牌直接 initialize 及 SDK relay。没有每个已注册工具逐一“正常 + 越权”并逐项比较两种传输的全矩阵。 |
| AT-31 | 人工待做 | 无 Claude Code/Codex 外部真实客户端任务完成记录 | 本地 SDK/stdio fixture 和 D2 mdoc login→mcp 不能替代两种真实客户端完成 AI 任务。 |
| AT-32 | 部分覆盖 | `packages/server/test/guests.test.ts`；`packages/server/test/share-links.test.ts`；`packages/server/test/pinned-comments.test.ts`；`packages/server/test/comment-selection.test.ts` | 隐藏待审/成员/其他文档、链接与会话撤销/过期、固定版本评论创建版本过滤有自动化。C/D gate 保留 1 条旧用例失败：v2 新建成员主题被正确过滤为不存在，旧断言仍要求固定 v1 响应含该主题；未改断言。 |
| AT-33 | 自动化通过 | `packages/server/test/guests.test.ts` | 评论链接所有资源需验证，验证码/会话绑定准确链接，5 次错误锁定跨重发、链接与重启保持。 |
| AT-34 | 自动化通过 | `packages/server/test/outbox.test.ts`；`packages/server/test/digests.test.ts`；`packages/server/test/notifications.test.ts`；`packages/server/test/security-mail.test.ts` | 事务队列、六次失败退避时间、租约恢复、事件去重、通知偏好与失效接收人取消均有本地 fixture 测试。 |
| AT-35 | 部分覆盖 | `packages/server/test/feishu.test.ts` | 注入的本地请求 fixture 校验卡片格式、签名、去重、Lark host；不是实际监听端口的假服务器，FEISHU_BASE_URL 环境入口切换未专门测试；未访问真实飞书/Lark。 |
| AT-36 | 部分覆盖 | `packages/server/test/exports.test.ts`；`packages/server/test/archive.test.ts`；`packages/server/test/assets.test.ts`；`packages/exporter/src/app.test.ts`；`packages/render/src/index.test.ts` | HTML 安全渲染、已发布快照、ZIP 资产往返、PDF 二进制通路与失败隔离有测试；PDF 服务注入假渲染器/fixture bytes，不能认定真实 Chromium/Docker PDF 渲染已完成。 |
| AT-37 | 自动化通过 | `packages/server/test/oauth.test.ts`；`packages/server/test/oauth-client.test.ts` | PKCE、verifier/client/redirect/resource 绑定、授权范围、撤销、refresh 轮换及旧 refresh 重放整链撤销；元数据 DNS/URL 等安全边界用 fixture 验证。 |
| AT-38 | 未实现 | 无模块负责人预览/发布范围验收 | 指导第 8 节明确推迟；不以普通文档 owner 的权限测试代替。 |
| AT-39 | 未实现 | 无自动发布调度验收 | 指导第 8 节明确推迟；不以人工发布或通知测试代替。 |
| AT-40 | 未实现 | 无 PostgreSQL 全量测试运行记录 | 指导第 8 节明确推迟；所有 SQLite 测试通过也不能认定 PostgreSQL 通过。 |
| AT-41 | 部分覆盖 | `packages/render/src/index.test.ts`；`packages/server/test/render-origin.test.ts` | 渲染函数输出空 sandbox/allow-scripts，默认不含 allow-same-origin；服务器拒绝 RAW_SCRIPTS_UNAVAILABLE。尚无从独立域配置、用户开启脚本到浏览器隔离的完整功能验收。 |
| AT-42 | 人工待做 | 无独立人员 30 分钟部署记录 | 必须由未参与开发的人按文档实际部署；本轮未执行。 |
| AT-43 | 部分覆盖 | `packages/core/src/spec-html-property.test.ts`；`packages/core/src/spec-html.test.ts`；`packages/core/src/import-patterns.test.ts`；`packages/render/src/index.test.ts`；`packages/web/src/editor-model.test.ts`；`packages/web/src/BlockEditor.test.tsx`；`packages/server/test/import-source.test.ts` | 时间线/指标卡的模型 HTML 往返、渲染类名、编辑器类型/创建、合成 HTML 识别有测试；无规格样本 11/12 的正式快照、完整 MG-8 与真实编辑端到端组合验收。 |
| AT-44 | 未实现 | 无 hcd:remote 编号插件/模块 ProseMirror/NodeView 验收 | 指导第 8 节明确推迟编辑器架构；普通内容模型编号和 HTML 往返测试不冒充 Yjs 预留约束通过。 |

## D1 修改边界与校验

仅补验收编号到原有测试标题；保留原有 A/B/C 任务编号和描述，不改任何既有 expect、fixture、跳过标记或测试数量。已存在且前缀正确的 AT-01/02/03/04/07/12/13 标题保持原样。AT-15 原来位于 C3 后的编号移至标题开头。一个标题变化不等于新增一个测试，it.each 展开数量不变。

本次重命名 263 个测试声明，涉及 54 个文件：

- `packages/cli/src/index.test.ts`（7 个标题）
- `packages/cli/src/mcp-relay.test.ts`（11 个标题）
- `packages/cli/src/native-submission-integration.test.ts`（3 个标题）
- `packages/cli/src/submission-plan.test.ts`（15 个标题）
- `packages/core/src/anchors.test.ts`（4 个标题）
- `packages/core/src/diff-property.test.ts`（1 个标题）
- `packages/core/src/diff.test.ts`（3 个标题）
- `packages/core/src/import-patterns.test.ts`（4 个标题）
- `packages/core/src/merge.test.ts`（15 个标题）
- `packages/core/src/model.test.ts`（2 个标题）
- `packages/core/src/reconcile.test.ts`（7 个标题）
- `packages/core/src/spec-html.test.ts`（4 个标题）
- `packages/exporter/src/app.test.ts`（2 个标题）
- `packages/render/src/index.test.ts`（2 个标题）
- `packages/server/test/accounts-members.test.ts`（8 个标题）
- `packages/server/test/ai-tasks.test.ts`（9 个标题）
- `packages/server/test/anchors.test.ts`（1 个标题）
- `packages/server/test/app.test.ts`（10 个标题）
- `packages/server/test/archive.test.ts`（5 个标题）
- `packages/server/test/assets.test.ts`（3 个标题）
- `packages/server/test/b-auth.test.ts`（1 个标题）
- `packages/server/test/cli-auth.test.ts`（6 个标题）
- `packages/server/test/comment-permissions.test.ts`（2 个标题）
- `packages/server/test/comment-selection.test.ts`（11 个标题）
- `packages/server/test/concurrent-publication.test.ts`（4 个标题）
- `packages/server/test/digests.test.ts`（4 个标题）
- `packages/server/test/exports.test.ts`（8 个标题）
- `packages/server/test/feishu.test.ts`（11 个标题）
- `packages/server/test/guests.test.ts`（7 个标题）
- `packages/server/test/import-images.test.ts`（2 个标题）
- `packages/server/test/import-source.test.ts`（2 个标题）
- `packages/server/test/mcp-list-scope.test.ts`（1 个标题）
- `packages/server/test/mcp.test.ts`（9 个标题）
- `packages/server/test/notifications.test.ts`（3 个标题）
- `packages/server/test/oauth-client.test.ts`（4 个标题）
- `packages/server/test/oauth.test.ts`（18 个标题）
- `packages/server/test/operation-review.test.ts`（5 个标题）
- `packages/server/test/outbox.test.ts`（5 个标题）
- `packages/server/test/pinned-comments.test.ts`（2 个标题）
- `packages/server/test/render-origin.test.ts`（6 个标题）
- `packages/server/test/security-mail.test.ts`（3 个标题）
- `packages/server/test/share-links.test.ts`（3 个标题）
- `packages/server/test/snapshot-submissions.test.ts`（4 个标题）
- `packages/server/test/submission-input.test.ts`（8 个标题）
- `packages/web/src/Administration-i18n.test.tsx`（1 个标题）
- `packages/web/src/BlockEditor.test.tsx`（1 个标题）
- `packages/web/src/BlockRead.test.tsx`（1 个标题）
- `packages/web/src/CliAuth.test.tsx`（4 个标题）
- `packages/web/src/ShareLinks-i18n.test.tsx`（1 个标题）
- `packages/web/src/app/error-translation.test.ts`（2 个标题）
- `packages/web/src/editor-model.test.ts`（1 个标题）
- `packages/web/src/i18n.test.ts`（4 个标题）
- `packages/web/src/inline-codec.test.ts`（2 个标题）
- `packages/web/src/lint-rules.test.ts`（1 个标题）

D1 轻量检查实际结果：

- TypeScript AST 检查 54 个修改文件：语法错误 0；抹去测试标题后，与重命名前文件内容逐字相同，因此断言、fixture、skip/执行逻辑未变。
- `pnpm exec vitest list --json` 成功发现 **662 条测试 / 106 个文件**，与 C 阶段测试数量一致；其中 **290 条展开后的测试**现在以 AT 编号开头（重命名 263 个声明，参数化测试会展开；其余已有编号保持不变）。这是发现检查，没有执行这些测试，不写成“662 条通过”。
- `pnpm typecheck` 通过。
- 覆盖表编号检查：AT-01–AT-44 恰好各 1 行，缺失/重复均为 0；表内所有测试文件路径存在。
- 没有启动真实外部服务；没有新增测试、skip 或修改生产功能。全量 D 阶段 `pnpm verify` 由主代理执行，其真实结果单独记录。

D1 前端标题排版收尾：对本次涉及的 10 个 web 测试文件运行 Prettier（printWidth 120）；只有 `i18n.test.ts`、`CliAuth.test.tsx`、`BlockEditor.test.tsx` 产生排版变化，其余 7 个保持不变。Prettier check 通过；排版前后全部测试 AST 一致，最终标题值、断言与 fixture 逻辑不变。`packages/web` 的 171 个 TS/TSX/CSS 文件，加 `src/main.tsx` 共 172 个前端文件，最大 379 行、120 字符；超过 400 行或 120 字符的文件均为 0。

D首轮收尾新增C8目录记忆的2项UI回归后，当时共664测试/107文件；D1发现检查的662/106是当时真实历史数字。当时前端173个TS/TSX/CSS文件，最长379行/120字符；原2913条断言全部保留，见`assertion-integrity.json`。

D2截图复核另补C8紧凑侧栏的1条真实Chrome回归，最终665测试/108文件，663通过/2旧断言失败；3项Chrome组件/CSS布局测试不冒充D2全流程。最终前端174文件、最长379行/120字符，当前3352条断言，原2913条全部保留。C5更多菜单的真实Chrome回归在独立脚本中，不计Vitest测试数。
