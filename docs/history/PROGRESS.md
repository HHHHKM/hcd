# HCD 当前进度 — 2026-10-25

进度快照：`hcd-ai-test-20261025-686`，按用户要求提前打包；本轮任务来源为包根`CODEX_UI_GUIDE.md`及`FRONTEND_REDESIGN.md`。完整状态以`../UI_REPORT.md`为准。

- 已完成E0–E3；E1的B1/B2已获批准并更新，两项hook warning已修。
- E4的11组样式已实施，并补修上传框/危险动作；最新verify退出0，686/686测试、114文件通过。仍有3条获批build warning。
- E4当前最终代码尚缺危险动作的真实颜色检查、相关截图更新及完整视觉连续两轮。最后38通过发生在此最新修改之前。
- E5区域01/02曾验证，随后为了E4补漏已完整逆序回滚；主题层仍在，尚未完成合并/清理。迁移清单与备份均保留。
- E6仅只读预查，未实施或Safari验收；E7未做。此次为提前进度包，非完整E8最终验收。

证据：`outputs/verify-E4-followup-final.log`、`outputs/E4-followup-import-summary.json`、`outputs/E4-theme-override-audit.md`、`outputs/E5-paused-for-E4-followup.json`。

---

## 以下为A–D输入快照的历史记录（非当前状态）

# HCD 实现与修复进度

交付快照：`hcd-ai-test-20261024-665`，2026-10-24。A→B→C→D 修复与验证记录已完成，最终 verify 保留 2 条旧断言冲突失败。

本轮唯一任务来源为根目录 `CODEX_FIX_GUIDE.md`。指导中的 `source/` 指本代码根目录，完整规格为交付包的 `../reference/BUILD_SPEC.md`；D-1–D-4 已写入 `DECISIONS.md`。历史进度中的后续开发建议和自动跟进状态已过时，本轮没有启动或恢复 heartbeat。

## 当前验证状态

本轮环境：macOS Darwin 27.0.0 arm64、Node.js v24.21.0、pnpm 11.25.0。逐项修复、真实红绿日志、非断言测试调整、流程偏差和迁移见 `../FIX_REPORT.md`。

| 阶段 | 实际测试结果 | 其他检查 | 证据 |
| --- | --- | --- | --- |
| A | 561 项 / 74 文件，全部通过 | 安全扫描、类型检查、构建通过；初次本地监听受限后在允许环境重跑 | `outputs/verify-A.log` |
| B | 612 项 / 89 文件，610 通过、2 条旧断言冲突失败 | lint/安全和类型检查通过；verify 停在测试，单独构建通过 | `outputs/verify-B.log`、`outputs/build-B.log` |
| C | 662 项 / 106 文件，660 通过、同 2 条冲突失败 | ESLint 无 error、2 条依赖 warning；安全、27 对对比度、类型检查通过；单独构建通过 | `outputs/verify-C.log`、`outputs/build-C.log` |
| D | 665 项 / 108 文件，663 通过、同 2 条冲突失败；verify 退出 1 | lint 0 error / 2 warning，安全、27 组对比度、类型检查通过；单独 build 退出 0 | `outputs/verify-D.log`、`outputs/build-D.log`、下列验收报告 |

D 阶段 hooks warning 来自 `AuthLink` 缺 `t` 与 `SpaceIntegrations` 缺 `report`；单独构建主包 646.84kB、gzip 202.64kB，有 Vite >500kB warning。verify 在测试失败后未执行 build，单独 build 通过不能改写成完整 verify 成功。测试中 3 项 Chrome CSS/布局检查不等于 D2 真实应用全流程。

以下原有断言与明确的新要求冲突，均保留且未跳过：

- B1：`VersionComparison.test.tsx` 期待 `Created by: u_owner`；正确行为应显示名字或“未知用户 / Unknown user”，不显示内部编号。
- B2：服务器 `comment-selection.test.ts` 的旧 “preserving discussion bodies” 期待固定 v1 分享包含 v2 创建的成员根评论，与 D-1 矛盾。

这两项已记入修复报告“待决定”，等待负责人允许更新过时断言。D最终对原基线2,913条断言的TypeScript AST多重集合复核全部保留，当前3,352条，未匹配0。

## 本轮已完成的工程变更

- A1：`TRUST_PROXY` 显式配置可信 IP/CIDR，默认不信任转发头；本地代理限频隔离、伪造头和部署模板已有回归。
- A2：网页 PAT、设备授权、MCP 和 CLI 共用 `hcd_pat_` 加 32 位 base32 格式；设备令牌连 MCP 的端到端自动化已覆盖。
- B1–B4：版本返回作者姓名并隐去内部编号；固定分享按独立 `created_version` 过滤，访客主题的回复使用确认例外；忘记密码限频符合指导；历史对比移入 worker，使用有界队列、LRU 缓存、并发合并与用户限频，并在异步完成后重新校验权限。旧“约 1.4 秒同步阻塞仍未修”的结论已过时。
- B5：Pino JSON 请求日志记录路由模板、状态、耗时、actor 和请求编号，排除原始路径、查询、正文及凭据；`LOG_LEVEL` 可配置。
- B6：Cookie 专用 logout-all 撤销全部用户会话、保留 PAT；个人设置有页内确认。
- B7：登录后通过当前密码修改密码，错误密码计入登录限频；成功保留当前会话，撤销其他会话和未用重置链接；表单有标签与错误反馈。
- B8：令牌最近使用时间/IP 增量迁移、接口返回、设置页展示；同令牌每 60 秒最多写一次。
- B9–B11：参与主题的 commenter 可解决/重开；MCP 内部请求使用不可伪造标记避免重复扣限额；生产环境演示种子配置拒绝启动。
- C1/C2：App 和大型组件拆为 app/features/shared；全局 context、可取消请求、路由状态同步覆盖文档、空间、历史、对比、审核、设置、query/hash 和前后退，迟到响应不得覆盖新页面。Prettier、ESLint 和 hooks 规则纳入 verify。
- C3/C4：i18next/react-i18next、16 个命名空间、两语同键词典、Intl；浅深色设计令牌与系统主题偏好；字号下限 12px、正文 15–16px，27 对对比度检查。
- C5–C8：主操作与可键盘使用的更多菜单、手机阅读控件、页内危险删除确认、可见回复/解决及外部主题提示；访客仅精确文字高亮；桌面正文至少 680px，目录和讨论可收起并在本机保存。D 收尾新增 2 条目录持久化 UI 测试，真实复现重新挂载后丢失选择后修复，存储不可用时仍正常。

B5–B8 已实现，已从功能缺口移除。C 的结构和样式验收含真实 Chrome CSS/布局检查，但这些检查不等于 D2 应用流程验收。C门禁时172个、D收尾174个TS/TSX/CSS文件最长379行、120字符；JSON词典属于资源数据。

## 既有实现范围

现有系统包括结构化 JSON 文档和 Spec HTML、草稿/提交/保守合并/不可变版本/恢复、评论锚点与固定版本分享、HTML/ZIP 和图片处理、角色/PAT/OAuth/MCP、CLI 设备授权与提交收据、账户管理、本地 fixture 支持的邮件/飞书队列、签名独立渲染源与导出任务。存在实现不表示完整规格验收完成；每项状态以 `outputs/AT-coverage.md` 为准。

已有安全边界持续保留：同源写标记、scrypt、凭据哈希、渲染域隔离与短期签名、raw CSP/sandbox、SVG 白名单、ZIP 路径/CRC/压缩边界、OAuth PKCE/轮换检测、IMMEDIATE 发布重验身份、提交幂等和冲突提交整体排除。

## D 阶段验收证据

- `outputs/browser-acceptance.md`：当前版本真实浏览器步骤、360/805/1440、浅深色截图和未执行项。旧快照截图不能证明本轮修改后的结果。
- `outputs/cli-acceptance.md`：本地 `mdoc login`→`mdoc mcp` 的实际命令、结果与边界。
- `outputs/AT-coverage.md`：各 AT 编号状态、对应文件和人工待做项目。
- `../FIX_REPORT.md`：最终安装/verify/build 退出码、真实测试数、遗留失败和打包说明。

实际 Chrome 核心应用流程通过；各宽度、主题、截图及未执行分支以最终 `outputs/browser-acceptance.md` 为准。本地 CLI 已真实完成 `mdoc login --no-open`→Chrome 批准→`mdoc mcp`，initialize、列出 20 个工具和 `read_document` 均通过，详见 `outputs/cli-acceptance.md`；自动系统浏览器开启未测。所有本轮实操只用临时数据库和本地 SMTP/飞书/OAuth fixture，不连接真实外部服务，不部署生产。真实 OAuth 连接器、实际 PDF/容器隔离、物理触摸/IME、完整导入/权限矩阵和完整 BUILD_SPEC 验收的未测部分继续明确标注。

## 指导第 8 节：本轮不做与待决定

- 模块负责人、自动发布、PostgreSQL、备份恢复、审计日志：规格后续功能；如有在研代码保持原状，本轮不扩展。
- 每模块 ProseMirror、远端事务编号、NodeView 等完整编辑器架构（AT-44）：另行安排。
- JPEG 末尾附加数据被拒：保留现有校验，不放宽。
- 被移出文档的编辑者，其待审提交是否仍可发布：待产品决定。
- 每邮箱 5 次失败锁定 15 分钟可被恶意触发：规格取舍，本轮不改。
- 整体视觉改版：由 Claude 在本轮之后进行，本轮只做前端修复与工程化。

超出指导又需要产品判断的事项写入 `../FIX_REPORT.md`“待决定”，继续其余授权任务。不能将历史文档中的“下一步”当作新增任务或恢复自动化的授权。
