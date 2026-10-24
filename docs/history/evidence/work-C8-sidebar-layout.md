# C8 805px 紧凑侧栏回归修复

- 日期：2026-10-24。
- 缺陷：Sidebar 的主导航将翻译文字作为裸 text node，既有 ≤980px CSS 隐藏 span 的紧凑规则无法隐藏它；66px 侧栏内出现裁切文字。既有 CSS 已明确图标模式，无新增产品决定。
- 新增测试：`packages/web/src/App-sidebar-layout.test.tsx`，1 条真实 Chrome 回归。
- 测试入口：真实 App 通过本地 API fixture 挂载，取得实际组件 DOM，与递归加载的源码 CSS 一起在真实 Chrome 渲染；不模拟 Sidebar/useWorkspace 等内部模块，也不检查是否存在某种 span 实现。
- 语义和布局断言：805/980 紧凑导航无可见文字；1440 完整导航有文字；两按钮始终可按完整名称找到，图标可见且在按钮内，按钮在侧栏内。覆盖浅/深色。不是完整应用交互验收。
- 环境失败：初次受 sandbox 限制，Chrome launch EPERM/SIGABRT，保存为 `C8-sidebar-layout-environment.log`，不当作缺陷红灯。
- 真正修复前失败：允许本地 Chrome 后 `C8-sidebar-layout-red.log`，805px “All documents”可见文本实际为 `All documents`，图标模式预期空字符串；退出1。
- 修复：仅 `packages/web/src/app/Sidebar.tsx` 将 home/recent 的显示文字包普通 span，让既有响应式规则生效；两按钮加完整翻译 aria-label，紧凑模式仍保留可访问名。不改 CSS 或既有断言。
- 修复后：`C8-sidebar-layout-green.log` 1测试/1文件通过，6种宽度/主题组合；typecheck 和定向 ESLint 均退出0，分别见同名前缀的 `typecheck.log`、`eslint.log`。
- 格式：新测试93行、最长120字符；Sidebar108行、最长120字符。
- 未执行 build；完整最终 verify/build 由主任务统一执行。
