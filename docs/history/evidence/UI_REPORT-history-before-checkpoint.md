# HCD Apple UI 工作报告

- 来源：hcd-ai-test-20261024-665-apple-ui.zip；SHA-256 `0460977c9a61a23dd5b50ba662f75527f1a7deb4c9d37bfd349340df9a4817e3`，与提供的.sha256一致，ZIP CRC通过。
- 代码位置：本包source/；完整规格reference/BUILD_SPEC.md。唯一阶段任务来源为本包CODEX_UI_GUIDE.md，已完整阅读FRONTEND_REDESIGN.md。
- 原始ZIP没有CODEX_UI_GUIDE.md，已从用户单独附件复制至包根；未自行创建替代指导。
- 环境：macOS Darwin 27 arm64 / Node24.21.0 / pnpm11.25.0 / 本机Google Chrome155。

## 阶段结果

| 阶段 | 状态 | 结果与证据 |
| --- | --- | --- |
| E0 | 完成（预期基线非全绿） | install exit0；verify 665测试/108文件，663通过、仅B1/B2失败；lint 0error/2warning，安全/对比度/typecheck通过，未进入build。证据source/outputs/install-E0.log、verify-E0.log。 |
| E1 | 完成（特批已知构建警告） | B1/B2和两项hook依赖已处理；verify exit0，668/668测试、109/109文件通过；lint 0error/0warning。根据负责人决定，2条Zod注释warning和1条646.84kB超限warning暂留至E7，逐阶段如实记录。证据source/outputs/verify-E1.log、E1-verify-result.json及E1-hooks.md。 |
| E2 | 完成（已记录可用性缺陷，E4修复） | `pnpm build` exit0；三个真实Chrome脚本全部通过：主验收45 observations、toolbar menu 6场景、guest scroll 5场景；pageErrors=0，外部请求=0。证据source/outputs/E2-*.log、E2-*-results.json、E2-*.png、ui-acceptance.md。脚本未覆盖的低频界面已列入验收记录，后续E4逐组件检查。 |
| E3 | 完成（30场景补全） | 完整30个场景（含分享页1440/390双主题），一次性磁盘SQLite、真实app/dist、Chrome、zh-CN；连续两次30/30通过；verify exit0、668/668通过。证据source/outputs/E3-complete-*.log、verify-E3.log、visual-baseline/*.png。 |
| E4 | 补验中（上传框遗漏已确认） | `verify-E4-final4.log` exit0，113文件/682测试通过；176基线（30主场景+146组件图）；`E4-visual-check1.log`34/34（1.9m）、`E4-visual-check2.log`34/34（2.0m）。152组合146截图通过、6移动编辑N/A；E2三验收复跑通过，3条批准构建warning保留。 |
| E5 | 暂停，返回E4补验 | E4门禁完成后正式开始；CSS前值9161行，176张基线已冻结；当前区域01/02已按备份逆序恢复，待E4补验完成后重新执行。过程为source/outputs/E5-migration-log.md/json。 |
| E6 | 未做 | 等待E5。 |
| E7 | 未做 | verify确认主包646.84kB，存在与E1零warning门槛的顺序冲突；未提前拆包或隐藏警告。 |
| E8 | 未做 | 尚未交付。 |

## E0 接入与基线

选择直接使用改版包，在新的ui-work目录解压，未覆盖上轮665工作目录。install首次在默认sandbox中因pnpm缓存SQLite不可写而退出1，属于环境问题；已在允许本机缓存访问的环境重跑。真实install exit0；verify于18:47:00运行38.19秒，663/665通过，仅预期B1/B2旧断言失败、2个hook warning；其他测试及安全/对比度/typecheck通过，verify因测试失败未运行build。未发现额外改版失败；按E0明列例外进入E1。

## E1 旧断言对照

仅修改指导明确批准的两个用例，不改生产版本/评论逻辑。

| 用例 | 旧断言 | 新断言 | 证据 |
| --- | --- | --- | --- |
| VersionComparison默认版本元信息 | `Created by: u_owner` | `Created by: Unknown user`，且不出现u_owner/u_first；原作者名字及转义断言保留 | source/outputs/E1-approved-assertions.log |
| AT-32 preserving discussion bodies | 固定v1仍有v2成员根主题及其回复，投影为text_changed/block_deleted/lost | 三个v2根主题均不存在；v1主题正文不变；v2后固定v1访客主题和成员回复全部保留；未来正文/节点秘密仍不泄露，存储锚点未变 | 同上，25测试/3文件通过 |

B2在该批准用例内补v1可见主题及本地访客验证fixture，用真实API构造D-1场景；其余用例断言未改。

## E1 hooks修复与真实验证

- `AuthLink.tsx`：标题effect补充`t`依赖；读取邮件链接token的effect依赖未扩大。语言切换不会重新读取token。原问题的修复前证据是eslint缺少依赖诊断，不虚构原本已经正确的标题切换行为失败。
- `SpaceIntegrations.tsx`：用稳定的`useCallback`定义`report`，读取effect依赖包含`report`；错误状态保存翻译key，在渲染时翻译。新增测试先复现“请求等待期间切换语言，迟到错误仍显示旧语言”失败，再修复；已结束的错误也跟随当前语言，切换语言不重复GET。没有使用eslint-disable。
- 新增`E1-hook-dependencies.test.tsx`共3项测试，验证上述语言与请求次数边界。修复前lint exit1；修复后定向生产lint exit0、0error/0warning，定向测试21/21（4文件），typecheck exit0。完整过程见`source/outputs/E1-hooks.md`及其引用的red/green日志。一次把仓库本就忽略的测试文件传给eslint产生的ignored-file warning单独留档，不算作最终成功检查。
- 完整`pnpm verify`真实退出码0；测试于18:54:14开始，测试耗时34.12秒，109文件/668项全部通过。安全扫描、27组浅深色WCAG AA对比度、typecheck均通过，lint无error/warning。Vite build成功，构建耗时1.16秒，但仍有以下3项warning，不能将本阶段写为全绿。

| 构建warning | 真实结果 | 当前处理 |
| --- | --- | --- |
| Zod 4.6.7 `v4/core/util.js:400` | Rollup无法解释`@__PURE__`在说明注释中的位置；构建时移除该注释 | 未改依赖、未过滤诊断 |
| Zod 4.6.7 `v4/core/regexes.js:74` | 同类无效annotation位置诊断 | 未改依赖、未过滤诊断 |
| Vite chunk体积 | `dist/assets/index-8CjTMAew.js` 646.84kB（gzip202.64kB），超过500kB提示线 | 未提高提示阈值、未提前执行E7 |

权威完整输出为`source/outputs/verify-E1.log`，摘要为`source/outputs/E1-verify-result.json`。verify进程成功不等于指导要求的零warning门槛已经满足。

## E2 视觉问题与修复

### 真实环境脚本

- `pnpm build`退出0；保留已批准暂留至E7的2条Zod注释warning和1条646.84kB主包warning，原始证据`source/outputs/E2-build.log`。
- `scripts/acceptance-browser.ts`：Chrome 155.0.8059.85，45个观察点，pageErrors=0，blockedExternalRequests=0；真实API覆盖登录、阅读、选区评论、富文本编辑并提交、审核发布、版本对比、分享页访客验证和回复、设置、密码修改、全设备登出。
- `scripts/acceptance-toolbar-menu.ts`：6个浅/深主题与360/805/1440视口场景全通过，菜单项均可点击且无横溢出。
- `scripts/acceptance-guest-scroll.ts`：5个浅/深主题与360/1440场景全通过，引用高亮保持在视口内。
- 证据汇总`source/outputs/ui-acceptance.md`；结构化结果`E2-browser-acceptance-results.json`、`E2-toolbar-menu-results.json`、`E2-guest-scroll-results.json`；截图均使用`E2-`前缀并与`reference/apple-ui-preview/`同名场景对照。

### E2 真实界面补充

原有三脚本未覆盖的低频页面，已用一次性磁盘SQLite、真实createApp和dist补充检查。`source/outputs/E2-ui-coverage-final.json`汇总152个组合：142张有效截图、10项移动端N/A（现有移动阅读状态无法进入选区浮层/部分编辑状态），运行错误和外部请求均0。各原始失败和重跑日志保留。通知空态当时依赖DOM click，不能记作真实pointer通过；已确认顶部blur使固定遮罩错误居中，交E4修复。详见`ui-acceptance.md`和`E2-ui-surfaces-*.json`。

## E3 视觉回归基线

- `playwright.visual.config.ts`匹配`**/*.visual.ts`，基线为`outputs/visual-baseline/{arg}{ext}`，阈值0.002，关闭动画并隐藏caret，使用本机Chrome。
- `scripts/visual-server.ts`使用一次性临时磁盘SQLite、真实seed服务和静态dist，固定日期、真实viewer token，用后清理。
- `visual/ui.visual.ts`覆盖30场景：主页、阅读1680/1440/1280/805/390、编辑、审核、历史、设置、分享1440/390、登录、更多1440/360，全部双主题、zh-CN、Asia/Taipei。所有阅读宽度均打开讨论面板，desktop正文至少680px。
- `E3-complete-baseline.log`30通过；`E3-complete-run1.log`30通过（33.9s）；`E3-complete-run2.log`30通过（33.5s）。外部请求、运行错误、429均0。
- `verify-E3.log`exit0，109文件/668测试全通过，lint无诊断；已批准的3条构建warning保留。更早的26图证据是遗漏分享场景的历史记录，不作完整门禁。

## E4 改前改后

11组精修与3处最小TSX展示改动见 [逐组实现与TSX说明](source/outputs/E4-audit-completion.md)。完整 `pnpm verify` 为 [verify-E4-final4.log](source/outputs/verify-E4-final4.log)，exit0、113文件/682测试通过，lint/security/typecheck通过；已批准的3条构建warning仍保留。

真实红证据包括迟到通知控件视口、提及菜单21px横向溢出、390px通知层级拦截、CLI分格窄屏溢出及头像/富文本缺失。新增测试和修复前后日志见 [E4实现复核](source/outputs/E4-audit-completion.md) 与 [层级/菜单真实失败说明](source/outputs/E4-pointer-menu-review.md)。一次新测试夹具的innerHTML触发security-check，已改用真实React安全渲染，原失败日志保留。

最终真实应用补验 [E4-after-repaired.log](source/outputs/E4-after-repaired.log) 12/12，0issue、0runtime、0external；合并全部152组合后146实际截图、6移动编辑N/A。通知空态用正常pointer检查，未使用force/DOM click。E2三脚本复验45 observations、toolbar6、guest5均通过，原日志为E4-acceptance-*.log。

视觉稳定版更新 [update4](source/outputs/E4-visual-final-update4.log) 34/34；[check1](source/outputs/E4-visual-check1.log) 34/34（1.9m）；[check2](source/outputs/E4-visual-check2.log) 34/34（2.0m）；E4门禁完成。176张基线SHA256清单为 [E4-visual-baseline-manifest.json](source/outputs/E4-visual-baseline-manifest.json)。所有失败、瞬时移动编辑与中间运行日志均保留，不作最终通过依据。

改前图来源见 [追溯清单](source/outputs/E4-before-copy-manifest.json)；移动选区8图由原ZIP隔离构建补拍，见 [来源与命令](source/outputs/E4-before-mobile-selection-source.json)。以下逐界面列出真实改前/改后截图。6个390px编辑项为现有产品移动只读限制，未把卸载前瞬间记作有效编辑图。

| 组 | 界面 | 改前（1440浅 / 390浅 / 1440深 / 390深） | 改后（同序） |
| --- | --- | --- | --- |
| 1 | selection | [1440浅](source/outputs/E4-before-selection-1440-light.png) / [390浅](source/outputs/E4-before-selection-390-light.png) / [1440深](source/outputs/E4-before-selection-1440-dark.png) / [390深](source/outputs/E4-before-selection-390-dark.png) | [1440浅](source/outputs/E4-after-selection-1440-light.png) / [390浅](source/outputs/E4-after-selection-390-light.png) / [1440深](source/outputs/E4-after-selection-1440-dark.png) / [390深](source/outputs/E4-after-selection-390-dark.png) |
| 2 | rich-editor | [1440浅](source/outputs/E4-before-rich-editor-1440-light.png) / 390浅：N/A（移动端只读） / [1440深](source/outputs/E4-before-rich-editor-1440-dark.png) / 390深：N/A（移动端只读） | [1440浅](source/outputs/E4-after-rich-editor-1440-light.png) / 390浅：N/A（移动端只读） / [1440深](source/outputs/E4-after-rich-editor-1440-dark.png) / 390深：N/A（移动端只读） |
| 3 | notifications | [1440浅](source/outputs/E4-before-notifications-1440-light.png) / [390浅](source/outputs/E4-before-notifications-390-light.png) / [1440深](source/outputs/E4-before-notifications-1440-dark.png) / [390深](source/outputs/E4-before-notifications-390-dark.png) | [1440浅](source/outputs/E4-after-notifications-1440-light.png) / [390浅](source/outputs/E4-after-notifications-390-light.png) / [1440深](source/outputs/E4-after-notifications-1440-dark.png) / [390深](source/outputs/E4-after-notifications-390-dark.png) |
| 3 | notification-preferences | [1440浅](source/outputs/E4-before-notification-preferences-1440-light.png) / [390浅](source/outputs/E4-before-notification-preferences-390-light.png) / [1440深](source/outputs/E4-before-notification-preferences-1440-dark.png) / [390深](source/outputs/E4-before-notification-preferences-390-dark.png) | [1440浅](source/outputs/E4-after-notification-preferences-1440-light.png) / [390浅](source/outputs/E4-after-notification-preferences-390-light.png) / [1440深](source/outputs/E4-after-notification-preferences-1440-dark.png) / [390深](source/outputs/E4-after-notification-preferences-390-dark.png) |
| 4 | share-modal | [1440浅](source/outputs/E4-before-share-modal-1440-light.png) / [390浅](source/outputs/E4-before-share-modal-390-light.png) / [1440深](source/outputs/E4-before-share-modal-1440-dark.png) / [390深](source/outputs/E4-before-share-modal-390-dark.png) | [1440浅](source/outputs/E4-after-share-modal-1440-light.png) / [390浅](source/outputs/E4-after-share-modal-390-light.png) / [1440深](source/outputs/E4-after-share-modal-1440-dark.png) / [390深](source/outputs/E4-after-share-modal-390-dark.png) |
| 4 | share-revoke | [1440浅](source/outputs/E4-before-share-revoke-1440-light.png) / [390浅](source/outputs/E4-before-share-revoke-390-light.png) / [1440深](source/outputs/E4-before-share-revoke-1440-dark.png) / [390深](source/outputs/E4-before-share-revoke-390-dark.png) | [1440浅](source/outputs/E4-after-share-revoke-1440-light.png) / [390浅](source/outputs/E4-after-share-revoke-390-light.png) / [1440深](source/outputs/E4-after-share-revoke-1440-dark.png) / [390深](source/outputs/E4-after-share-revoke-390-dark.png) |
| 4 | share-expired | [1440浅](source/outputs/E4-before-share-expired-1440-light.png) / [390浅](source/outputs/E4-before-share-expired-390-light.png) / [1440深](source/outputs/E4-before-share-expired-1440-dark.png) / [390深](source/outputs/E4-before-share-expired-390-dark.png) | [1440浅](source/outputs/E4-after-share-expired-1440-light.png) / [390浅](source/outputs/E4-after-share-expired-390-light.png) / [1440深](source/outputs/E4-after-share-expired-1440-dark.png) / [390深](source/outputs/E4-after-share-expired-390-dark.png) |
| 4 | share-page | [1440浅](source/outputs/E4-before-share-page-1440-light.png) / [390浅](source/outputs/E4-before-share-page-390-light.png) / [1440深](source/outputs/E4-before-share-page-1440-dark.png) / [390深](source/outputs/E4-before-share-page-390-dark.png) | [1440浅](source/outputs/E4-after-share-page-1440-light.png) / [390浅](source/outputs/E4-after-share-page-390-light.png) / [1440深](source/outputs/E4-after-share-page-1440-dark.png) / [390深](source/outputs/E4-after-share-page-390-dark.png) |
| 5 | mentions | [1440浅](source/outputs/E4-before-mentions-1440-light.png) / [390浅](source/outputs/E4-before-mentions-390-light.png) / [1440深](source/outputs/E4-before-mentions-1440-dark.png) / [390深](source/outputs/E4-before-mentions-390-dark.png) | [1440浅](source/outputs/E4-after-mentions-1440-light.png) / [390浅](source/outputs/E4-after-mentions-390-light.png) / [1440深](source/outputs/E4-after-mentions-1440-dark.png) / [390深](source/outputs/E4-after-mentions-390-dark.png) |
| 5 | selection-summary | [1440浅](source/outputs/E4-before-selection-summary-1440-light.png) / [390浅](source/outputs/E4-before-selection-summary-390-light.png) / [1440深](source/outputs/E4-before-selection-summary-1440-dark.png) / [390深](source/outputs/E4-before-selection-summary-390-dark.png) | [1440浅](source/outputs/E4-after-selection-summary-1440-light.png) / [390浅](source/outputs/E4-after-selection-summary-390-light.png) / [1440深](source/outputs/E4-after-selection-summary-1440-dark.png) / [390深](source/outputs/E4-after-selection-summary-390-dark.png) |
| 6 | admin-accounts | [1440浅](source/outputs/E4-before-admin-accounts-1440-light.png) / [390浅](source/outputs/E4-before-admin-accounts-390-light.png) / [1440深](source/outputs/E4-before-admin-accounts-1440-dark.png) / [390深](source/outputs/E4-before-admin-accounts-390-dark.png) | [1440浅](source/outputs/E4-after-admin-accounts-1440-light.png) / [390浅](source/outputs/E4-after-admin-accounts-390-light.png) / [1440深](source/outputs/E4-after-admin-accounts-1440-dark.png) / [390深](source/outputs/E4-after-admin-accounts-390-dark.png) |
| 6 | admin-confirm | [1440浅](source/outputs/E4-before-admin-confirm-1440-light.png) / [390浅](source/outputs/E4-before-admin-confirm-390-light.png) / [1440深](source/outputs/E4-before-admin-confirm-1440-dark.png) / [390深](source/outputs/E4-before-admin-confirm-390-dark.png) | [1440浅](source/outputs/E4-after-admin-confirm-1440-light.png) / [390浅](source/outputs/E4-after-admin-confirm-390-light.png) / [1440深](source/outputs/E4-after-admin-confirm-1440-dark.png) / [390深](source/outputs/E4-after-admin-confirm-390-dark.png) |
| 6 | integrations | [1440浅](source/outputs/E4-before-integrations-1440-light.png) / [390浅](source/outputs/E4-before-integrations-390-light.png) / [1440深](source/outputs/E4-before-integrations-1440-dark.png) / [390深](source/outputs/E4-before-integrations-390-dark.png) | [1440浅](source/outputs/E4-after-integrations-1440-light.png) / [390浅](source/outputs/E4-after-integrations-390-light.png) / [1440深](source/outputs/E4-after-integrations-1440-dark.png) / [390深](source/outputs/E4-after-integrations-390-dark.png) |
| 7 | cli-consent | [1440浅](source/outputs/E4-before-cli-consent-1440-light.png) / [390浅](source/outputs/E4-before-cli-consent-390-light.png) / [1440深](source/outputs/E4-before-cli-consent-1440-dark.png) / [390深](source/outputs/E4-before-cli-consent-390-dark.png) | [1440浅](source/outputs/E4-after-cli-consent-1440-light.png) / [390浅](source/outputs/E4-after-cli-consent-390-light.png) / [1440深](source/outputs/E4-after-cli-consent-1440-dark.png) / [390深](source/outputs/E4-after-cli-consent-390-dark.png) |
| 7 | oauth-consent | [1440浅](source/outputs/E4-before-oauth-consent-1440-light.png) / [390浅](source/outputs/E4-before-oauth-consent-390-light.png) / [1440深](source/outputs/E4-before-oauth-consent-1440-dark.png) / [390深](source/outputs/E4-before-oauth-consent-390-dark.png) | [1440浅](source/outputs/E4-after-oauth-consent-1440-light.png) / [390浅](source/outputs/E4-after-oauth-consent-390-light.png) / [1440深](source/outputs/E4-after-oauth-consent-1440-dark.png) / [390深](source/outputs/E4-after-oauth-consent-390-dark.png) |
| 7 | forgot-password | [1440浅](source/outputs/E4-before-forgot-password-1440-light.png) / [390浅](source/outputs/E4-before-forgot-password-390-light.png) / [1440深](source/outputs/E4-before-forgot-password-1440-dark.png) / [390深](source/outputs/E4-before-forgot-password-390-dark.png) | [1440浅](source/outputs/E4-after-forgot-password-1440-light.png) / [390浅](source/outputs/E4-after-forgot-password-390-light.png) / [1440深](source/outputs/E4-after-forgot-password-1440-dark.png) / [390深](source/outputs/E4-after-forgot-password-390-dark.png) |
| 7 | invite | [1440浅](source/outputs/E4-before-invite-1440-light.png) / [390浅](source/outputs/E4-before-invite-390-light.png) / [1440深](source/outputs/E4-before-invite-1440-dark.png) / [390深](source/outputs/E4-before-invite-390-dark.png) | [1440浅](source/outputs/E4-after-invite-1440-light.png) / [390浅](source/outputs/E4-after-invite-390-light.png) / [1440深](source/outputs/E4-after-invite-1440-dark.png) / [390深](source/outputs/E4-after-invite-390-dark.png) |
| 7 | reset | [1440浅](source/outputs/E4-before-reset-1440-light.png) / [390浅](source/outputs/E4-before-reset-390-light.png) / [1440深](source/outputs/E4-before-reset-1440-dark.png) / [390深](source/outputs/E4-before-reset-390-dark.png) | [1440浅](source/outputs/E4-after-reset-1440-light.png) / [390浅](source/outputs/E4-after-reset-390-light.png) / [1440深](source/outputs/E4-after-reset-1440-dark.png) / [390深](source/outputs/E4-after-reset-390-dark.png) |
| 8 | import-upload | [1440浅](source/outputs/E4-before-import-upload-1440-light.png) / [390浅](source/outputs/E4-before-import-upload-390-light.png) / [1440深](source/outputs/E4-before-import-upload-1440-dark.png) / [390深](source/outputs/E4-before-import-upload-390-dark.png) | [1440浅](source/outputs/E4-after-import-upload-1440-light.png) / [390浅](source/outputs/E4-after-import-upload-390-light.png) / [1440深](source/outputs/E4-after-import-upload-1440-dark.png) / [390深](source/outputs/E4-after-import-upload-390-dark.png) |
| 8 | import-preview | [1440浅](source/outputs/E4-before-import-preview-1440-light.png) / [390浅](source/outputs/E4-before-import-preview-390-light.png) / [1440深](source/outputs/E4-before-import-preview-1440-dark.png) / [390深](source/outputs/E4-before-import-preview-390-dark.png) | [1440浅](source/outputs/E4-after-import-preview-1440-light.png) / [390浅](source/outputs/E4-after-import-preview-390-light.png) / [1440深](source/outputs/E4-after-import-preview-1440-dark.png) / [390深](source/outputs/E4-after-import-preview-390-dark.png) |
| 8 | ai-tasks | [1440浅](source/outputs/E4-before-ai-tasks-1440-light.png) / [390浅](source/outputs/E4-before-ai-tasks-390-light.png) / [1440深](source/outputs/E4-before-ai-tasks-1440-dark.png) / [390深](source/outputs/E4-before-ai-tasks-390-dark.png) | [1440浅](source/outputs/E4-after-ai-tasks-1440-light.png) / [390浅](source/outputs/E4-after-ai-tasks-390-light.png) / [1440深](source/outputs/E4-after-ai-tasks-1440-dark.png) / [390深](source/outputs/E4-after-ai-tasks-390-dark.png) |
| 8 | ai-confirm | [1440浅](source/outputs/E4-before-ai-confirm-1440-light.png) / [390浅](source/outputs/E4-before-ai-confirm-390-light.png) / [1440深](source/outputs/E4-before-ai-confirm-1440-dark.png) / [390深](source/outputs/E4-before-ai-confirm-390-dark.png) | [1440浅](source/outputs/E4-after-ai-confirm-1440-light.png) / [390浅](source/outputs/E4-after-ai-confirm-390-light.png) / [1440深](source/outputs/E4-after-ai-confirm-1440-dark.png) / [390深](source/outputs/E4-after-ai-confirm-390-dark.png) |
| 9 | review | [1440浅](source/outputs/E4-before-review-1440-light.png) / [390浅](source/outputs/E4-before-review-390-light.png) / [1440深](source/outputs/E4-before-review-1440-dark.png) / [390深](source/outputs/E4-before-review-390-dark.png) | [1440浅](source/outputs/E4-after-review-1440-light.png) / [390浅](source/outputs/E4-after-review-390-light.png) / [1440深](source/outputs/E4-after-review-1440-dark.png) / [390深](source/outputs/E4-after-review-390-dark.png) |
| 9 | review-preview | [1440浅](source/outputs/E4-before-review-preview-1440-light.png) / [390浅](source/outputs/E4-before-review-preview-390-light.png) / [1440深](source/outputs/E4-before-review-preview-1440-dark.png) / [390深](source/outputs/E4-before-review-preview-390-dark.png) | [1440浅](source/outputs/E4-after-review-preview-1440-light.png) / [390浅](source/outputs/E4-after-review-preview-390-light.png) / [1440深](source/outputs/E4-after-review-preview-1440-dark.png) / [390深](source/outputs/E4-after-review-preview-390-dark.png) |
| 9 | submission-changes | [1440浅](source/outputs/E4-before-submission-changes-1440-light.png) / [390浅](source/outputs/E4-before-submission-changes-390-light.png) / [1440深](source/outputs/E4-before-submission-changes-1440-dark.png) / [390深](source/outputs/E4-before-submission-changes-390-dark.png) | [1440浅](source/outputs/E4-after-submission-changes-1440-light.png) / [390浅](source/outputs/E4-after-submission-changes-390-light.png) / [1440深](source/outputs/E4-after-submission-changes-1440-dark.png) / [390深](source/outputs/E4-after-submission-changes-390-dark.png) |
| 9 | submission-document | [1440浅](source/outputs/E4-before-submission-document-1440-light.png) / [390浅](source/outputs/E4-before-submission-document-390-light.png) / [1440深](source/outputs/E4-before-submission-document-1440-dark.png) / [390深](source/outputs/E4-before-submission-document-390-dark.png) | [1440浅](source/outputs/E4-after-submission-document-1440-light.png) / [390浅](source/outputs/E4-after-submission-document-390-light.png) / [1440深](source/outputs/E4-after-submission-document-1440-dark.png) / [390深](source/outputs/E4-after-submission-document-390-dark.png) |
| 9 | version-comparison | [1440浅](source/outputs/E4-before-version-comparison-1440-light.png) / [390浅](source/outputs/E4-before-version-comparison-390-light.png) / [1440深](source/outputs/E4-before-version-comparison-1440-dark.png) / [390深](source/outputs/E4-before-version-comparison-390-dark.png) | [1440浅](source/outputs/E4-after-version-comparison-1440-light.png) / [390浅](source/outputs/E4-after-version-comparison-390-light.png) / [1440深](source/outputs/E4-after-version-comparison-1440-dark.png) / [390深](source/outputs/E4-after-version-comparison-390-dark.png) |
| 10 | reading-chart | [1440浅](source/outputs/E4-before-reading-chart-1440-light.png) / [390浅](source/outputs/E4-before-reading-chart-390-light.png) / [1440深](source/outputs/E4-before-reading-chart-1440-dark.png) / [390深](source/outputs/E4-before-reading-chart-390-dark.png) | [1440浅](source/outputs/E4-after-reading-chart-1440-light.png) / [390浅](source/outputs/E4-after-reading-chart-390-light.png) / [1440深](source/outputs/E4-after-reading-chart-1440-dark.png) / [390深](source/outputs/E4-after-reading-chart-390-dark.png) |
| 10 | reading-timeline | [1440浅](source/outputs/E4-before-reading-timeline-1440-light.png) / [390浅](source/outputs/E4-before-reading-timeline-390-light.png) / [1440深](source/outputs/E4-before-reading-timeline-1440-dark.png) / [390深](source/outputs/E4-before-reading-timeline-390-dark.png) | [1440浅](source/outputs/E4-after-reading-timeline-1440-light.png) / [390浅](source/outputs/E4-after-reading-timeline-390-light.png) / [1440深](source/outputs/E4-after-reading-timeline-1440-dark.png) / [390深](source/outputs/E4-after-reading-timeline-390-dark.png) |
| 10 | reading-columns | [1440浅](source/outputs/E4-before-reading-columns-1440-light.png) / [390浅](source/outputs/E4-before-reading-columns-390-light.png) / [1440深](source/outputs/E4-before-reading-columns-1440-dark.png) / [390深](source/outputs/E4-before-reading-columns-390-dark.png) | [1440浅](source/outputs/E4-after-reading-columns-1440-light.png) / [390浅](source/outputs/E4-after-reading-columns-390-light.png) / [1440深](source/outputs/E4-after-reading-columns-1440-dark.png) / [390深](source/outputs/E4-after-reading-columns-390-dark.png) |
| 10 | reading-cards | [1440浅](source/outputs/E4-before-reading-cards-1440-light.png) / [390浅](source/outputs/E4-before-reading-cards-390-light.png) / [1440深](source/outputs/E4-before-reading-cards-1440-dark.png) / [390深](source/outputs/E4-before-reading-cards-390-dark.png) | [1440浅](source/outputs/E4-after-reading-cards-1440-light.png) / [390浅](source/outputs/E4-after-reading-cards-390-light.png) / [1440深](source/outputs/E4-after-reading-cards-1440-dark.png) / [390深](source/outputs/E4-after-reading-cards-390-dark.png) |
| 10 | editing-blocks | [1440浅](source/outputs/E4-before-editing-blocks-1440-light.png) / 390浅：N/A（移动端只读） / [1440深](source/outputs/E4-before-editing-blocks-1440-dark.png) / 390深：N/A（移动端只读） | [1440浅](source/outputs/E4-after-editing-blocks-1440-light.png) / 390浅：N/A（移动端只读） / [1440深](source/outputs/E4-after-editing-blocks-1440-dark.png) / 390深：N/A（移动端只读） |
| 10 | editing-nested | [1440浅](source/outputs/E4-before-editing-nested-1440-light.png) / 390浅：N/A（移动端只读） / [1440深](source/outputs/E4-before-editing-nested-1440-dark.png) / 390深：N/A（移动端只读） | [1440浅](source/outputs/E4-after-editing-nested-1440-light.png) / 390浅：N/A（移动端只读） / [1440深](source/outputs/E4-after-editing-nested-1440-dark.png) / 390深：N/A（移动端只读） |
| 11 | settings-tokens | [1440浅](source/outputs/E4-before-settings-tokens-1440-light.png) / [390浅](source/outputs/E4-before-settings-tokens-390-light.png) / [1440深](source/outputs/E4-before-settings-tokens-1440-dark.png) / [390深](source/outputs/E4-before-settings-tokens-390-dark.png) | [1440浅](source/outputs/E4-after-settings-tokens-1440-light.png) / [390浅](source/outputs/E4-after-settings-tokens-390-light.png) / [1440深](source/outputs/E4-after-settings-tokens-1440-dark.png) / [390深](source/outputs/E4-after-settings-tokens-390-dark.png) |
| 11 | settings-document | [1440浅](source/outputs/E4-before-settings-document-1440-light.png) / [390浅](source/outputs/E4-before-settings-document-390-light.png) / [1440深](source/outputs/E4-before-settings-document-1440-dark.png) / [390深](source/outputs/E4-before-settings-document-390-dark.png) | [1440浅](source/outputs/E4-after-settings-document-1440-light.png) / [390浅](source/outputs/E4-after-settings-document-390-light.png) / [1440深](source/outputs/E4-after-settings-document-1440-dark.png) / [390深](source/outputs/E4-after-settings-document-390-dark.png) |
| 11 | global-error | [1440浅](source/outputs/E4-before-global-error-1440-light.png) / [390浅](source/outputs/E4-before-global-error-390-light.png) / [1440深](source/outputs/E4-before-global-error-1440-dark.png) / [390深](source/outputs/E4-before-global-error-390-dark.png) | [1440浅](source/outputs/E4-after-global-error-1440-light.png) / [390浅](source/outputs/E4-after-global-error-390-light.png) / [1440深](source/outputs/E4-after-global-error-1440-dark.png) / [390深](source/outputs/E4-after-global-error-390-dark.png) |
| 11 | toast | [1440浅](source/outputs/E4-before-toast-1440-light.png) / [390浅](source/outputs/E4-before-toast-390-light.png) / [1440深](source/outputs/E4-before-toast-1440-dark.png) / [390深](source/outputs/E4-before-toast-390-dark.png) | [1440浅](source/outputs/E4-after-toast-1440-light.png) / [390浅](source/outputs/E4-after-toast-390-light.png) / [1440深](source/outputs/E4-after-toast-1440-dark.png) / [390深](source/outputs/E4-after-toast-390-dark.png) |
| 3 | notification-empty | [1440浅](source/outputs/E4-before-notification-empty-1440-light.png) / [390浅](source/outputs/E4-before-notification-empty-390-light.png) / [1440深](source/outputs/E4-before-notification-empty-1440-dark.png) / [390深](source/outputs/E4-before-notification-empty-390-dark.png) | [1440浅](source/outputs/E4-after-notification-empty-1440-light.png) / [390浅](source/outputs/E4-after-notification-empty-390-light.png) / [1440深](source/outputs/E4-after-notification-empty-1440-dark.png) / [390深](source/outputs/E4-after-notification-empty-390-dark.png) |

结果来源：[E4-after-ui-surfaces-results.json](source/outputs/E4-after-ui-surfaces-results.json)、[E4-after-a-ui-surfaces-results.json](source/outputs/E4-after-a-ui-surfaces-results.json)、[E4-after-b-ui-surfaces-results.json](source/outputs/E4-after-b-ui-surfaces-results.json)、[E4-after-c-ui-surfaces-results.json](source/outputs/E4-after-c-ui-surfaces-results.json)、[E4-after-d-ui-surfaces-results.json](source/outputs/E4-after-d-ui-surfaces-results.json)、[E4-after-e-ui-surfaces-results.json](source/outputs/E4-after-e-ui-surfaces-results.json)、[E4-after-repaired-ui-surfaces-results.json](source/outputs/E4-after-repaired-ui-surfaces-results.json)。


### E4 上传区补漏（进行中）

在E5只读级联审查中发现E4上传框的owner CSS虽然写了虚线，但主题泛化input规则使真实样貌仍为solid / 8px / paper，未满足E4.8。新增长期真实应用回归`visual/import-upload.visual.ts`，四个宽度/主题组合均修复前失败（`E4-followup-import-red.log`与`E4-followup-import-red-summary.json`）。立即暂停E5，将已接受01/02按完整备份逆序恢复到E4；未在E5更新基线。修复仅限定原owner选择器为`.create-modal.import-modal input.file-picker[type=file]`，让既有虚线、大圆角、fill声明真正生效；没有TSX/API/数据/流程改动。正在重新verify、更新受影响的E4截图及完整视觉连续两轮。前述“原虚线文件输入保留”的结论不准确，以本次实际computed style和截图为准。恢复证据`E5-paused-for-E4-followup.json`。

## E5 并回记录与CSS行数

E4完整门禁及报告记录后开始。起始CSS总行数9161（`E5-start-inventory.json`）；176张基线SHA256冻结。逐区域实际操作、备份、build与完整visual日志见 [E5-migration-log.md](source/outputs/E5-migration-log.md)。尚未完成整阶段验收。

区域02首次视觉检查31/34通过，已立即回滚该区域并保留区域01；原始失败和回滚证据完整保留。定位到两项测试夹具竞态：OAuth随机ID产生不同换行、移动通知空态在文档/讨论栏挂载前就判断关闭状态。仅修正一次性数据库测试ID和等待挂载/关闭时机，未改生产样式、断言、遮罩或阈值。随后完整视觉连续两轮34/34通过（117.38s、118.19s），0 skipped、0 flaky、0 unexpected，176张原基线SHA均未变。见 [夹具稳定性证据](outputs/E5-fixture-stability-summary.json) 和 [基线完整性](outputs/E5-fixture-baseline-integrity.json)。稳定后重新执行区域02，不将首次失败记作通过。

现有测试保护复核：与原始输入ZIP逐字节比较，108个原有测试文件中106个完全未变，仅已批准B1/B2两个文件改变，无删除、无额外旧测试改动。见 [完整哈希审计](outputs/E5-existing-test-integrity.json) 和 [批准改动diff](outputs/E5-approved-existing-test-diff.patch)。

## 偏离指导

执行顺序偏离已纠正：前一轮在E2/E3缺少各自verify且E3漏4个分享页场景时提前开始E4，先前“完成”记录不准确。已保存并回退E4草稿，重开E2/E3补充验证；不把缺失证据写成通过。E0明列允许先记录B1/B2旧断言和两项hook warning，再由E1处理；不将该预期基线写为全绿。E1保留全部真实构建warning并在负责人特批后进入E2；未过滤warning、提高体积阈值或未经决定前置E7。E2对低频界面明确记录未覆盖，未把替身或静态检查写成真实通过；E3只新增视觉测试与本地测试服务，不改产品交互。26图是旧的不完整清单，已补充至30图并重新生成、连续运行两次。

## 待决定

### D-E4-01：390px 通知空态指针层级（已澄清，纯CSS修复）

真实 Chrome 的390px通知复选框被讨论面板拦截，证据保留在 `outputs/E4-visual-final-fail.log` 与 `outputs/E4-after-notification2-*`。进一步级联定位为顶栏z20低于移动讨论面板z25，通知嵌套在顶栏内；可用组件CSS修复层级，无须改变接口、数据、交互流程。这属于§4允许自行判断的小型可逆视觉选择。前述将其判为产品决定过严，已更正；补失败回归后继续修复，不采用 force/DOM click。另有1440px提及菜单21px横向溢出同样按视觉缺陷修复。E5仍待E4真正门禁完成。

### D-E1-01：严格零warning与可选E7的顺序冲突（已决定）

指导§1.8（`CODEX_UI_GUIDE.md:32`）要求每阶段`pnpm verify`“退出码0，0error，0warning”；E1.4（第104行）再次要求“退出码0，0warning”。但E7（第196行起）把已知646kB主包拆分列为“可选，时间够再做”，并要求拆分后复跑E3才建立的视觉回归。此次真实build还发现两项依赖注释warning。

这是阶段门槛/顺序的冲突；不是现有测试与指导冲突，也不是已经触发§4的依赖新增请求。负责人已明确特批已知构建warning暂留至E7，允许E1–E6继续执行并逐阶段如实记录。未过滤warning、提高体积阈值或提前执行E7。

负责人选择：

2. 特批上述已知构建warning暂留到E7，允许E1–E6继续执行并逐阶段如实记录；其他失败和warning仍按硬规则处理。

## E2/E3 补充验证（前述26图记录为历史过程）

- E2完整verify：`source/outputs/verify-E2.log` exit0，668/668测试、109文件通过，lint零诊断；三条已批准warning保留。一次误收集outputs中的E4草稿测试导致失败，日志`verify-E2-draft-discovery.log`完整保留；草稿已改为非测试扩展名，并未删除产品测试。
- E2新增真实界面覆盖：`E2-ui-coverage-final.json`汇总152组合，142张真实截图、10项移动端N/A（选区工具条/编辑状态受现有移动阅读限制），所有原始失败/重跑证据保留。通知空态原依赖DOM click，不能算pointer通过；此实际布局缺陷交E4处理。
- E3完整基线：30图（新增分享页1440/390双主题），`E3-complete-baseline.log`30通过；`E3-complete-run1.log`30通过33.9s，`E3-complete-run2.log`30通过33.5s；`verify-E3.log`exit0、668/668通过，三条批准warning保留。每个场景检查外部请求/运行错误/429均0，reading讨论面板所有规定宽度打开，desktop正文>=680，实际临时磁盘数据库已自动清理。
- 基线生成与连续运行均在恢复输入CSS之后执行，不使用E4草稿外观；完整截图在`source/outputs/visual-baseline/`。


### E4 最终层级与菜单修正

真实红证据为 `E4-after-b-ui-surfaces-results.json` 中双主题1440px提及菜单scrollWidth1461，以及 `E4-after-e-ui-surfaces-results.json` 中390px通知空态正常pointer被讨论卡片拦截。仅CSS修复：通知存在时顶栏z-index50；提及picker使用composer可用宽度，菜单右锚定。`E4-pointer-menu-green-final.log`真实exit0、2项通过，1440/390几何与pointer测试通过；更早标名red但实际通过的替身日志未作为红证据，见 `E4-pointer-menu-review.md`。当前 `verify-E4-final4.log`exit0、113files/682tests通过；真实app补验12/12与完整visual连续34/34、34/34均完成。
