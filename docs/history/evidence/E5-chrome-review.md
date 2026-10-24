# E5 07-chrome 只读迁移审查

**仅准备。没有apply、build或Chrome运行，没有改生产CSS。**

原apple-chrome完整100个AST rule / 115个selector members：`html .app`一个member由04-document处理（基础toolbar56与document media86跨源依赖），本清单处理余下114个member；另按迁移代理分工处理apple-panels通知基础4个member。118个成员均有明确记录，无manual遗漏。

## 文件与验证

- `outputs/E5-chrome.manifest.json`：region `07-chrome`，210操作：43个定点variables、37个remove（含2个局部变量selector）、14个原规则relocate、116个主题member merge。
- `outputs/E5-chrome-preview.json`：helper实际preview退出0、applied=false；全部预览CSS经PostCSS解析。
- `outputs/E5-chrome-prepare.py` 为重生成脚本。当前22文件hash是E4补漏期间快照。先前03–06会修改这些文件，执行前逐一审查并刷新SHA、去除已由前区消费的member，不能盲目沿用。
- helper新增createContextAfter.atRule由迁移代理实现并检查：只定位现有root media，保留源媒体条件，不依靠新增虚构class。

## 关键合并说明

1. App topbar/sidebar/buttons/body/rails/dialog等继续回原workspace owner，保持C8链路；document toolbar主题回document-toolbar.css，action menu回shared/action-menu.css，mention回discussion.css，notification全部回NotificationBell自导入的notifications.css。
2. 五个局部dark变量先在43个明确原selector引用中按当前等值替换为chrome/fill/hairline/ink/faint-ink，再删除主题topbar和left-sidebar两个局部定义member。toast与其他深色表面保留各自dark语义，不全仓替换。
3. min1440 sidebar宽224的新上下文必须位于workspace12 min1200宽180之后。以现有root min1600 at-rule为显式锚点，创建精确min1440新context，不改原条件、不靠.app提高权重。
4. 当前主题压住的旧mobile/search/sidebar/actions/padding/gap等值显式移除。toolbar max1190旧padding10/16目前被主题base0/24压住，不能在降权后复活；max720保留真正的14px inline例外。
5. 原toolbar base/breadcrumb/action规则先relocate到DocumentToolbar已有导入CSS，再替换主题值；workspace11中不冲突的min-width/grid等原App布局补充保留。
6. 旧notification-popover/head/item/icon及后代原规则按旧相对次序放到notifications.css末尾，再合主题基础值，复现旧静态组件CSS在前、App全局在后的实际计算顺序；E4 `.notifications-modal .notification-item` 两class的grid/border:0继续胜出。
7. 通用focus去html后与旧lazy focus同权，可能恢复原2px/offset3。清单删除当前已被主题压住的DocumentEditor、block-editor button、VersionComparison、ChangeList旧outline/offset；非.app CLI页面focus完全保留。editor字段的独立主题focus保持35%色混合，普通App focus保持45%。
8. ActionMenu键盘项与MentionPicker hover要继续压过通用focus：target使用真实已有容器祖先`.action-menu .action-menu-items button:focus-visible`和`.mention-picker .mention-options button:hover`，并非虚构class。保留蓝底白字和outline:none。
9. SelectionComment button旧padding7/12目前被html.button压成0/14；清单删旧padding以保持实际E4外观。share-links/admin根部旧padding-bottom24同理被html.review-modal padding28压住，删去无效旧值，避免lazy后复活。
10. 不删除仍实际生效的`.app.dark .review-modal {background:var(--dark)}`：它当前权重高于html.review-modal，并非无效旧规则。

## 静态检查结果

- chrome预览仅剩`html .app`，这是04的明确前置消费成员；局部dark定义已无。顺序执行04后本区才会让chrome无有效rule。
- panels四个通知selector已被消费，其他panels selector留给05/06。
- workspace12中min1440新context确实排在现有min1600之后；菜单/mention容器scope确实保留。
- 所有当前预览文件低于700行；后续05将增加discussion.css，仍需代理在实际串行状态检查最终行数。

| 文件 | 原行数 | 预览行数 |
| --- | ---: | ---: |
| `styles/workspace-01.css` | 374 | 428 |
| `styles/workspace-02.css` | 377 | 388 |
| `styles/workspace-07.css` | 397 | 372 |
| `styles/workspace-10.css` | 450 | 438 |
| `styles/workspace-11.css` | 376 | 362 |
| `selection-comment.css` | 49 | 48 |
| `administration.css` | 193 | 192 |
| `sharing.css` | 329 | 328 |
| `document-editor.css` | 85 | 79 |
| `block-editor.css` | 227 | 226 |
| `version-comparison.css` | 201 | 196 |
| `changes.css` | 163 | 158 |
| `document-toolbar.css` | 29 | 91 |
| `styles/workspace-08.css` | 353 | 345 |
| `styles/workspace-06.css` | 376 | 320 |
| `notifications.css` | 183 | 255 |
| `theme/apple-chrome.css` | 629 | 35 |
| `styles/workspace-12.css` | 71 | 78 |
| `shared/action-menu.css` | 45 | 55 |
| `discussion.css` | 199 | 203 |
| `styles/workspace-09.css` | 432 | 432 |
| `theme/apple-panels.css` | 616 | 597 |

本表仅本区受影响文件合计，不是全仓正式CSS前后读数。空theme文件/导入最后由迁移代理确认所有成员已消费后删除。

## 尚需实际验证

- 本清单准备时E5已按root指令退回E4补上传框漏项。E4结束后应重新inventory，并在前置区域之后审查/刷新SHA与occurrence。
- 本区apply后立即build、完整test:visual；无snapshot更新。关注360菜单键盘焦点、1440/390通知、选择浮条、1440编辑focus、805toolbar、1440/1680sidebar和C8。
- 只读审查没有声称视觉0diff；任何真实差异都先恢复本区backup再修，不把预览成功当完成。

## 逐成员覆盖（118）

| 源文件:行 | selector | @context | target | mode |
| --- | --- | --- | --- | --- |
| `theme/apple-chrome.css:9` | `html body` | `base` | `styles/workspace-01.css` `body` | merge |
| `theme/apple-chrome.css:21` | `html .app ::selection` | `base` | `styles/workspace-01.css` `.app ::selection` | new-state |
| `theme/apple-chrome.css:25` | `html .app :is(button, input, select, textarea, a, summary):focus-visible` | `base` | `styles/workspace-01.css` `.app :is(button, input, select, textarea, a, summary):focus-visible` | new-state |
| `theme/apple-chrome.css:31` | `html .topbar` | `base` | `styles/workspace-01/02.css` `reviewed descendants` | remove-local-variables |
| `theme/apple-chrome.css:31` | `html .left-sidebar` | `base` | `styles/workspace-01/02.css` `reviewed descendants` | remove-local-variables |
| `theme/apple-chrome.css:41` | `html .topbar` | `base` | `styles/workspace-01.css` `.topbar` | merge |
| `theme/apple-chrome.css:52` | `html .brand` | `base` | `styles/workspace-01.css` `.brand` | merge |
| `theme/apple-chrome.css:61` | `html .brand-mark` | `base` | `styles/workspace-01.css` `.brand-mark` | merge |
| `theme/apple-chrome.css:67` | `html .brand-mark i` | `base` | `styles/workspace-01.css` `.brand-mark i` | merge |
| `theme/apple-chrome.css:74` | `html .brand-mark i:nth-child(1)` | `base` | `styles/workspace-01.css` `.brand-mark i:nth-child(1)` | merge |
| `theme/apple-chrome.css:79` | `html .brand-mark i:nth-child(2)` | `base` | `styles/workspace-01.css` `.brand-mark i:nth-child(2)` | merge |
| `theme/apple-chrome.css:84` | `html .brand-mark i:nth-child(3)` | `base` | `styles/workspace-01.css` `.brand-mark i:nth-child(3)` | merge |
| `theme/apple-chrome.css:89` | `html .brand-period` | `base` | `styles/workspace-01.css` `.brand-period` | merge |
| `theme/apple-chrome.css:93` | `html .topbar-context` | `base` | `styles/workspace-01.css` `.topbar-context` | merge |
| `theme/apple-chrome.css:99` | `html .topbar-context strong` | `base` | `styles/workspace-01.css` `.topbar-context strong` | merge |
| `theme/apple-chrome.css:104` | `html .search-trigger` | `base` | `styles/workspace-01.css` `.search-trigger` occurrence=0 | merge |
| `theme/apple-chrome.css:104` | `html .search-input` | `base` | `styles/workspace-01.css` `.search-input` occurrence=0 | merge |
| `theme/apple-chrome.css:117` | `html .search-input input` | `base` | `styles/workspace-01.css` `.search-input input` | merge |
| `theme/apple-chrome.css:121` | `html .search-input input::placeholder` | `base` | `styles/workspace-01.css` `.search-input input::placeholder` | new-state |
| `theme/apple-chrome.css:125` | `html .search-input:focus-within` | `base` | `styles/workspace-01.css` `.search-input:focus-within` | new-state |
| `theme/apple-chrome.css:130` | `html .topbar-actions` | `base` | `styles/workspace-01.css` `.topbar-actions` | merge |
| `theme/apple-chrome.css:134` | `html .icon-button` | `base` | `styles/workspace-01.css` `.icon-button` | merge |
| `theme/apple-chrome.css:142` | `html .topbar .icon-button` | `base` | `styles/workspace-01.css` `.topbar .icon-button` | merge |
| `theme/apple-chrome.css:146` | `html .icon-button:hover` | `base` | `styles/workspace-01.css` `.icon-button:hover` | merge |
| `theme/apple-chrome.css:151` | `html .notification-count` | `base` | `notifications.css` `.notification-count` | merge |
| `theme/apple-chrome.css:157` | `html .language-button` | `base` | `styles/workspace-01.css` `.language-button` | merge |
| `theme/apple-chrome.css:165` | `html .language-button:hover` | `base` | `styles/workspace-01.css` `.language-button:hover` | merge |
| `theme/apple-chrome.css:169` | `html .avatar` | `base` | `styles/workspace-01.css` `.avatar` | merge |
| `theme/apple-chrome.css:174` | `html .profile` | `base` | `styles/workspace-01.css` `.profile` | merge |
| `theme/apple-chrome.css:181` | `html .avatar-blue` | `base` | `styles/workspace-01.css` `.avatar-blue` | merge |
| `theme/apple-chrome.css:185` | `html .avatar-gold` | `base` | `styles/workspace-01.css` `.avatar-gold` | merge |
| `theme/apple-chrome.css:190` | `html .app-frame` | `base` | `styles/workspace-01.css` `.app-frame` | merge |
| `theme/apple-chrome.css:194` | `html .left-sidebar` | `base` | `styles/workspace-01.css` `.left-sidebar` | merge |
| `theme/apple-chrome.css:201` | `html .side-workspace` | `base` | `styles/workspace-01.css` `.side-workspace` | merge |
| `theme/apple-chrome.css:207` | `html .side-workspace > div:not(.workspace-avatar)` | `base` | `styles/workspace-01.css` `.side-workspace > div:not(.workspace-avatar)` | new-state |
| `theme/apple-chrome.css:211` | `html .workspace-avatar` | `base` | `styles/workspace-01.css` `.workspace-avatar` | merge |
| `theme/apple-chrome.css:221` | `html .side-workspace strong` | `base` | `styles/workspace-01.css` `.side-workspace strong` | merge |
| `theme/apple-chrome.css:221` | `html .side-workspace span` | `base` | `styles/workspace-01.css` `.side-workspace span` | merge |
| `theme/apple-chrome.css:228` | `html .side-workspace strong` | `base` | `styles/workspace-01.css` `.side-workspace strong` | merge |
| `theme/apple-chrome.css:233` | `html .side-workspace span` | `base` | `styles/workspace-01.css` `.side-workspace span` | merge |
| `theme/apple-chrome.css:239` | `html .primary-nav` | `base` | `styles/workspace-01.css` `.primary-nav` | merge |
| `theme/apple-chrome.css:245` | `html .nav-item` | `base` | `styles/workspace-01.css` `.nav-item` | merge |
| `theme/apple-chrome.css:245` | `html .space-item` | `base` | `styles/workspace-02.css` `.space-item` | merge |
| `theme/apple-chrome.css:255` | `html .nav-item svg` | `base` | `styles/workspace-01.css` `.nav-item svg` | new-state |
| `theme/apple-chrome.css:255` | `html .space-item > svg:first-child` | `base` | `styles/workspace-02.css` `.space-item > svg:first-child` | new-state |
| `theme/apple-chrome.css:260` | `html .nav-item:hover` | `base` | `styles/workspace-02.css` `.nav-item:hover` | merge |
| `theme/apple-chrome.css:260` | `html .space-item:hover` | `base` | `styles/workspace-02.css` `.space-item:hover` | merge |
| `theme/apple-chrome.css:266` | `html .nav-item.active` | `base` | `styles/workspace-02.css` `.nav-item.active` | merge |
| `theme/apple-chrome.css:266` | `html .space-item.selected` | `base` | `styles/workspace-02.css` `.space-item.selected` | merge |
| `theme/apple-chrome.css:274` | `html .nav-count` | `base` | `styles/workspace-02.css` `.nav-count` | merge |
| `theme/apple-chrome.css:280` | `html .side-section` | `base` | `styles/workspace-02.css` `.side-section` | merge |
| `theme/apple-chrome.css:284` | `html .section-label` | `base` | `styles/workspace-02.css` `.section-label` | merge |
| `theme/apple-chrome.css:293` | `html .section-label button` | `base` | `styles/workspace-02.css` `.section-label button` | merge |
| `theme/apple-chrome.css:300` | `html .section-label button:hover` | `base` | `styles/workspace-02.css` `.section-label button:hover` | new-state |
| `theme/apple-chrome.css:305` | `html .space-square` | `base` | `styles/workspace-02.css` `.space-square` | merge |
| `theme/apple-chrome.css:305` | `html .doc-emoji` | `base` | `styles/workspace-02.css` `.doc-emoji` | merge |
| `theme/apple-chrome.css:315` | `html .space-item` | `base` | `styles/workspace-02.css` `.space-item` | merge |
| `theme/apple-chrome.css:319` | `html .space-role` | `base` | `styles/workspace-08.css` `.space-role` | merge |
| `theme/apple-chrome.css:326` | `html .doc-list-item` | `base` | `styles/workspace-02.css` `.doc-list-item` | merge |
| `theme/apple-chrome.css:333` | `html .doc-list-item:hover` | `base` | `styles/workspace-02.css` `.doc-list-item:hover` | merge |
| `theme/apple-chrome.css:337` | `html .doc-list-item.current` | `base` | `styles/workspace-02.css` `.doc-list-item.current` | merge |
| `theme/apple-chrome.css:341` | `html .doc-list-item b` | `base` | `styles/workspace-02.css` `.doc-list-item b` | merge |
| `theme/apple-chrome.css:346` | `html .doc-list-item small` | `base` | `styles/workspace-02.css` `.doc-list-item small` | merge |
| `theme/apple-chrome.css:352` | `html .doc-list-dot` | `base` | `styles/workspace-02.css` `.doc-list-dot` | merge |
| `theme/apple-chrome.css:358` | `html .template-button` | `base` | `styles/workspace-02.css` `.template-button` | merge |
| `theme/apple-chrome.css:365` | `html .template-button b` | `base` | `styles/workspace-02.css` `.template-button b` | merge |
| `theme/apple-chrome.css:369` | `html .template-button small` | `base` | `styles/workspace-02.css` `.template-button small` | merge |
| `theme/apple-chrome.css:373` | `html .template-icon` | `base` | `styles/workspace-02.css` `.template-icon` | merge |
| `theme/apple-chrome.css:381` | `html .sidebar-footer` | `base` | `styles/workspace-02.css` `.sidebar-footer` | merge |
| `theme/apple-chrome.css:387` | `html .left-sidebar` | `@media (min-width: 1440px)` | `styles/workspace-12.css` `.left-sidebar` | new-context |
| `theme/apple-chrome.css:394` | `html .document-toolbar` | `base` | `document-toolbar.css` `.document-toolbar` | merge |
| `theme/apple-chrome.css:404` | `html .breadcrumbs` | `base` | `document-toolbar.css` `.breadcrumbs` | merge |
| `theme/apple-chrome.css:410` | `html .breadcrumbs button` | `base` | `document-toolbar.css` `.breadcrumbs button` | merge |
| `theme/apple-chrome.css:414` | `html .breadcrumbs button:hover` | `base` | `document-toolbar.css` `.breadcrumbs button:hover` | new-state |
| `theme/apple-chrome.css:418` | `html .breadcrumbs b` | `base` | `document-toolbar.css` `.breadcrumbs b` | merge |
| `theme/apple-chrome.css:423` | `html .document-actions` | `base` | `document-toolbar.css` `.document-actions` | merge |
| `theme/apple-chrome.css:427` | `html .document-actions .version-pill` | `base` | `document-toolbar.css` `.document-actions .version-pill` | new-state |
| `theme/apple-chrome.css:436` | `html .outline-rail` | `base` | `styles/workspace-11.css` `.outline-rail` | merge |
| `theme/apple-chrome.css:436` | `html .right-rail` | `base` | `styles/workspace-11.css` `.right-rail` | merge |
| `theme/apple-chrome.css:443` | `html .button` | `base` | `styles/workspace-02.css` `.button` | merge |
| `theme/apple-chrome.css:458` | `html .button:hover` | `base` | `styles/workspace-02.css` `.button:hover` | merge |
| `theme/apple-chrome.css:462` | `html .button:active` | `base` | `styles/workspace-02.css` `.button:active` | new-state |
| `theme/apple-chrome.css:466` | `html .button-primary` | `base` | `styles/workspace-02.css` `.button-primary` | merge |
| `theme/apple-chrome.css:471` | `html .button-primary:hover` | `base` | `styles/workspace-02.css` `.button-primary:hover` | merge |
| `theme/apple-chrome.css:475` | `html .button-soft` | `base` | `styles/workspace-02.css` `.button-soft` | merge |
| `theme/apple-chrome.css:481` | `html .button-soft:hover` | `base` | `styles/workspace-02.css` `.button-soft:hover` | merge |
| `theme/apple-chrome.css:485` | `html .button-ink` | `base` | `styles/workspace-02.css` `.button-ink` | merge |
| `theme/apple-chrome.css:490` | `html .button:disabled` | `base` | `styles/workspace-02.css` `.button:disabled` | new-state |
| `theme/apple-chrome.css:490` | `html .button[aria-disabled='true']` | `base` | `styles/workspace-02.css` `.button[aria-disabled='true']` | new-state |
| `theme/apple-chrome.css:496` | `html .text-link` | `base` | `styles/workspace-06.css` `.text-link` | merge |
| `theme/apple-chrome.css:504` | `html .text-link:hover` | `base` | `styles/workspace-06.css` `.text-link:hover` | new-state |
| `theme/apple-chrome.css:510` | `html .action-menu-items` | `base` | `shared/action-menu.css` `.action-menu-items` | merge |
| `theme/apple-chrome.css:510` | `html .notification-popover` | `base` | `notifications.css` `.notification-popover` | merge |
| `theme/apple-chrome.css:510` | `html .mention-options` | `base` | `discussion.css` `.mention-options` | merge |
| `theme/apple-chrome.css:520` | `html .action-menu-items button` | `base` | `shared/action-menu.css` `.action-menu-items button` | merge |
| `theme/apple-chrome.css:520` | `html .mention-options button` | `base` | `discussion.css` `.mention-options button` | merge |
| `theme/apple-chrome.css:528` | `html .action-menu-items button:hover` | `base` | `shared/action-menu.css` `.action-menu-items button:hover` | merge |
| `theme/apple-chrome.css:528` | `html .action-menu-items button:focus-visible` | `base` | `shared/action-menu.css` `.action-menu-items button:focus-visible` | merge |
| `theme/apple-chrome.css:528` | `html .mention-options button:hover` | `base` | `discussion.css` `.mention-options button:hover` | merge |
| `theme/apple-chrome.css:536` | `html .action-menu-items button.danger-action` | `base` | `shared/action-menu.css` `.action-menu-items button.danger-action` | merge |
| `theme/apple-chrome.css:540` | `html .action-menu-items button.danger-action:hover` | `base` | `shared/action-menu.css` `.action-menu-items button.danger-action:hover` | new-state |
| `theme/apple-chrome.css:546` | `html .overlay` | `base` | `styles/workspace-06.css` `.overlay` | merge |
| `theme/apple-chrome.css:552` | `html .review-modal` | `base` | `styles/workspace-06.css` `.review-modal` | merge |
| `theme/apple-chrome.css:559` | `html .modal-eyebrow` | `base` | `styles/workspace-06.css` `.modal-eyebrow` | merge |
| `theme/apple-chrome.css:569` | `html .modal-top h2` | `base` | `styles/workspace-06.css` `.modal-top h2` | merge |
| `theme/apple-chrome.css:577` | `html .modal-top p` | `base` | `styles/workspace-06.css` `.modal-top p` | merge |
| `theme/apple-chrome.css:582` | `html .modal-close` | `base` | `styles/workspace-06.css` `.modal-close` | merge |
| `theme/apple-chrome.css:590` | `html .modal-close:hover` | `base` | `styles/workspace-06.css` `.modal-close:hover` | new-state |
| `theme/apple-chrome.css:595` | `html .modal-footer` | `base` | `styles/workspace-06.css` `.modal-footer` | merge |
| `theme/apple-chrome.css:600` | `html .toast` | `base` | `styles/workspace-06.css` `.toast` | merge |
| `theme/apple-chrome.css:609` | `html .toggle-switch` | `base` | `styles/workspace-09.css` `.toggle-switch` | merge |
| `theme/apple-chrome.css:614` | `html .right-rail` | `@media (max-width: 980px)` | `styles/workspace-11.css` `.right-rail` | merge |
| `theme/apple-chrome.css:621` | `html .topbar` | `@media (max-width: 720px)` | `styles/workspace-11.css` `.topbar` | merge |
| `theme/apple-chrome.css:626` | `html .document-toolbar` | `@media (max-width: 720px)` | `document-toolbar.css` `.document-toolbar` | new-context |
| `theme/apple-panels.css:353` | `html .popover-head` | `base` | `notifications.css` `.popover-head` | merge |
| `theme/apple-panels.css:358` | `html .popover-head span` | `base` | `notifications.css` `.popover-head span` | merge |
| `theme/apple-panels.css:364` | `html .notification-item` | `base` | `notifications.css` `.notification-item` occurrence=1 | merge |
| `theme/apple-panels.css:368` | `html .notification-icon` | `base` | `notifications.css` `.notification-icon` | merge |
