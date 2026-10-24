# 发布说明 · HCD 0.1.0（开发测试版）

日期：2026-10-25　基线：Codex 的 `hcd-ai-test-20261025-686` 进度包　许可：MIT

> 本版本由 **Claude（Anthropic）与 Codex（OpenAI）共同完成**，在项目负责人 **Alkaid** 的指挥下接力进行：Codex 写产品代码与测试，Claude 做独立审查、写修复与界面规格、重做前端视觉，并在本版本修完 686 包遗留的缺陷。详见 [AUTHORS.md](../AUTHORS.md)。

**一句话状态：** Codex 已在 macOS 上完成冻结锁文件安装、完整 verify（114 个文件 / 686 项测试）、45 张基线逐张审阅与更新、连续两轮完整视觉回归，以及五个真实 Chrome / CLI 验收脚本。各最终命令均退出 0；失败轮次和环境限制完整保留在第 3.3 节。GitHub 上传、首轮 Linux CI 和远端全新克隆复验均已完成；仓库先建 Private，随后按 Alkaid 的明确指示公开。未部署服务器。

---

## 1. 这一版相对 686 改了什么

686 是 Codex 完成 E0–E4 后的进度包（114 个测试文件 / 686 项测试通过）。Claude 复审后发现 6 类遗留问题（下表第 1–6 项），本版逐一修复；第 7–8 项是按 REL-2 决定做的对齐。改动全部是展示层（CSS 与少量标记），**没有改服务器接口、核心数据结构或业务确认流程**。

| # | 问题（686） | 修复 | 主要文件 |
| --- | --- | --- | --- |
| 1 | CLI 设备授权码被拆成逐字符格子（装饰性标记），复制/朗读/断言都拿不到完整的 `ABCD-EFGH`，并与 665 原有 SSR 测试 `CliAuth.test.tsx` 冲突 | 验证码改为**一个纯文本节点**，用样式做成药丸形；`innerText` 即为精确码值 | `CliAuthPanels.tsx`、`cli-auth.css` |
| 2 | 登录卡片/创建弹窗里的复选框、单选框被“所有 input”规则撑成整行大输入框（审计 7 处异常） | 输入框规则排除 checkbox/radio，并加 `:has()` 兜底；令牌范围复选框固定 16px | `workspace-07/08/09.css`、`apple-pages.css` |
| 3 | 通知未读点用左内边距“顶出”文字，已读/未读文字不对齐；多处 `!important` | 未读点改为绝对定位的伪元素，文字始终左对齐；去掉 `!important`；导出面板（复用 `.notification-preference-row`）的横排布局显式保留 | `notifications.css` |
| 4 | @提及菜单宽度不受控、可能撑出视口 | 锚定输入框左下、宽度 `clamp(200px, 100%, 280px)` 且不超过 `100vw - 32px` | `discussion.css` |
| 5 | AI 任务弹窗出现两层内边距和两个滚动区 | 弹窗改为 flex 列，只有任务列表一个滚动区 | `workspace-10.css` |
| 6 | 视觉与浏览器测试不好复现：视觉测试 `workers: 4` 却共用一个一次性数据库（会产生竞态）；`test:visual` 不先 build；两个 E4 浏览器测试写死系统 Chrome | `workers: 1`；`test:visual` 先 build；新增 `test:visual:update`；两个 E4 浏览器测试在没有系统 Chrome 时回退到 Playwright Chromium（视觉基线本身仍是 macOS Chrome，不变） | `playwright.visual.config.ts`、`package.json`、`E4-*.test.ts` |
| 7 | 图表配色散落、与应用不一致 | 采用经过校验的 8 色分类色板（浅/深各一组），暴露为 `--series-1..8`；SVG 属性带回退色 | `tokens.css`、`Chart.tsx` |
| 8 | 导出/渲染页的标题字体与应用不一致 | 标题使用无衬线栈；图表色板同第 7 项 | `packages/render/src/index.ts` |

另外：补齐仓库文档（README、AUTHORS、产品说明、验收说明、决定记录）、`.github/workflows/ci.yml`、`.gitignore`/`.dockerignore`；去掉 ~200 MB 的重复/失败运行产物，保留 176 张视觉基线。

### 被改动的测试（全部有理由，没有删除或放宽任何业务断言）

| 测试文件 | 改动 | 原因 |
| --- | --- | --- |
| `E4-visual-polish.test.ts` | 未读规则的正则改为“不再使用左内边距”；提及菜单宽度断言改为新的 `clamp` | 实现方式变了，断言的是同一个用户可见结果 |
| `E4-display-markup.test.tsx` | CLI 码测试改为“`.cli-auth-code` 文本 = `ABCD-EFGH` 且无子元素” | 对应第 1 项；这比旧断言**更严格** |
| `E4-computed-polish.test.ts` | CLI 测试改为用 `innerText` 断言一个固定夹具；系统 Chrome 不存在时回退 | 第 1、6 项 |
| `E4-notification-layout.test.ts` | 系统 Chrome 不存在时回退（×2） | 第 6 项 |

原 665 的 `CliAuth.test.tsx` 第 78 行（要求渲染结果里出现连续的 `ABCD-EFGH`）在 686 的格子设计下会失败，现在应当重新通过——**需要在 Mac 上实跑确认**。

## 2. 替负责人做的两项产品决定

完整文字在 [DECISIONS.md](DECISIONS.md) 的 REL-1、REL-2。

1. **E5（把 `theme/` 叠加层并回组件样式）推迟。** 0.1.0 保留现有结构；它是纯重构、没有用户可见收益，却会让 176 张基线全部重审。后续按“每区域一次 build + 完整 visual，有差异即回滚”重做。
2. **导出/渲染页只对齐两件小事：** 标题字体与图表色板；**默认强调色 `#2148a0` 不动**（改了会让所有已有文档的外观变化，应作为独立产品决定）。

## 3. 验证：做了什么，没做什么

### 3.1 Claude 在沙箱里实际做过的（Linux、Chromium、模拟接口——**不是**真实应用 + Mac Chrome）

- 用 esbuild 把 web 包打成可预览页面，配模拟 API，用 Playwright Chromium 截图并量取计算样式：
  - 复选框审计：686 里 7 处布局异常（整行大输入框、文字掉到控件下方）→ 0。审计脚本按“控件宽或高 > 30px”判定，所以设计尺寸为 38×22 的通知开关仍会被标出——它现在与文字同一行、方向为横排，是预期的，不是缺陷。
  - CLI 码：`innerText` 精确等于设备码；390px 窄屏不溢出身份卡片。
  - 通知：文字左对齐一致；未读点不影响文字位置。
  - AI 弹窗：只有一个滚动容器，无双重内边距。
  - 图表：浅/深色下取到的是新色板。
  - 基础场景（26 个）与 686 逐像素一致。
- 用自制的 vitest 替身运行了不依赖 jsdom/React 的测试：`E4-visual-polish` 5/5、`E4-computed-polish` 5/5、`E4-notification-layout` 2/2、`design-tokens` 2/2、`reading-layout` 2/2、`web-structure` 1/1 全部通过。
- 对比度检查（27 组，浅/深）与不安全渲染扫描通过。
- 所有改动过的 `.ts/.tsx/.css` 做了语法解析，`package.json` 能被 JSON 解析。

### 3.2 Claude 打包时没做 / 做不了的（历史状态；Codex 本机结果见 3.3）

- `pnpm install --frozen-lockfile`（沙箱访问不了 npm 源，也不应绕过）。
- `pnpm verify` 全流程：ESLint、TypeScript 类型检查、**全部 vitest**（尤其 jsdom/React 测试，如 `E4-display-markup.test.tsx`、`CliAuth.test.tsx`、`App-sidebar-layout.test.tsx`）、构建。
- 176 张视觉基线的比对与重建（基线是 macOS Chrome 渲染，沙箱里的 Linux 渲染不能代替）。
- `scripts/acceptance-*.ts`（真实 Chrome）及 `acceptance-cli.ts`（它断言 `.cli-auth-code` 的 `innerText` 等于设备码，应当通过，但需实跑）。
- GitHub Actions 工作流（`ci.yml`）从未运行过。
- **@提及菜单“页面被推动约 21px”**：在沙箱里任何宽度都复现不了；本版做了防御性的锚定修复，是否真正消除需要在真实环境确认。

### 3.3 Codex 在 Mac 上实际完成的（2026-10-25，Asia/Taipei）

- 完整性：压缩包 SHA-256 与附带校验文件一致，MANIFEST.json 的 612 项大小与哈希全部通过，无缺失和额外文件。
- 环境：macOS 27.0.1 arm64、Node 24.21.0、pnpm 11.25.0、Google Chrome 155.0.8059.85。
- `pnpm install --frozen-lockfile`、`pnpm verify` 均通过；114 个测试文件、686 项测试通过，无业务断言被删除、跳过或放宽。两条 Zod 注释警告和主包超过 500 kB 警告保持原样。
- 初始视觉回归为 15 个测试失败、23 个通过。独立采集 176 张候选截图后，逐张审阅 45 张超阈值差异，才执行 `pnpm test:visual:update`；正式只更新这 45 张。随后连续两轮 `pnpm test:visual` 均退出 0，每轮 38 个测试完成、176 张基线参与比对。两轮期间代码与基线指纹不变。
- `pnpm build` 后按第 4 节顺序完成全部五个脚本（通过 `pnpm exec tsx`），最终均退出 0。浏览器主流程 45 项观察；UI surfaces、工具栏、访客滚动及 CLI 实测数字与原始结果见下列复验记录。浏览器记录保留 5 条 401 控制台资源消息，页面运行错误为 0；未把它们隐藏成“零消息”。
- 发布复验只修改了一个脚本夹具：`scripts/ui-surfaces-cases.ts` 原先仅固定验证码前四位，随机后缀会污染视觉比对；先用真实本地 API 复现失败，再固定一次性数据库内的完整码 `ABCD-EFGH`，同一检查连续两次通过，四组 Chrome 截图验证纯文本值。生产授权码生成逻辑未改。
- 真实 Chrome 四组测量（1440/390、浅/深）中，打开 @提及菜单前后页面、输入区几何和滚动位置完全相同，菜单位于视口内；AI 弹窗仅有列表一个纵向滚动区；通知开关为 38×22、令牌复选框为 16×16。未复现约 21px 位移，不推断覆盖所有外部环境。
- 初次安装因 npm DNS 限制退出 1；首次 verify 因端口/Chrome 权限限制退出 1。正常本机权限下原命令重跑通过。补充测量脚本曾因 Codex 写错选择器超时，修正临时脚本后四组通过。所有失败轮次的命令、退出码与原始日志均保留。

详见 [macOS 复验记录](acceptance/macos-release-verification.md)、[45 张基线逐张审阅表](acceptance/visual-review-20261025.md) 和 [原始日志与 JSON](acceptance/macos-release-20261025-logs)。

**GitHub 状态见 3.4。** 真实服务器部署、真实 PDF/SMTP/飞书/OAuth 仍未进行。

### 3.4 GitHub 上传与首轮 CI（2026-10-25）

- 仓库为 [HHHHKM/hcd](https://github.com/HHHHKM/hcd)：先创建 Private，后经 Alkaid 明确授权切换为 Public。
- 首次提交 `571b97f` 以 Alkaid 署名，并保留 Claude、Codex 两条共同作者 trailer；版权包含 Alkaid and HCD contributors。
- [首轮 Linux CI](https://github.com/HHHHKM/hcd/actions/runs/40121985155) 为 **success**：114 个测试文件、686 项测试通过，构建成功；既有三条构建警告与额外 Actions/依赖弃用提示均保留。
- 从 GitHub 在全新目录克隆，冻结锁文件安装及完整 verify 再次通过。GitHub README 图片、署名和文档入口已核对。
- 首次推送因缺少 workflow scope 被拒绝；负责人补充授权后，原提交成功推送，CI 配置和断言未删改。一次 CI 观察请求遇到网络 EOF，正式 CI 结果仍为 success。
- 发布目标为 `v0.1.0` 带注释标签与 prerelease；本次收尾提交只更新文档与验收日志。Release 说明沿用本文，已知限制和全部失败轮次继续保留。

详见 [GitHub 发布验收](acceptance/github-release-verification.md)。

## 4. Codex 在 Mac 上的执行顺序（请严格按序，并如实记录每一步的结果）

```sh
cd source
pnpm install --frozen-lockfile

# ① 完整验证
pnpm verify
#   失败时先看本版动过的测试：
#   packages/web/src/E4-visual-polish.test.ts
#   packages/web/src/E4-display-markup.test.tsx
#   packages/web/src/E4-computed-polish.test.ts
#   packages/web/src/E4-notification-layout.test.ts
#   以及 CliAuth.test.tsx（第 78 行应重新通过）。
#   原则：先判断是测试的假设过时，还是修复本身有问题；不要靠删除/放宽业务断言来变绿。

# ② 视觉基线：先看差异，再决定是否更新
pnpm test:visual                 # 预期有少量失败（见第 5 节）
pnpm test:visual:update          # 仅在逐张审阅差异、确认都是预期变化后执行
pnpm test:visual                 # 连续两轮都要全部通过
pnpm test:visual

# ③ 真实 Chrome 验收（用一次性数据库）
pnpm build
tsx scripts/acceptance-browser.ts
tsx scripts/acceptance-ui-surfaces.ts
tsx scripts/acceptance-toolbar-menu.ts
tsx scripts/acceptance-guest-scroll.ts
tsx scripts/acceptance-cli.ts    # 同时刷新 docs/acceptance/cli-acceptance.md
```

任何一步失败，请把命令、退出码和日志原样写入 `docs/acceptance/`，并在 GitHub 的第一个 Release 说明里如实标注，不要隐藏。

## 5. 预期会变化的视觉场景

下面这些场景受本版修改影响，**基线差异是预期的**，请逐张审阅后再更新；实际以测试结果为准。

| 场景 | 变化 |
| --- | --- |
| `surface-cli-consent` | 验证码变为单个药丸形文本 |
| `surface-oauth-consent` | 授权文档条目固定为横排对齐 |
| `surface-settings-tokens` | 令牌范围复选框尺寸与对齐 |
| `surface-notifications`（含未读行时） | 未读点位置与文字对齐 |
| `surface-mentions` | 菜单宽度与锚点 |
| `surface-ai-tasks`、`surface-ai-confirm` | 单滚动区、内边距 |
| `surface-reading-chart` 及含图表的阅读场景 | 图表配色 |
| 可能：`surface-admin-accounts`、`surface-share-modal` | 复选框相关 |

如果出现**不在这张表里**的差异，请当作回归处理，不要直接更新基线。

本机复验补充：初始清单以外的 `surface-notification-preferences` 和 `surface-toast` 先按回归调查，逐张原图对照及 CSS 规则确认分别源于已说明的开关横排/尺寸修复、令牌复选框高度及其背景面板滚动位置变化，才接受更新。含图表的编辑、审核、分享和“更多”菜单截图也仅出现图表柱形/图例配色变化。完整文件名单见第 3.3 节链接。

## 6. 已知限制与后续

- 容器部署、真实 PDF 输出、真实 SMTP / 飞书 / Lark 送达、外部 OAuth 客户端互通：只有本地模拟，没有真实环境证据。
- 手机端只读/评论/审核，不能编辑；真实触控与输入法未用实机验证。
- 构建仍有三条已获批保留的警告（两条 Zod 注释、主包 647 kB > 500 kB）。
- `visual/` 与 `scripts/` 不在类型检查范围内。
- B2 测试缺少“锚点状态”断言。
- 导出/渲染页默认强调色在深色模式下的对比度尚未校验。
- E5（样式层合并）、E6（无障碍与 Safari 收尾）、E7（拆包与警告清零）未做。
- 模块负责人、自动发布、PostgreSQL、备份恢复、审计日志、实时协作（Yjs）仍是后续功能。
- 被移出文档的编辑者留下的待审提交是否仍可发布：仍待产品决定。

## 7. 本版触及的文件

`packages/render/src/{Chart.tsx,index.ts}`、`packages/web/src/{tokens.css,cli-auth.css,discussion.css,notifications.css}`、`packages/web/src/features/auth/CliAuthPanels.tsx`、`packages/web/src/styles/workspace-{07,08,09,10}.css`、`packages/web/src/theme/apple-pages.css`、四个 `E4-*.test.*`、`playwright.visual.config.ts`、`package.json`、`.gitignore`、`.dockerignore`；其余为新增文档与 CI 配置。
