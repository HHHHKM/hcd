# HCD 0.1.0 · macOS 发布复验（2026-10-25）

本记录由 Codex 在负责人的 Mac 上执行；原始发布包的完整性通过后才开始安装和复验。所有下列命令在 source/ 目录运行。日志含原始输出、UTC 起止时间和退出码；本文日期按 Asia/Taipei。

## 环境与完整性

- 原压缩包 SHA-256：`3eb02c5a9c529f784613292da9edc47bb084f005889b3e84a1e50d35ad01b675`，与附带 .sha256 一致。
- MANIFEST.json：612/612 文件大小和 SHA-256 一致，无缺失、无额外文件。该清单描述修改前的原始包，未将复验后的修改伪装成原包内容。
- macOS-27.0.1-arm64-arm-64bit；Node v24.21.0；pnpm 11.25.0；Google Chrome 155.0.8059.85。

## 命令、退出码与原始日志

| 顺序 | 命令 | 退出码 | 日志 |
| --- | --- | --- | --- |
| 1 | `pnpm install --frozen-lockfile` | 1 | [01-install.log](macos-release-20261025-logs/01-install.log) |
| 2 | `pnpm install --frozen-lockfile` | 0 | [01b-install-network.log](macos-release-20261025-logs/01b-install-network.log) |
| 3 | `pnpm verify` | 1 | [02-verify.log](macos-release-20261025-logs/02-verify.log) |
| 4 | `pnpm verify` | 0 | [02b-verify-local.log](macos-release-20261025-logs/02b-verify-local.log) |
| 5 | `pnpm test:visual` | 1 | [03-visual-initial.log](macos-release-20261025-logs/03-visual-initial.log) |
| 6 | `pnpm exec playwright test -c [临时工作目录]/visual-candidates.config.ts --update-snapshots` | 0 | [03b-visual-candidates.log](macos-release-20261025-logs/03b-visual-candidates.log) |
| 7 | `pnpm exec tsx ../../../work/check-visual-code.ts` | 1 | [03c-code-fixture-red.log](macos-release-20261025-logs/03c-code-fixture-red.log) |
| 8 | `pnpm exec tsx ../../../work/check-visual-code.ts` | 0 | [03d-code-fixture-green.log](macos-release-20261025-logs/03d-code-fixture-green.log) |
| 9 | `pnpm exec tsx ../../../work/capture-cli-candidates.ts` | 0 | [03e-cli-candidates.log](macos-release-20261025-logs/03e-cli-candidates.log) |
| 10 | `pnpm test:visual:update` | 0 | [03f-visual-update.log](macos-release-20261025-logs/03f-visual-update.log) |
| 11 | `pnpm exec tsx ../../../work/check-release-layout.ts` | 1 | [03g-layout-audit.log](macos-release-20261025-logs/03g-layout-audit.log) |
| 12 | `pnpm exec tsx ../../../work/check-release-layout.ts` | 0 | [03h-layout-audit-corrected.log](macos-release-20261025-logs/03h-layout-audit-corrected.log) |
| 13 | `pnpm test:visual` | 0 | [03i-visual-round1.log](macos-release-20261025-logs/03i-visual-round1.log) |
| 14 | `pnpm test:visual` | 0 | [03j-visual-round2.log](macos-release-20261025-logs/03j-visual-round2.log) |
| 15 | `pnpm build` | 0 | [04-build.log](macos-release-20261025-logs/04-build.log) |
| 16 | `pnpm exec tsx scripts/acceptance-browser.ts` | 0 | [05-browser.log](macos-release-20261025-logs/05-browser.log) |
| 17 | `pnpm exec tsx scripts/acceptance-ui-surfaces.ts` | 0 | [06-ui-surfaces.log](macos-release-20261025-logs/06-ui-surfaces.log) |
| 18 | `pnpm exec tsx scripts/acceptance-toolbar-menu.ts` | 0 | [07-toolbar-menu.log](macos-release-20261025-logs/07-toolbar-menu.log) |
| 19 | `pnpm exec tsx scripts/acceptance-guest-scroll.ts` | 0 | [08-guest-scroll.log](macos-release-20261025-logs/08-guest-scroll.log) |
| 20 | `pnpm exec tsx scripts/acceptance-cli.ts` | 0 | [09-cli.log](macos-release-20261025-logs/09-cli.log) |

## 失败轮次的依据

- 初次安装退出 1：npm 请求 ENOTFOUND；受限环境外同一冻结锁文件命令退出 0，未改锁文件。
- 首次 verify 退出 1：15 个文件失败、99 个通过，66 项失败、615 项通过、5 项未执行，另有 23 个错误；本地监听明确返回 EPERM、Chrome 启动受限，导致部分请求超时。保持源码不变，在正常本机权限下重跑后 114 个文件、686 项全部通过，构建成功。因此该失败轮次有环境限制的直接证据。
- 初始视觉回归退出 1：15 个测试失败、23 个通过。组件组合测试会在第一处图像差异停止，不能把这一轮当成覆盖了全部 176 张图片；随后独立采集 176 张候选图并逐张审阅 45 张超阈值差异。
- 视觉验证码夹具的补充复现退出 1：ABCD 后缀随机，不是完整稳定码；固定一次性数据库的码后同一检查连续两次通过。仅改 scripts/ui-surfaces-cases.ts 的固定夹具值与说明，不改生产授权码生成。
- 补充布局脚本首次退出 1：Codex 把 .ai-task-modal 误写成 .ai-tasks-modal，选择器等待超时。修正临时测量脚本后四组实际布局测量全部通过。该错误不归因于产品。

## 视觉审阅与补充测量

详见 [逐张审阅表](visual-review-20261025.md)。保持 threshold 0.2、maxDiffPixelRatio 0.002、既有遮罩、限流和全部业务断言。候选采集的通过不替代正式回归结果；正式更新和两轮连续回归结果以命令表为准。

真实 Chrome 在 1440/390、浅/深四组中确认：提及菜单打开前后的 document/composer 几何、页面 scrollY 和 scrollWidth 完全相同，菜单在视口内；AI 弹窗恰有一个纵向滚动区 ai-task-list；通知开关 38×22；令牌复选框 16×16。测量见 [JSON](macos-release-20261025-logs/release-layout-audit.json)。未复现原报告的约 21px 页面位移，但不推断覆盖了所有外部环境。

## 范围与上传状态

- 构建保留原有两条 Zod 注释警告和一条主包超过 500 kB 警告，未调低检查阈值。
- 所有邮件、飞书、OAuth 验证仅使用本地夹具；未部署服务器、未接入真实外部服务。
- GitHub 上传、首轮 CI 和远端全新克隆复验已完成；仓库按 Alkaid 最新指示公开。v0.1.0 prerelease 随本次发布提交建立，详见 [GitHub 发布验收](github-release-verification.md)。

## 最终本机验收结果

| 检查 | 结果 |
| --- | --- |
| 冻结锁文件安装、lint、类型检查、Vitest、构建 | 通过；114 个文件、686 项测试；原有三条构建警告保留 |
| 正式视觉更新 | 通过；仅更新已审阅的 45/176 张基线 |
| 连续两轮视觉回归 | 两轮均退出 0；每轮 38 个测试完成、176 张基线参与比对；两轮期间代码与基线指纹不变 |
| 浏览器主流程 | 通过；45 项观察，0 个页面运行错误，0 个外部请求；保留 5 条 401 控制台资源消息，原文见 JSON |
| UI surfaces | 通过；152 个场景记录，0 个问题，0 个运行错误，0 个外部请求 |
| 工具栏菜单 | 通过；6 个视口/主题场景 |
| 访客滚动 | 通过；5 个场景 |
| CLI 设备授权与 MCP | 通过；真实浏览器核对终端码、授权、保存凭据、MCP initialize / tools/list / read_document；无外部浏览器请求 |

浏览器控制台的 401 消息完整保留；脚本涉及未登录和失效会话的检查，相关断言全部通过。这里仅报告脚本与 JSON 的实际结果，不把控制台消息隐去，也不把本地结果等同于首轮 GitHub CI。UI surfaces 中手机编辑与原生文字选择的限制仍按产品现有行为记录。

五个脚本使用 `pnpm exec tsx`（本机未安装全局 tsx），实际脚本与参数顺序未变。原始脚本输出与退出码都在上面的命令表。截图和 trace 保留在本地 outputs/，不进入 Git；本目录只收录验收文字、JSON 和日志。
