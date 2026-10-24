# E5 unresolved selector owner review（只读）

基于当前 `outputs/E5-unresolved-owner-candidates.json` 逐条审核 110 个无精确候选或候选有多个 owner 的主题成员。没有运行 Chrome、没有抢占服务器、没有修改生产文件或 apply。机器可读映射和冲突明细在 `E5-unresolved-owner-review.json`。

## 先给迁移代理的结论

- `apple-chrome.css`：全局 body/app/selection/focus 应留在 `styles/workspace-01.css` 的全局 owner；文档工具栏、breadcrumbs、actions 按 `document-toolbar.css`/workspace-02 owner；菜单按 `shared/action-menu.css`；rail/sidebar 的响应式布局按 workspace-02/04/07/10/11/12 的原媒体 owner。无候选的图标/hover/focus 均可在最接近 owner 的同一上下文显式 createAfter，不要把全局规则追加到 styles.css。
- `apple-document.css`：正文标题/模块按 workspace-03，阅读图表按 `block-read.css`，全局表格 th/td 按 workspace-04，编辑 dock 按 document-editor，分享页 `.shared-*` 按 sharing.css，响应式 outline/kpi/title 按原媒体 owner。`html th/td` 是全局候选且有多个重复，必须按 occurrence 和实际链路处理，避免误合到 component CSS 破坏 C8。
- `apple-editor.css`：editor manifest 已单独准备；其无候选状态需 createAfter，但应保留 E4 新增富文本 focus/toolbar 规则及验证码等其它 E4补丁。
- `apple-pages.css`：auth/settings/home/general dark 多属 workspace-07/08/09/10；share/guest 属 sharing.css；`:has(.version-history-page,.history-page)` 属 workspace-11；mobile note 属 workspace-11 原媒体。固定 `:has` 和 `> .outline-toggle` 限制不能丢。
- `apple-panels.css`：rail 布局按 workspace-04/07/10/11/12 原媒体，tabs 按 workspace-05，讨论 composer/activity 按 workspace-05，notifications 按 notifications.css，changes 按 changes.css，history/version 按 version-comparison/styles-workspace-08。`.notification-item` 必须保留 E4 modal 专用 grid 和 topbar z50。

## 必须在 apply 前核对的复杂冲突

1. **`.app` custom property**：theme base 为 56px，但 document theme 的 `@media(max-width:1190)` 已明确 86px；workspace-11 同媒体也有 `.app` 86px。当前有效值是宽屏56、≤1190 86。合回时保留两条和媒体上下文，不可只迁移基础声明。
2. **全局 focus**：`html .app :is(...):focus-visible` 若去掉 html，组件后注入的 focus 规则可能重胜；与 document-editor、block-editor、CLI、rich-text、workspace-01 原焦点规则都有冲突。应以当前 computed 为准逐属性合并，保留 E4 rich-editor 30% focus 光圈，不能变成全局单一 outline。
3. **settings-section**：theme 一类选择器无法覆盖 `.settings-modal .settings-section` 的更高specificity border-top；迁移 `border-color` 可能无效果或改变边框色。需针对原2class规则处理，不能把无效主题声明当视觉证据。
4. **editor `.block-editor button:not(.be-inline-preview)`**：不要扩成所有 button；inline-preview有独立42px/paper/focus规则，且 E4新增 `.block-editor .be-rich-toolbar` 必须保留。
5. **notifications `.notification-item`**：workspace-06 的 popover旧 grid 与 notifications.css modal grid 不是同一语义；主题 border-bottom消费时必须保留 E4 `.notifications-modal .notification-item { grid-template-columns:minmax(0,1fr); border-bottom:0 }`，以及 `.topbar:has(.notifications-modal){z-index:50}`。
6. **媒体规则**：原媒体条件 1440、1200、1190、980、760、720 各有实际语义；不能用相近条件冒充。C8只读 styles.css 链，layout owner必须留在 workspace owners。
7. **dark reconciliation**：workspace-08/version-comparison 的 `.dark`组合需拆 selector 成员。版本 snapshot 暗色有效背景为 surface-raised，不能机械换成 panels warning-surface。保留与 E4视觉一致的成员。
8. **`:has` history outline**：`.main-area:has(.version-history-page,.history-page) > .outline-toggle` 是新增状态，可在 workspace-11 同基础上下文显式 createAfter；不得扩大到所有 outline toggle。
9. **right-tabs**：分段按钮、first/nth-child、active和more各有状态；迁移不能把 `:not(.right-tab-more)` 扩为 more，需拆成员并消费旧 active underline。

## 使用方式

该审查没有可直接 apply 的 SHA manifest，因为 E5 区域迁移并行修改会使候选快照失效。每次正式迁移前重新读取当前 CSS、选择一个 owner 区域、生成包含当前哈希和 occurrence 的单区域 manifest，再 preview → 人工检查 → apply → build + test:visual；遇到无法零差异的步骤按 §4 写入待决定并停该步。
