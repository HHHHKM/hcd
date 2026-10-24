# E4 第 5–11 组静态审计与最小精修建议

本文件是只读审计结论，不是阶段验收。已完整阅读包根 `CODEX_UI_GUIDE.md` 和 `FRONTEND_REDESIGN.md`；没有修改生产或测试文件，没有运行/声称通过 E4 门禁。截图应由真实 app 在 E3 基线完成后采集，不能以本表替代。

## 通用边界

- 使用现有 `--paper`、`--surface-raised`、`--fill`、`--hairline`、`--accent-soft`、`--accent`、`--radius-*`、`--shadow-*`，无需新增 token、依赖、资源或接口。
- 指导中“未覆盖”不等于主题层完全没有这些类：`mention-options`、`comment-quote`、`anchor-status`、`auth-card`、`read-chart-legend`、`chart-gridline`、`change-notice`、`version-snapshot-banner` 已被主题覆盖。E4 在组件 CSS 中精修尚未覆盖的属性；不要提前搬主题或新增 `html` 前缀。同属性被主题覆盖时，留待 E5 迁移，不把无效修改当成完成。
- 所有组都应保留原路由、表单、事件和已有 class。以下无已确认的 §4 决策阻塞；真实截图或旧测试发现冲突后应停止该项并报告。

## 5. @ 提及与讨论细节 — `discussion.css`

现状：菜单虽然已被主题改为纸面浮层，但原宽度仅 180px、按钮无最小行高；空讨论仅一行 12 号文字；`.comment-selection-summary` 缺少容器层次。`.comment-mention` 仍写旧别名 `--warm-paper`。

最小方案：菜单 `width: min(280px, calc(100vw - 48px))`，行 `min-height:44px; display:flex; align-items:center; gap:var(--space-8)`；显示姓名的区域允许换行。空讨论用 `--surface-raised`、`--radius-m`、居中 `--font-size-13`，不新增按钮。选区摘要用 `--fill`、`--radius-m`、`--space-12`；保留已有引用高亮和定位行为。提及文字浅底替换为 `--accent-soft`。

仅可能需要的 TSX：`features/comments/MentionPicker.tsx` 当前成员 API 只有 id/name。用 name 首字生成一个 `aria-hidden="true"` 的 `.mention-avatar` 展示 span，AI 行用同样的本地文字头像；这属于最小展示标记，不新增头像字段/请求。头像用 `--accent-soft` 和 `--accent`、圆形，不引外部头像。按钮的原姓名文本和 click 逻辑保留。

## 6. 管理后台与空间集成 — `administration.css`

现状：`.admin-tabs` 为下划线 tab；列表 `--line`，字号普遍 12；输入框仅 4/5px 圆角；`.space-integrations` 为小圆角描边盒；`.admin-confirm` 没有统一的确认表面。

最小方案：tabs 用 `--fill` 底、`--radius-m`、4px 内距；按钮 `--radius-s`、最小 36px，active 为 `--paper`+轻阴影，不加底边框。列表分隔 `--hairline`，行高至少44px，姓名14、次要13。inputs/selects 36px 高、`--radius-s`，原输入/保存逻辑不变。邀请和集成区用无边框 `--surface-raised`、`--radius-l` 摘要卡；`.admin-confirm` 用 `--fill`、`--radius-m`、危险红字。移动端列表已有纵排、form-grid 已有一列，保留并补 min-width:0/overflow-wrap。

无需 TSX 或交互改变：`features/admin/admin-shared.tsx` 已有 ConfirmAction 行内确认。不要为满足危险操作规范再加第二层流程。

## 7. CLI / OAuth / 邮件链接 / 忘记密码 — `cli-auth.css`、`styles/workspace-07.css`、OAuth 规则位于 `styles/workspace-10.css`

现状：身份卡、scope fieldset 为边框小圆角；checkbox 的 accent-color 使用 `--surface-raised`；结果块为 3px 左边框。验证码已经用 `--font-mono`+`--font-fluid-code`，无需新字体。共同 auth-card 已由主题统一，不能把宽度/阴影另做一套。

最小方案：身份信息用无边框 `--surface-raised`、`--radius-l`；scope fieldset 用 `--hairline`、`--radius-m`，每个选择行44px、底部 hairline，checkbox 改 `--accent-fill`；`.cli-auth-result` 去左边框，改 `--info-surface`+`--radius-m` 的提示块。OAuth 已有 `<ul>` scope 列表，可以 CSS `list-style:none` + `li::before` 本地勾号和 `--accent`；不可把固定授权范围改成可选择交互。现有真实可选择文档 checkbox 保持。

验证码可在现有单个文本容器上用 `--fill`、`--radius-m`、内距、等距数字和现有 letter-spacing 完成视觉分格感；如明确需要逐字符格，可用 `aria-hidden` 装饰 span + `aria-label` 保持完整码，但应单独记录最小 TSX，并核对旧测试文本。此改动不应改变用户输入值或服务端验证码格式。

邮件链接与忘记密码共享 `.auth-card`；只补 `.auth-language` 的次要按钮/焦点和 `.auth-brand` 间距，不改提交/跳转行为。

## 8. 导入与 AI 任务 — `styles/workspace-10.css`

现状：file-picker 只有9px内距；report 每格描边；数值硬写 ui-monospace；module-list 行仅8px上下内距；task-card 只是分隔线；状态 `<strong>` 无标签形态；确认 textarea 无统一边框/圆角/焦点。

最小方案：原 file input 自身用虚线 `--line`、`--radius-l`、`--fill` 和24px内距，不制造拖放事件或新增“拖放”功能文案。report 数值用 `--font-body`+tabular-nums，摘要格无边框 `--surface-raised`+`--radius-m`。module 行44px、hairline。task list 加gap，卡片 `--surface-raised`+`--radius-l`+16px 内距；`.ai-task-heading > strong` 直接做 `--fill` 药丸（13号），无需额外状态 class/数据；状态文字现已区分。工具条wrap、select36px；confirm textarea 用输入框规范并加focus光圈。390宽将toolbar和heading允许wrap。

无需生产 TSX、接口或交互改动。不可因“上传区”规范新增未实现的 drop/paste 流程。

## 9. 审核、对比细节 — `styles/workspace-11.css`、`version-comparison.css`、`changes.css`

现状：`.conflict-placement label` min-width180 可能挤压窄弹窗；submission 内容缺少纸面间距；operation-outcomes / AI 建议只有文本或顶线；change-empty 是一行文字；version-read-error 无状态卡，swap 按钮仅继承基础；version snapshot 基础仍有危险左边框但已被主题修正。

最小方案：conflict-placement label 改 min-width:min(180px,100%)、select36px/`--radius-s`；AI建议/操作结果用 `--fill`+`--radius-m`+12px 内距，不重复现有 conflict 状态色。submission 文档保持现有滚动上限，仅补gap和小标题层级。change-heading align-items:center，metadata13。change-empty/version-read-error 用居中 `--surface-raised`、`--radius-l` 状态容器，错误文字用现有 `--danger`。version-swap 药丸次按钮；comparison result/snapshot 用原 class 间距，不动版本方向或内容。

不要在 E4 删除 `.dark` reconciliation 或搬 theme：那是 E5 要求零视觉差异的独立步骤。不要更改差异 ins/del 语义、隐藏内容或追加交互。

## 10. 阅读块与编辑块 — `block-read.css`、`styles/workspace-04.css`、`block-editor.css`

现状：read chart 的主要色面已被 theme 覆盖，但 read timeline/cards 容器本身缺少gap/min-width；图表数据展开 summary 点击区小；image-upload label 没有上传表面；be-item/group 是 1px实线+5px圆角；be-nested 是 2px左边框；be-data-table 所有单元格四边线；placeholder仅文字。

最小方案：read 容器 min-width:0、gap12/16，不改变传入 CSS grid 列数和图表数据；图表 summary min-height44px/display:flex，legend 使用现有 tokens。image-upload 输入区用 `--fill`、虚线 `--line`、`--radius-l`，图片原比例/max-width保留。be-item/group 用无边框 `--surface-raised`+`--radius-m`，nested 改 `--hairline` 1px 中性缩进（这是结构分隔，不用彩色左边框）；table 用hairline行分隔、表头fill、圆角外层；checkbox 使用accent-fill；placeholder用fill+radius-m+12px。

保留横向数据表自己的滚动容器（不等于页面横向滚动），不要改列的最小内容需求或删表格数据。不要碰 `.document-grid` / `.document-page` 布局预算；C8 直接读取 styles.css 链，原断言680px不可改。E5迁移时同样要保护。

## 11. 全局状态和设置 — `styles/workspace-07/08/09.css`（toast 基础另在 `workspace-06.css`）

现状：global-error 仍为普通error-banner+旧阴影；empty-state 标题为muted-ink；error-pill小圆角+paper；keyboard-hint用mono；token-scopes硬写ui-monospace且无wrap；token-list行按钮仅26px；title-form无wrap。

最小方案：global-error 用 `--danger-surface`、`--danger`、`--radius-m`、`--shadow-float`，关闭按钮至少36px（移动44）；empty标题改ink/18号，已有empty-symbol已由主题变蓝色浅底，保留即可；error-pill用danger-surface+radius-pill；unresolved-note仅补状态浅底/12px内距，保留警告语义。keyboard-hint切 `--font-body`，键帽fill+radius-xs。toast主体已经主题覆盖，只补span/button大小和一致次要颜色。token-scopes flex-wrap、label font-body/13号、accent-fill；token-list hairline、行44px、strong14号、小字13号，按钮36/移动44；title-form flex-wrap，窄屏label flex-basis100%。

## 旧测试与决策结论

搜索旧测试后，相关测试主要验证文本、form存在、路由和请求，不锁死上述radius/gap/token。未发现必须改旧断言的冲突。务必保留原class和scope文本；改文案或拿隐藏元素替换真实控件会超出本计划。

已确认有两项应避免自行引入的产品变更：外部真实头像（现API无字段）和拖放上传流程（现代码file input）。本计划用本地首字头像与file input样式满足视觉目的，因此当前不触发§4停工；若坚持这两种新增功能，则必须先列“待决定”。

## 建议执行和证据

每组先各采 light/dark ×1440/390 改前截图，逐个小补丁后采改后；更新E3对应真实页面场景。可在一个真实页面包含多个细节，但报告应明确截图对应的组与状态。完成所有组后再跑 `pnpm verify`、`pnpm test:visual` 与E2三脚本；授权暂留至E7的三条构建警告仍须如实列出。该授权不覆盖其他警告。
