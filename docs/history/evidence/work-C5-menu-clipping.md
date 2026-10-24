# C5 / D2 工具栏菜单真实浏览器回归

真实浏览器截图复核发现，“更多”菜单除了第一个导出项以外，其余项目被工具栏滚动容器裁切。现有组件测试验证了菜单内容、键盘和回调，jsdom 没有真实布局；旧完整验收只检查横向 bounds，不能证明项目实际可点击。

## 先红

测试名：`C5 every menu item must be visible and receive pointer input`。

可重复脚本：`pnpm exec tsx scripts/acceptance-toolbar-menu.ts`。脚本使用临时测试数据库、真实 Chrome、实际网页登录及阅读页，打开菜单后检查每个菜单项中心的 `elementFromPoint` 命中，并实际点击 `Version history` 验证导航。六场景为 360、805、1440px × 浅深主题，不用 CSS 静态断言代替真实可点击性。

修复前实际 exit 1。`C5-menu-clipping-red.log` 和 `C5-menu-results-red.json` 显示：360px 浅色菜单 7 项中仅 `Export HTML` 可命中，其余 6 项均为 false。`C5-menu-clipping-red.png` 保留裁切截图。

该脚本最初两次运行因测试服务 Origin / 手机端隐藏侧栏的等待条件未配置好而停止，记录分别保存在 `C5-menu-harness-origin-error.log` 与 `C5-menu-harness-mobile-sidebar-error.log`，不计为产品红测。修正测试启动条件后才取得上述有效失败，没有为这些脚本错误修改产品。

## 最小修复

`packages/web/src/document-toolbar.css` 的 `.grouped-document-toolbar .document-actions` 增加 `overflow: visible`。旧通用样式的 `overflow-x: auto` 会令另一个轴也成为滚动容器，从而裁切绝对定位菜单；分组后的工具栏已使用 wrap/窄屏专用布局，菜单需要在容器外展开。

完整 `acceptance-browser.ts` 同步增强为逐菜单项真实命中断言，并新增六条菜单观察。没有删除或放宽任何原可见性、版本过滤、权限、溢出或宽度断言；没有修改 550 基线测试断言。

## 修复后验证

统一 build 完成并冻结后，聚焦回归实际 exit 0。`C5-menu-clipping-green.log` 与 `C5-menu-results.json` 记录六场景全部菜单项命中，且实际点击历史菜单导航成功；无 pageerror，外网拦截 0。360px 的 7 项和 805/1440px 的 6 项均可点击，页面 scrollWidth 分别等于 360/805/1440，无横向溢出。六张绿测截图为 `C5-menu-<宽度>-<主题>.png`。

最终完整验收的菜单断言采用同一真实命中标准，另明确检查阅读工具栏的可见按钮数非零，防止空数组的 `.every()` 误判。此浏览器脚本不增加 Vitest 测试总数。

冻结构建后的最终完整验收也实际 exit 0，见 `D2-browser-final.log` 与 `browser-acceptance-results.json`：45 条观察、42 张本轮成功截图、六个菜单场景全部可命中；阅读工具栏按钮数分别为 360px=4、805px=6、1280/1440px=5（浅深一致）。805px 紧凑侧栏两项 accessible name、无裸标签和图标边界检查均通过。所有页面 pageErrors=[]、外网拦截 0；5 条 console error 均为认证/撤销流程的预期 401，没有 404/429 或其他 warning。
