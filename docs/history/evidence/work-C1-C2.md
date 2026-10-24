# C1 / C2 工作记录

代码已冻结，交由主代理运行阶段 C 的统一 `pnpm verify`。本记录的专项测试不是阶段 gate，也不是浏览器验收。

## 结果

- `outputs/C1-C2-final.log`：9 个测试文件、44 条测试全部通过（Vitest / jsdom，2026-10-24 16:42）。包含原 `App-comment-selection.test.tsx` 的全部 7 条、`App-toolbar.test.tsx` 的 6 条、账号设置 3 条、评论组件 3 条，以及路由、时序、空间和偏好专项。
- `outputs/C1-typecheck-current.log`：`pnpm typecheck` 通过。
- `outputs/C1-C2-eslint.log`：`app/`、`features/` 的 ESLint 0 error / 0 warning。VersionComparison 的初始比较值也改成标量依赖，避免重建对象使 effect 反复执行。
- 对 `app/`、`features/` 的 `.ts/.tsx` 按实际 Unicode 字符数检查：无超过 120 字符的行；生产文件均不超过 400 行。`App.tsx` 仅保留 Router / Provider / Shell 入口。
- 此前包含 `VersionComparison.test.tsx` 的 52 条专项运行曾报告 2 失败：B1 的旧断言要求显示内部用户编号（保留未改）；手机预览回归随后已修。后者已在最终专项 7/7 中验证。B1 旧断言冲突由主报告统一披露，不能计作本专项绿灯。

## 实现

- C1：把 App 按 `app/` 和 `features/{document,review,comments,settings,import,history}` 拆分。共享 WorkspaceContext 持有当前用户、语言与文档；视图组件与读写 hooks 分离；SettingsDialog、ReviewDialog、DocumentWorkspace、DiscussionRail 等保留原有类名和主要 DOM 结构。
- C1 请求：`useLatestRequest` 对文档及审核读取提供 AbortController 与“仍是当前请求”双重保护，fetch fixture 即使忽略 abort，旧响应也不能覆盖后选文档。启动 `/auth/config`、`/me` 与其 `/spaces`、`/docs` 子请求在卸载时 abort，且检查取消状态后才提交结果。保存队列、composition 与评论选择既有行为保留。
- C2：ApplicationRouter 使用 react-router；公开的忘记密码、邀请、重置、访客、CLI 和 OAuth 页面继续使用原组件。WorkspaceRouteSync 从 URL 恢复文档、历史 `?v=`、编辑 `?edit=1`、审核及已保存预览、对比方向、个人设置/令牌/通知、AI、导出、新建、导入和现有管理页。
- 文档选择写入地址栏；Back 恢复前一文档，离开编辑 URL 会退出编辑视图。标题加入草稿后写入对应 `?edit=1` URL。普通退出和退出全部设备都进入 `/login`。
- 创建/还原预览进入 `/d/:id/review/:previewId`，刷新按预览编号恢复。导航到已在内存中的同一预览保留其内容，避免重复读取审核队列把刚创建的预览清空；这也修复原手机回归测试。
- 审核请求离开路由时 abort，迟到的审核结果不能在个人设置上方重新打开。Share / Members 使用文档 settings 的 `panel` 查询参数；无 panel 的文档 settings 保留该文档的原标题、AI、成员和分享控件。
- `#comment-<id>` 等待目标版本读取完成，再打开讨论、精确高亮正文以及滚动并高亮对应主题行。定位缓存包含 search，避免历史版本请求尚未完成时把当前版本的定位误记为完成。
- 空间入口写入 `/spaces/:id` 并按空间过滤文档，刷新 / Back 保留选择；指定 `/spaces/:id/settings` 复用 Administration 的指定空间成员和集成面板。`/new` 入口与刷新专项通过。
- 导入预览创建后进入 `/import/:id`，直达时读取原 GET API 恢复报告和预览；取消已保存导入后回到原文档或首页。
- C3 接口适配：移除 App 内嵌字典，统一使用 `useLocaleTranslation`；服务端错误经 `errorText(reason, fallback, locale)` 翻译；启动和登录使用 `preferredLocale`。C3 字典实现和全面检查由该任务代理负责。
- C4/C8 接入：useTheme 跟随系统，显式偏好保存在 localStorage；讨论栏收起偏好跨文档和重新挂载保留；接入目录折叠按钮与父任务的 CSS。

## 真实先红记录

| 日志 | 修复前结果 / 触发点 |
| --- | --- |
| C1-C2-red.log | 初始 6 条失败：文档读取取消与直达历史、对比、审核、设置、评论锚点 |
| C2-compare-route-red.log | 反向 2→1 对比被默认 1→2 覆盖 |
| C2-preview-route-red.log | 新预览创建后 URL 停留审核队列，刷新无法恢复 |
| C2-toolbar-route-red.log | Share/Members 导航后面板被清空，以及 Back 后编辑态残留；由 C5 代理编写 |
| C2-settings-title-red.log | 标题进入草稿后 URL 留在个人设置；由 C5 代理编写 |
| C2-timing-red.log | 审核请求未取消；历史版本未返回就定位当前版本；由 C5 代理编写 |
| C2-comment-topic-red.log | 评论主题行缺少高亮与滚动 |
| C2-spaces-red.log | 空间入口 URL/filter 与指定空间 settings 未恢复；由 C5 代理编写 |
| C1-C2-gaps-red.log | 最终保留的 4 条中 3 条真实失败：启动请求无 signal、saved import 未恢复、普通退出 URL 未更新；文档 settings 原已通过 |
| C2-logout-all-route-red.log | 退出全部设备后的 URL 是首页，尚未进入 `/login` |
| C2-import-prepare-route-red.log | 导入预览创建后 URL 仍为 `/import` |
| C2-import-discard-route-red.log | 丢弃导入后 URL 仍指向已丢弃导入 |

手机预览回归是既有测试在本次改动后真实失败，见较早的 `C-root-format-tests.log` 及本专项运行；没有改其断言来通过。

## 测试调整与流程偏差

1. 550 基线 `App-comment-selection.test.tsx` 增加每次测试前把浏览器 history 重置为 `/` 的 setup，并导入 beforeEach。引入真实 Router 后，上一条测试的 URL 会保留到下一条 fixture；断言全部保留。
2. C5 新增的 `C2-route-timing.test.tsx` 的 scroll spy 只记录 `.document-page` 内的正文滚动，保持其 `[] → ['v1']` 时序断言。主题行的独立滚动由 `C2-comment-topic` 用例验证。仅调整这一轮新测试的观测范围，没有改变基线断言。
3. C4 的 useTheme 与 C8 的讨论收起偏好是在 C1 状态适配时先实现，随后才补专门测试；不满足本轮“每缺陷先红”的流程要求。`C4-C8-preferences-green.log` 的 3 条和最终专项只证明修复后的行为，不能冒充修复前失败证据。目录按钮接入同属先实现的布局适配，由主代理如实记录。
4. 新写 `/new` 测试时曾误用不存在的 aria 标签造成假红，发现后删除这一条重复用例；C5 代理独立的 `/new` 入口+刷新用例一直通过。没有为这个假红修改产品代码；最终 gaps-red 日志只包含保留的真实测试。
5. 新写 discard 测试最初用错英文按钮文本，改为实际 DOM 的 footer 按钮 selector 后才捕获 URL 停留的真实失败；保留的 discard-red 日志为该真实失败，没有改断言。

## 验收边界

以上为 jsdom 和类型/静态检查；没有把它们作为真实浏览器验收。1440 / 805 / 360 与浅深色的完整流程由主代理在 D2 执行并记录。没有连接真实外部邮件、飞书或 OAuth 服务。没有扩展本轮推迟的审计、自动发布、模块负责人等功能。
