# E4 完整性复核与遗漏补齐

已完整读根 CODEX_UI_GUIDE.md、FRONTEND_REDESIGN.md 与 outputs/E4-plan.md，并对比输入 ZIP 原 CSS。此记录仅说明实现和针对性测试，不代替整阶段 verify、视觉回归及 E2 复验。

## 补齐的展示项

| E4 组 | 当前落实与本次补齐 | 真实截图 surface |
| --- | --- | --- |
| 1 选区 | 前一补丁已做浮动阴影、药丸、按钮不换行；未追加改动 | selection |
| 2 富文本 | 用组件作用域落实 be-rich-toolbar 浅填充，避免临时 html 主题覆盖；rich-editor focus-within 采用 focus-ring 30% 3px 光圈；深色 pressed 保留 accent-soft/accent；行内编辑同样 30% 光圈 | rich-editor；标题输入 focus 由计算样式测试验证 |
| 3 通知 | 原未读点和布局修复保留；列表 hairline，去按钮重复分隔；偏好 checkbox 保持原 checked/onChange，CSS 显示为开关行，焦点清晰；空状态居中浅卡与本地装饰图标 | notifications、notification-preferences、notification-empty |
| 4 分享 | 原弹窗/过期卡保留；已有撤销行内确认加 fill/radius；定位提示加浅表面，流程不变 | share-modal、share-revoke、share-expired、share-page |
| 5 提及 | 用现有 name 首个 Unicode 字符做本地圆形装饰头像；AI 用 AI；原姓名和 onSelect 字符串保留，无图片请求；提及引用改 accent-soft | mentions、selection-summary |
| 6 管理 | 原分段标签/列表/输入/集成卡保留；邀请区为 raised 卡，已有危险行内确认加 fill/radius；次信息字号和换行 | admin-accounts、admin-confirm、integrations |
| 7 授权 | CLI 身份卡无边框 raised，选择行44px/hairline；验证码保留完整可访问文本，装饰字符分格，可收缩网格；OAuth 固定范围只加展示勾号，不添加 checkbox 或改变授权范围；忘记密码/邮件仍沿用 auth-card | cli-consent、oauth-consent、forgot-password、invite、reset |
| 8 导入/AI | 原虚线文件输入、摘要卡、任务卡和状态药丸保留；导入行44px/hairline、预览浅表面；AI textarea 焦点光圈、select36px、工具行可换行 | import-upload、import-preview、ai-tasks、ai-confirm |
| 9 审核对比 | 原结果浅卡/错误/空状态保留；冲突选择36px/radius-s，提交选择行44px；文档容器 min-width0；既有主题已处理的 review-presentation/snapshot/heading 不重复改变 | review、review-preview、submission-changes、submission-document、version-comparison |
| 10 阅读编辑 | 原图表/KPI/卡片主题保留；图表数据 summary44px，timeline 真正 grid gap；编辑子组无边框 raised/radius-m，nested 用1px中性 hairline，表格只保留行分隔并取消逐格阴影；图片文件输入保留原流程 | reading-chart、reading-timeline、reading-columns、reading-cards、editing-blocks、editing-nested |
| 11 全局设置 | 原 global-error/empty-heading 保留；error-pill 为 danger-surface 药丸，unresolved-note 浅状态卡；快捷键帽 fill/body；toast/error 关闭目标36/移动44；token 输入字体/强调色/行高/换行/按钮36/移动44 | settings-tokens、settings-document、global-error、toast |

## 最小 TSX（逐条）

1. features/comments/MentionPicker.tsx：成员与 AI 原按钮内各加 aria-hidden 装饰头像 span 和姓名 span。事件、API、姓名和输出字符串不变。
2. features/auth/CliAuthPanels.tsx：原验证码外层不变，完整文本放在视觉隐藏 span；增加 aria-hidden 的字符分格 span；不改验证码值、输入、提交或校验。
3. OAuthConsent.tsx：原固定权限 ul 加 oauth-scopes class，以 CSS 本地勾号显示；没有增加选择控件或权限数据。

## 测试证据

- outputs/E4-audit-polish-red.log：2 文件6项新增测试均真实失败（缺头像/分格、rich focus、子组旧描边、checkbox未开关、scope无勾号）。
- outputs/E4-audit-polish-green-final.log：5 文件27项通过，包含全部14项既有 CLI 断言。没有修改旧测试。
- outputs/E4-code-width-red.log：补分格后新增窄屏测试发现360宽页面 scrollWidth394。
- outputs/E4-code-width-green.log：改为可收缩网格后5项通过，360/390/1440均在卡片内且页面无横向溢出。
- E4-computed-polish.test.ts 使用真实本机 Chrome，加载 styles.css 递归依赖与实际组件 CSS，检查最终计算样式、焦点和原 checkbox 操作；不依赖 CSS 正则作为实际效果证据。

新增测试合计7项（E4-display-markup 2，E4-computed-polish 5）。阶段总数预计681，最终以完整 verify 日志为准。

## 待决定

本轮补齐没有新增 §4 项。真实头像与拖放上传功能均未引入；采用本地装饰与既有 file input 展示。弹窗焦点约束应在 E6 按其真实现状继续验收。

## 行数

- features/comments/MentionPicker.tsx: 70 行，≤400。
- features/auth/CliAuthPanels.tsx: 335 行，≤400。
- OAuthConsent.tsx: 251 行，≤400。

## 门禁发现的新测试夹具修正

最终 verify 首轮的 security-check 识别了新 E4-display-markup.test.tsx 使用的 innerHTML（测试夹具）。已将该新测试改用 createRoot + act 实际渲染 CliAuthConsent，移除 innerHTML/SSR 解析；全部新断言与旧断言不变，生产代码无变化。定向2项通过（E4-display-markup-safe-render-green.log），security-check 通过（E4-security-check-green.log）。整阶段 verify 由主代理重跑并记录实际结果。
