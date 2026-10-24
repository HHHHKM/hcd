# E2 真实环境视觉验收

日期：2026-10-24
浏览器：Chrome 155.0.8059.85（Playwright 1.64.1，headless，macOS）
构建：`pnpm build` 退出码 0，详见 `E2-build.log`。

## 脚本结果

| 脚本 | 结果 | 证据 |
|---|---|---|
| `scripts/acceptance-browser.ts` | PASS，45 observations；pageErrors 0；blockedExternalRequests 0 | `E2-acceptance-browser.log`, `E2-browser-acceptance-results.json` |
| `scripts/acceptance-toolbar-menu.ts` | PASS，6 viewport/theme scenarios；pageErrors 0；blockedExternalRequests 0 | `E2-acceptance-toolbar-menu.log`, `E2-toolbar-menu-results.json` |
| `scripts/acceptance-guest-scroll.ts` | PASS，5 viewport/theme scenarios；pageErrors 0 | `E2-acceptance-guest-scroll.log`, `E2-guest-scroll-results.json` |

浏览器脚本通过本地一次性 SQLite/HTTP 服务运行，路由拦截统计外部请求为 0。browser acceptance 的 console 仅记录预期的本地 401 未授权响应，没有 page error。

## 截图对照

`E2-reading-*` 对照 `reference/apple-ui-preview/doc-*`；`E2-review-*`、`E2-comparison-*`、`E2-settings-*`、`E2-guest-highlight-*` 和 `E2-toolbar-menu-*` 分别对照对应场景。macOS 系统字体与参考图的 Linux 字体不同，英文脚本文案也与中文参考图不同；检查重点结果如下：

- 360/805/1280/1440 下正文、工具栏和菜单无横向溢出，菜单项目均在视口内且可点击。
- 深浅主题的背景、圆角表面、蓝色强调色和深色文字层次保持 Apple 风格；深色标题和输入控件清晰。
- 共享访客引用在 360/805/1440、浅色/深色下均保持在可视区域内。
- 评论锚点高亮、编辑提交、审核发布、版本对比、设置及登出全部走真实 API 并通过。
- 未观察到旧米色背景、深色侧栏、衬线标题、方角按钮、工具栏文字截断或弹层越界。

E2 脚本没有覆盖的 rich editor、@提及选择器、选区评论浮层、通知弹窗、分享链接弹窗、导入/AI、管理后台、CLI/OAuth、忘记密码/邮件链接和全局错误 toast，按指南留到 E4 的逐组件检查。

## 已知结果

构建保留三条指南已批准暂留至 E7 的已知警告：两条来自 Zod 注释位置，一条来自主 chunk 646.84 kB 超过 500 kB。原始输出保存在 `E2-build.log`，未隐藏或改写。
