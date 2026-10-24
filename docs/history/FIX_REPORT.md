# HCD 修复报告

- 快照：hcd-ai-test-20261024-665
- 基线：hcd-ai-test-20261023-550
- 环境：macOS Darwin 27.0.0 arm64 / Node v24.21.0 / pnpm 11.25.0 / Google Chrome 155.0.8059.85 / Playwright 1.64.1
- 任务来源：CODEX_FIX_GUIDE.md；其中 source/ 对应代码根目录。

## 每阶段 verify 结果

| 阶段 | 测试数 / 文件数 | lint | typecheck | build | 失败项 |
| --- | --- | --- | --- | --- | --- |
| A | 561 / 74 | 通过（security scan） | 通过 | 通过 | 默认沙箱首次运行因本地 fixture listener EPERM；允许本地监听后通过 |
| B | 612 / 89（610通过、2失败） | 通过（security scan） | 通过 | 单独执行通过 | B1旧作者编号断言、B2旧固定v1可见v2主题断言；verify在测试处exit1，未运行其末尾build。证据source/outputs/verify-B.log、build-B.log。 |
| C | 662 / 106（660通过、2失败） | 通过，2个exhaustive-deps警告；安全扫描和浅/深27组对比度通过 | 通过 | 单独执行通过 | 与B阶段同样的两条基线断言冲突；其余104文件全部通过。verify在测试处exit1；证据source/outputs/verify-C.log、build-C.log。 |
| D | 665 / 108（663通过、2失败） | 0 error、2个exhaustive-deps警告；安全扫描和浅/深27组对比度通过 | 通过 | 单独执行通过 | 与B/C阶段相同的两条旧断言冲突，106文件通过、2文件失败。verify exit1，在测试处停止，未执行其末尾build。证据source/outputs/verify-D.log、build-D.log。 |


## 任务结果

| 编号 | 状态（完成 / 部分 / 未做） | 改动文件 | 新增测试名 | 说明 |
| --- | --- | --- | --- | --- |
| A1 | 完成 | server/src/app.ts、server/test/proxy.test.ts、deploy/docker-compose.yml、deploy/.env.example、deploy/README.md | A1 separates clients behind a configured proxy subnet（另 6 条安全/配置回归） | 修复前 1 失败 / 2 通过；修复后 7 通过，覆盖显式关闭、多跳代理及登录限流隔离。检查全部 6 处 request.ip，统一由 Fastify trustProxy 解析。日志 source/outputs/A1-red.log、A1-green.log。 |

| A2 | 完成 | core/src/tokens.ts、core/src/index.ts、server/src/app.ts、cli-auth.ts、mcp.ts、cli/src/index.ts、device-login.ts 及测试 | A2 initializes MCP directly with a device-authorized base32 PAT；A2 relays an SDK tool call end to end using a device-authorized PAT（另2条非法格式测试） | 修复前4失败；专项45测试/5文件通过。A2-red.log、A2-green.log。 |
| B1 | 部分 | server/src/app.ts、web/src/VersionComparison.tsx、api.ts及测试 | B1 returns the author name in both version history APIs；B1 hides internal creator IDs and falls back to an unknown-user label | 新测试通过；1条旧断言冲突，见待决定。 |
| B2 | 部分 | server/src/db.ts、app.ts、ai-tasks.ts；web/src/DiscussionThreads.tsx、SharedDocument.tsx及测试 | B2 filters pinned threads and member replies by creation version while keeping every guest-thread reply；B2 upgrades legacy comments…；B2 warns members… | 新测试通过；1条旧断言冲突，见待决定。 |
| B4 | 完成 | server/src/change-worker-client.ts、change-worker.ts、change-presentation.ts、app.ts、deploy/Dockerfile及测试 | B4 keeps health responsive during 5000-paragraph comparison and caches its immutable result；B4 keeps health responsive while preparing a large restore review presentation；B4 limits comparison to ten requests per user per minute independently of normal reads | 独立worker、32项/32MiB LRU、16任务/32MiB队列、60秒超时；生产main/worker bundle本地HTTP smoke通过，未运行Docker。初次3条红测；新增6条权限await边界红测，复查凭证和权限不重复计quota；本阶段全量中的12条B4新增测试均通过。健康检查12.44ms、缓存5.51ms，真实测量见history-diff-benchmark.json和work-B4.md。 |
| B3 | 完成 | server/src/app.ts、db.ts、test/b-auth.test.ts | B3 persists a three-per-hour email reset limit across app instances；B3 adds durable reset counters to an old database without losing accounts or content | 持久化滚动每小时3次；保留原有每分钟防重复发送，均跨重启。 |
| B5 | 部分 | server/src/app.ts、mcp.ts、test/logging.test.ts | B5 logs a route template without secrets, bodies or query strings；B5 never logs share or invite secrets and emits only one entry per request | 路由模板单行JSON，默认测试静默，访客/用户编号；7条日志测试通过，含MCP外层身份、退出/邀请/reset/访客验证身份及显式LOG_LEVEL。测试执行顺序偏差见下。 |
| B6 | 完成 | server/src/app.ts、web/src/LogoutAllSessions.tsx、App.tsx 及测试 | B6 logs out every browser session while leaving personal tokens usable；B6 rejects bearer tokens for logout-all and enforces the write request guard | Cookie专用；页内确认；PAT不受影响。 |
| B7 | 完成 | server/src/app.ts、web/src/PasswordSettings.tsx、App.tsx 及测试 | B7 rejects an incorrect current password without changing credentials；B7 counts wrong current passwords toward the existing login failure limit；B7 keeps the current session, removes other sessions, and invalidates reset links after success | 共用登录失败额度；当前会话保留，其余会话/reset失效。 |
| B8 | 完成 | server/src/app.ts、db.ts、test/token-usage.test.ts、web/src/App.tsx、api.ts | B8 records token last-used time and IP once per minute；B8 upgrades existing token rows without losing token data | 加列迁移；认证每60秒最多更新一次；跨自然分钟边界由SQLite触发器审计写次数；设置显示Intl时间/IP。 |
| B9 | 完成 | server/src/app.ts；web/src/DiscussionThreads.tsx及测试 | B9 lets an active participant resolve and reopen…；B9 requires explicit comment scope…；B9 shows resolution actions… | 回复参与者、未删除参与、角色和PAT明确comment权限。 |
| B10 | 完成 | server/src/internal-request.ts、app.ts、mcp.ts、test/mcp.test.ts | B10 charges one HTTP request and one tool call without charging internal API reads；B10 external callers cannot forge the internal rate-limit bypass | 50篇文档与近额请求回归；随机密钥、常量时间比较；保留外部客户端IP。独立复核补齐仅ai_tasks权限无法读取文档列表的回归，保持无N+1。 |
| B11 | 部分 | server/src/startup.ts、main.ts、test/startup.test.ts、deploy说明 | B11 rejects demo seeding in production before startup | 启动前拒绝生产演示数据；测试通过。测试执行顺序偏差见下。 |

| C1 | 部分（verify有已知旧断言冲突） | web/src/app、features、shared；eslint.config.js、package.json、.prettierrc.json | C1 aborts an older document request and prevents its late response from replacing the selected document；C1 enforces unsafe HTML and hook-order ESLint rules at the frontend source boundary；C1 keeps each frontend implementation file within 400 formatted lines | App拆为全局context、请求/状态hooks和功能视图；AbortController取消并抑制旧响应提交；格式化及大小检查。保留原组件入口导出。lint强制hooks顺序与不安全HTML，安全扫描保留。最终44测试/9文件专项通过；统一格式后C阶段172个、D收尾174个TS/TSX/CSS文件最长379行/120字符。C阶段完整结果如上。 |
| C2 | 部分（verify有已知旧断言冲突） | app/ApplicationRouter.tsx、WorkspaceRouteSync.tsx、use-route-actions.ts、各功能导航 | C2 restores a direct document %s route；C2 waits for the requested historical snapshot before locating its comment hash（详见work-C1-C2.md与work-C2-route-review.md） | react-router路由，URL/刷新/前进后退、版本query和评论hash同步；复查发现的面板/历史加载时序、空间、导入和退出URL逐条先红后修；44测试/9文件专项通过，完整日志见work-C1-C2.md。 |
| C3 | 完成 | web/src/locales/{en,zh-CN}.json、shared/i18n.ts、原各页面、app/workspace-helpers.tsx | C3 AT-15 bundles matching English and Chinese dictionaries with every specified namespace；C3 AT-15 uses existing dot-separated translation keys and removes inline bilingual choices（另错误码/通知/语言回归） | i18next/react-i18next、16命名空间/972键、Intl、账户优先浏览器回退；移除旧内联双语。59测试/9文件综合通过；后续错误提示10测试/4文件通过，真正红绿日志见work-C3.md。JSON为数据资源，各1054行，不计代码文件400行上限。 |
| C4 | 完成 | web/src/tokens.css、全部组件CSS、scripts/check-contrast.mjs、app/use-theme.ts | C4 centralizes component colors and font sizes in accessible light and dark design tokens；C4 follows system changes while the user has no explicit theme preference | 颜色/字体/间距/圆角/阴影集中；文本下限12px、正文15/16；浅深27组对比度通过。主题JS接线先实现后测试，见流程披露。 |
| C5 | 完成 | DocumentToolbar.tsx、shared/ActionMenu.tsx、document-toolbar.css、DocumentWorkspace.tsx、scripts/acceptance-toolbar-menu.ts | C5 groups secondary document actions in a keyboard menu and restores focus on Escape；C5 offers only reading actions at 360px while preserving access to read-only review；C5 the owner toolbar displays the pending submission count before opening review | 桌面编辑/审核计数/分享直显，其余更多；手机隐藏编辑/发布；菜单键盘和焦点。10测试/5文件专项通过，真实浏览器截图在D阶段执行。App整合测试顺序偏差见下。 |
| C6 | 完成 | DiscussionThreads.tsx、features/comments/CommentRow.tsx、discussion.css | C6 keeps reply and resolve visible and requires inline confirmation before deleting from the comment menu | 回复/解决直显，编辑/危险色删除进入菜单；页内确认/取消焦点恢复，保留B2外部主题提示。C6-red.log、C6-focus-red.log及C5-C6-green.log。 |
| C7 | 完成 | styles/workspace-*.css、reading-layout.test.ts | C7 highlights guest quote text without adding a block outline in the browser | 去掉访客外框，精确文字高亮；真实Chrome CSS渲染测试通过，发现通用选择器误覆盖后另有真实红绿；D阶段再做应用流程截图。 |
| C8 | 完成 | styles/workspace-*.css、app/use-panel-state.tsx、app/Sidebar.tsx、features/document/OutlineRail.tsx、App-sidebar-layout.test.tsx | C8 preserves at least 680px of reading text with desktop discussions open；C8面板持久化回归（见App-routing.test.tsx）；C8 remembers both open and collapsed outline choices after remounting the application | 1280/1440正文680px以上、目录折叠/抽屉、讨论栏可收起；真实Chrome布局测量通过。评论栏持久化JS接线测试顺序偏差见下。D收尾补齐目录开关记忆，真实修复前1失败/1通过，修复后与路由/主题共15测试/3文件通过；见work-C8-outline-preference.md。 |

| D1 | 完成 | 54个测试文件的263个标题声明；outputs/AT-coverage.md | 保留原测试，添加AT编号；总测试数不变 | AT-01至AT-44逐项覆盖/部分/未实现/人工待做；263声明、290展开测试有编号。抹去标题后逐字一致；前端标题排版后AST等价，断言/fixture/skip不变。 |
| D2 | 部分（verify保留2项冲突） | scripts/acceptance-browser.ts、acceptance-cli.ts；outputs验收报告和截图 | 实际Chrome/CLI验收；不计Vitest测试数 | frozen-lockfile安装通过。真实CLI login/Chrome授权/MCP工具通过；最终真实Chrome45条观察、42张截图通过；菜单与805侧栏已先红后修并复验；最终verify实际663/665通过、2项旧断言冲突；单独build通过。 |
| D3 | 完成 | START_HERE.md、TEST_PLAN.md、PROGRESS.md、README.md、MANIFEST.json、FIX_REPORT.md | 打包后校验每文件SHA-256及ZIP结构 | 文档更新本轮范围、真实失败与全部推迟项；交付ZIP结构/CRC和MANIFEST全部SHA-256均经实际校验，见包外PACKAGING_CHECK.json。 |

## 测试的非断言改动

保留所有现有测试断言。
- A2 `device-login.test.ts` 的 approved fixture 从43个字符校正为32位base32；`device-auth-integration.test.ts` 的恶意错误响应测试夹具也校正为32位，确保继续触发既有的错误信息保密断言。此为用户最新“断言不改”要求下的夹具校正；它超出指南原仅列明的组件拆分例外，明确披露。
- 流程偏差：B5、B11 初版实现与测试同批写入，未严格做到先运行红测。之后移除新增日志/启动保护验证了测试会失败，再恢复并通过；不能将这两项称作严格的先失败再修复。其余任务依各任务日志记录。
- B6/B7设置UI最初红测stdout未保存，B-settings-ui-red.log是当时所见摘要，非原始日志。

### 阶段 C 的测试与流程披露

- 550基线 `App-comment-selection.test.tsx` 为真实Router增加beforeEach history重置 `/`（只改setup），防止前一fixture地址污染下一fixture；原7条断言全部通过。

- `packages/web` 和 `src` 按 Prettier 120 格式化；只改排版，不改原有断言。`SharedDocument.test.tsx` 把fixture/cleanup移至 `test-fixtures/shared-document.tsx`；`comment-selection.test.tsx` 的DOM测试移至 `comment-selection-dom.test.tsx`，公共模型移至 `test-fixtures/comment-selection.ts`。涉及导入/包装变动，48测试/3文件通过（`C-test-split-green.log`）。原组件入口以re-export保留。
- `BlockEditor`、`SharedDocument`、`Administration`、`CliAuth` 拆分都保留原导出入口；对应既有测试不需修改断言或导入。所有2913条550基线断言经TypeScript AST多重集合复核均保留（`outputs/assertion-integrity.json`）；D最终复核当前3352条断言，未匹配0；2913条基线断言全部保留。
- C5新组件契约测试先运行时因组件尚不存在而失败；App整合测试因并行接入已先通过，之后用原ZIP的App复现旧问题。`C5-app-red.log`是通过日志，不能作为先失败证据；`C5-app-baseline-red.log`是实现后的原版复现。待审数量、C6删除及焦点、后续路由缺陷均有真正修复前失败日志。
- C4主题跟随系统/持久化、C8评论栏本机记忆的JS接线先于其新测试完成，后续3条绿测只证明回归行为，不能声称严格先失败再修。CSS令牌/正文宽度/访客外框有真实修复前红灯。
- C8首次浏览器测试因缺Playwright下载浏览器失败，属于环境错误。改用本机Chrome后，对原布局实测1280px正文370px，再修到至少680px；相关红绿日志保留。CSS布局测试并非D2应用流程验收。
- C3新写的ShareLinks未知错误测试初版误用“请求失败”，原词典为“操作失败”；只校正本轮新测试，重新恢复修复前实现得到3场景真红灯，再修到绿灯；未改基线断言。详见`work-C3.md`。

## 数据库迁移

- B2：comments 增加 created_version；访客优先回填固定版本，其余取创建前最近发布版本，回退1；旧正文/锚点不改，旧库测试覆盖。
- B3：新增 password_reset_attempts(email_hash, attempted_at) 和索引；旧库升级保留账号/文档测试覆盖。
- B8：api_tokens 新增 nullable last_used_at、last_used_ip；ALTER TABLE 增量迁移，旧令牌哈希与身份不变；B8 upgrades existing token rows without losing token data 覆盖。

## 浏览器验收

D2最终真实Chrome验收通过45条观察、生成42张成功截图：360/805/1440浅深色完整展示矩阵，另有1280阅读。菜单逐项真实命中、805紧凑侧栏、访客引用定位检查通过；无pageerror、外网请求0，5条控制台输出均为预期401。完整写入发布链在1440浅色执行，手机按规格隐藏写入/发布。完整步骤、脚本和局限见`source/outputs/browser-acceptance.md`。真实mdoc login→Chrome同意→mdoc mcp initialize/read_document通过，见`cli-acceptance.md`。

## 待决定

- B1：旧 VersionComparison.test.tsx 断言 `Created by: u_owner`，与新要求“未知用户，不能显示内部编号”冲突。保留旧断言与新正确行为；阶段B完整测试该项实际失败，待负责人允许更新过时测试断言。
- B2：旧 comment-selection.test.ts 的“preserving discussion bodies”测试要求固定v1显示v2才创建的根主题，直接与已确认D-1冲突。保留断言与D-1行为，待负责人允许更新过时断言。
- 指南第8节的推迟项仍保持推迟。

## 新发现的问题

D2截图复核发现更多菜单纵向裁切、805px紧凑侧栏文字裁切，均属于C5/C8范围，已先取得真实红灯再补修，见下方D收尾记录。无新增需要产品判断的范围外问题。

## 阶段 B 收尾说明

- 2026-10-24：阶段B完整verify实际为610通过、2失败，共612测试/89文件；这两条均为上述基线断言与明确新规则的冲突。没有改动或跳过断言。按用户指示记入待决定，继续阶段C。
- B4本轮新增成员撤销测试初写期待403，复核后改为既有隐藏资源契约404；并补了四条会话撤销401测试。此校正只涉及本轮新增测试，不涉及550快照的现有断言。

## 阶段 C 收尾说明

- 2026-10-24 16:44：完整verify实际660通过、2失败，共662测试/106文件，32.66秒。两失败与B完全一致，均不改变或跳过断言；按用户要求记待决定后进入D。
- ESLint无error，AuthLink的t和SpaceIntegrations的report各有一个exhaustive-deps warning；app/features无警告。安全扫描与对比度脚本通过。单独build通过，Vite提示主包646.55kB超过500kB建议值；未隐瞒为零警告。
- 根目录57文件排版与长字符串拆分记录在`work-C-root-format.md`/`C-root-format-files.json`；其616个断言AST保持一致。最终全项目复核2913基线断言全部保留，当前3334条assertion，未匹配0。
- 所有代码/CSS已按Prettier printWidth120格式化；172个TS/TSX/CSS最长379行、120字符（两份JSON词典为资源数据）。既有手机审核测试曾真实失败，修复预览导航清空当前预览后7/7通过。

## 阶段 D 过程记录

- `pnpm --store-dir /Users/h/Library/pnpm/store install --frozen-lockfile` exit0，锁文件无需更新，证据install-D.log。明确store参数用于匹配此环境既有node_modules链接。
- CLI：真实`pnpm mdoc login <loopback> --no-open`，Chrome表单登录/核对设备码/仅read单文档批准，默认3秒poll获得32位base32 PAT并私密保存；真实CLI MCP子进程initialize、tools/list20、read_document通过。凭据不输出；外网浏览器请求0；临时DB/凭据/所有子进程清理，见cli-acceptance.md。
- 首次完整应用浏览器执行37条观察通过；加验目标可见性时曾失败，独立缩小诊断发现是验收脚本在原生平滑滚动结束前连续resize/点击。加入稳定等待后未改产品即五场景通过；最终完整复测45条观察通过；实际菜单裁切和侧栏问题则另有真实红绿补修，不能混同脚本假红。

- 证据保存偏差：D2复测时误用 `C7-browser-red.log` 路径覆写了C阶段“通用讨论选择器误影响访客外框”的原始红测stdout。原文件不可恢复，保留说明而不伪造日志。C阶段该修复的绿测及CSS首轮红测仍在；D2定位检查独立使用`D2-guest-*`证据；后来证实其失败属于验收脚本时序。

- D2定位检查的红灯属于harness时序：平滑滚动第一次经过视口时就立刻resize会中断它；等待完成后五场景在未改生产代码下通过。没有为验收假红修改产品代码。

## 阶段 D 首轮验证（视觉补修前）

- 2026-10-24 17:01:42：`pnpm verify` 实际运行37.05秒，107文件、664测试，其中105文件/662测试通过、2文件/2测试失败。没有修改或跳过旧断言；两失败仍是B1作者回退和B2固定版本主题可见性冲突。D2“verify全部通过”这一要求未达成，不将部分通过写成全部通过。
- lint为0 error、2 warning：AuthLink缺少effect依赖t，SpaceIntegrations缺少依赖report；安全扫描、浅/深各27组对比度和typecheck通过。verify因测试exit1未运行其build步骤；随后单独`pnpm build` exit0。构建有Zod注释位置提示及主包646.72kB（gzip202.63kB）超过500kB建议值的Vite警告。
- D阶段补齐C8目录开关本机记忆：先运行新的公开UI测试，重挂载丢失打开选择而失败；实现localStorage异常安全读写后15测试/3文件通过，见`C8-outline-preference-*.log`。这2个新增测试使总数从662变为664。
- 该轮前端173个TS/TSX/CSS文件最长379行、120字符；资源词典不计代码400行上限。基线2913条断言经AST复核全部保留，当时3345条，未匹配0。

## 阶段 D 最终验证与视觉补修

- 2026-10-24 17:17:32：菜单和紧凑侧栏补修后重新运行`pnpm verify`，34.54秒，665测试/108文件，其中663测试/106文件通过，仍为同样2条旧断言失败，exit1。lint为0 error/2 warning，安全扫描、浅深各27组对比度、typecheck通过；verify未运行其build。随后单独`pnpm build` exit0，主包646.84kB（gzip202.64kB），仍有Vite包大小及Zod注释位置提示。
- C5菜单：真实截图发现只第一项可见，其余被工具栏overflow滚动容器裁切。先新增真实Chrome命中测试取得有效红灯（7项仅1项命中），再仅给分组工具栏加`overflow: visible`。可复现脚本`acceptance-toolbar-menu.ts`；见`work-C5-menu-clipping.md`。最初脚本的Origin/手机隐藏侧栏等待错误不算产品红灯。最终应用验收同时逐项检查菜单命中，避免只查横向边界的遗漏。
- C8侧栏：805截图发现既有66px图标导航仍显示被裁切的裸文字。先新增`C8 shows compact sidebar navigation as fully visible named icons at 805px without clipped label text`真实Chrome测试，实际红灯后仅包裹标签并保留翻译aria-label，恢复既有CSS的图标模式；805/980/1440×浅深六组合绿灯。初次Chrome环境错误另存，不作红灯；详见`work-C8-sidebar-layout.md`。
- 新侧栏测试将数量从664/107增为665/108；verify现在包含3项Chrome CSS/组件布局测试，仍不等于D2真实应用全链路。最终前端174个TS/TSX/CSS文件最长379行/120字符；2913条原断言全部保留，当前3352条，未匹配0。首轮D日志保留为`verify-D-before-visual-fixes.log`、`build-D-before-visual-fixes.log`。

## 打包交付

- 文件：`hcd-ai-test-20261024-665.zip`，结构与550快照一致，顶层增加FIX_REPORT.md；代码根保留CODEX_FIX_GUIDE.md，完整规格位于reference/BUILD_SPEC.md。
- MANIFEST.json逐文件记录大小和SHA-256（不含manifest自身）；ZIP另有.sha256和包外PACKAGING_CHECK.json，记录CRC、entry set及每项哈希复核结果。
- 排除node_modules、dist、临时work、tsbuildinfo、数据库和实际.env；保留源码/锁文件/测试/真实日志及42张最终应用截图。旧11张550截图标为历史；早期失败诊断单独标注，不能作当前成功证据。
- 交付仍保留2项旧断言冲突、2项lint warning及构建体积提示；B5/B11等严格先红后修偏差和C7原始stdout丢失均已披露，不将任务部分完成写成完全合规。
