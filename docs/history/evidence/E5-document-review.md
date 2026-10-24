# E5 04-document 只读迁移审查

状态：**仅生成 manifest 和内存 preview，未 apply、未 build、未运行 Chrome、未改生产 CSS。**

完整读取 `theme/apple-document.css` 的94个AST rule、109个selector members；清单逐成员记录source declaration SHA256、媒体条件、原owner和操作原因。109成员已映射，无待手工遗漏项。另经迁移代理同意消费 `apple-chrome.css` 的 `html .app` 一个成员，使工具栏基础56px / <=1190px 86px 的变量级联一起迁移。

## 可执行文件与只读验证

- `outputs/E5-document.manifest.json`：区域 `04-document`，124个显式操作：110个消费源merge（document109 + chrome1）、1个不消费源的同范围paragraph fanout、11个旧声明清理、2个原规则relocation。
- `outputs/E5-document-preview.json`：helper `preview` 实际退出0；每个输出已由helper重新按PostCSS解析。这里只是AST预览成功，不能代替视觉验收。
- `outputs/E5-document-prepare.py`：可重生成准备脚本。清单采用准备时17个文件hash；region03完成后必须人工审查相关差异并刷新SHA，再preview。不要直接沿用过期hash或删掉guard。

## 所有权与级联处理

1. 纸面、标题、模块、正文排版、目录等App布局继续在原workspace owner，保留C8仅递归加载styles.css的预算链路。可复用read-chart / callout variants / image等合到block-read；highlight到anchor-text；定位outline到discussion且保留.app；共享heading到sharing。
2. `.edit-dock` 和其主按钮先把原workspace-04规则搬到DocumentEditor已自导入的document-editor.css，再替换主题圆角/阴影/颜色；没有新增import。原组件已有的flex-wrap规则保留。
3. 删除此前被html主题压住的旧media声明：document-page在max1190、min981、min1200、max760的padding；max720的h1字号、doc-meta gap、doc-module网格/下间距、module-gutter右padding、module-body左padding、idea-card min-height。
4. <=980px KPI保留repeat(2,minmax(0,1fr))；删除旧<=720px的1fr 1fr，避免其自动最小宽在降权后再次赢过新规则。981–1599px outline.open用精确的新媒体上下文，不能扩大为所有>=981。
5. `.module-content p` 目前比timeline/idea/callout/rich-text段落规则更强。降权后将其归入workspace-11现有正文排版之后，以保留14px下间距。tiptap的block-editor CSS会懒加载晚注入，因此额外创建`.module-content .be-inline-content p`，只覆盖原主题已命中的祖先范围；保留独立`.be-inline-content p {margin:0}`的外部行为。此fanout复用同一源但只在泛型member正式merge时消费一次。
6. callout warn/danger/success旧border-left原本被html.callout的border:0压住；合并时明确删除，防止彩色左线复活。
7. th/td共用基础规则与各自类型规则按target occurrence区分；outline-item span和iframe的多条源按declaration hash区分。dark卡片只拆当前selector成员，保留组合中其他成员。
8. C7静态防线：保留.hcd-anchor-highlight、两条clone声明和forced-colors；定位/线程outline继续仅.app内生效。预览静态确认上述声明存在且未出现全局定位属性选择器。

## 实际preview文件变化

| Owner / source | 原行数 | 预览行数 |
| --- | ---: | ---: |
| `theme/apple-chrome.css` | 629 | 624 |
| `styles/workspace-11.css` | 376 | 390 |
| `styles/workspace-07.css` | 397 | 377 |
| `styles/workspace-12.css` | 71 | 65 |
| `document-editor.css` | 85 | 101 |
| `styles/workspace-04.css` | 377 | 385 |
| `theme/apple-document.css` | 568 | 32 |
| `styles/workspace-03.css` | 381 | 410 |
| `styles/workspace-01.css` | 374 | 395 |
| `block-read.css` | 150 | 173 |
| `sharing.css` | 329 | 338 |
| `block-editor.css` | 227 | 231 |
| `styles/workspace-08.css` | 363 | 365 |
| `anchor-text.css` | 34 | 37 |
| `discussion.css` | 199 | 201 |
| `styles/workspace-02.css` | 377 | 390 |
| `styles/workspace-09.css` | 432 | 433 |

所有预览CSS均低于700行。document主题目前只剩注释与空media wrapper、无有效rule；为了分离所有成员确认与导入删除，本清单尚未删除文件/import。迁移代理在零diff gate通过后可确认并清理。

## 仍必须实际验证

- region03改动后的SHA与精确selector occurrence；尤其document-editor、block-editor、workspace04/08/09。
- 应用该单一区域后 `pnpm build`，完整 `pnpm test:visual` 对未更改基线必须通过；任何差异先恢复该区域backup再修清单。
- 关注1440编辑模式的tiptap段落、浅深阅读卡片、805/390纸面和KPI、981–1599 outline打开状态、C7/C8。
- 本准备未发现确定§4产品阻塞；没有声称E5完成或0视觉差异。三条已知build warning已有用户许可暂留E1–E6，不重复申请。

## 逐成员覆盖（109 / 109）

| 源行 | 源selector | @context | 原owner / target | 操作 |
| ---: | --- | --- | --- | --- |
| 8 | `html .document-page` | `base` | `styles/workspace-03.css` `.document-page` | merge |
| 16 | `html .app.dark .document-page` | `base` | `styles/workspace-01.css` `.app.dark .document-page` | merge |
| 20 | `html .outline-toggle.button` | `base` | `styles/workspace-11.css` `.outline-toggle.button` | new-state |
| 29 | `html .doc-kicker` | `base` | `styles/workspace-03.css` `.doc-kicker` | merge |
| 39 | `html .doc-kicker i` | `base` | `styles/workspace-03.css` `.doc-kicker i` | merge |
| 46 | `html .kicker-mark` | `base` | `styles/workspace-03.css` `.kicker-mark` | merge |
| 51 | `html .more-inline` | `base` | `styles/workspace-03.css` `.more-inline` | merge |
| 51 | `html .module-comment` | `base` | `styles/workspace-03.css` `.module-comment` | merge |
| 61 | `html .more-inline:hover` | `base` | `styles/workspace-03.css` `.more-inline:hover` | new-state |
| 61 | `html .module-comment:hover` | `base` | `styles/workspace-03.css` `.module-comment:hover` | merge |
| 67 | `html .doc-title-block` | `base` | `styles/workspace-03.css` `.doc-title-block` | merge |
| 73 | `html .doc-title-block h1` | `base` | `styles/workspace-03.css` `.doc-title-block h1` | merge |
| 81 | `html .doc-title-block > p` | `base` | `styles/workspace-03.css` `.doc-title-block > p` | merge |
| 87 | `html .doc-meta` | `base` | `styles/workspace-03.css` `.doc-meta` | merge |
| 93 | `html .doc-meta .avatar` | `base` | `styles/workspace-03.css` `.doc-meta .avatar` | merge |
| 98 | `html .doc-meta b` | `base` | `styles/workspace-03.css` `.doc-meta b` | merge |
| 102 | `html .meta-separator` | `base` | `styles/workspace-03.css` `.meta-separator` | merge |
| 107 | `html .version-pill i` | `base` | `styles/workspace-03.css` `.version-pill i` | merge |
| 111 | `html .version-pill b` | `base` | `styles/workspace-03.css` `.version-pill b` | merge |
| 117 | `html .doc-module` | `base` | `styles/workspace-03.css` `.doc-module` | merge |
| 122 | `html .module-gutter` | `base` | `styles/workspace-03.css` `.module-gutter` | merge |
| 129 | `html .module-number` | `base` | `styles/workspace-03.css` `.module-number` | merge |
| 139 | `html .module-line` | `base` | `styles/workspace-03.css` `.module-line` | merge |
| 143 | `html .module-body` | `base` | `styles/workspace-03.css` `.module-body` | merge |
| 147 | `html .module-title-row` | `base` | `styles/workspace-03.css` `.module-title-row` | merge |
| 152 | `html .module-title-row h2` | `base` | `styles/workspace-03.css` `.module-title-row h2` | merge |
| 160 | `html .module-content` | `base` | `styles/workspace-03.css` `.module-content` | merge |
| 166 | `html .module-content .edit-heading` | `base` | `block-read.css` `.module-content .edit-heading` | new-state |
| 166 | `html .shared-module .edit-heading` | `base` | `sharing.css` `.shared-module .edit-heading` | new-state |
| 166 | `html .module-heading` | `base` | `styles/workspace-03.css` `.module-heading` | merge |
| 178 | `html .module-content p` | `base` | `styles/workspace-11.css` `.module-content p` | new-state |
| 178 | `html .module-paragraph` | `base` | `styles/workspace-03.css` `.module-paragraph` | merge |
| 184 | `html .edited-dot` | `base` | `styles/workspace-03.css` `.edited-dot` | merge |
| 190 | `html .edited-dot i` | `base` | `styles/workspace-03.css` `.edited-dot i` | merge |
| 195 | `html .kpi-grid` | `base` | `styles/workspace-04.css` `.kpi-grid` | merge |
| 200 | `html .kpi` | `base` | `styles/workspace-04.css` `.kpi` | merge |
| 200 | `html .app.dark .kpi` | `base` | `styles/workspace-01.css` `.app.dark .kpi` | merge |
| 208 | `html .kpi span` | `base` | `styles/workspace-04.css` `.kpi span` | merge |
| 213 | `html .kpi strong` | `base` | `styles/workspace-04.css` `.kpi strong` | merge |
| 222 | `html .kpi small` | `base` | `styles/workspace-04.css` `.kpi small` | merge |
| 229 | `html .chart-card` | `base` | `styles/workspace-04.css` `.chart-card` | merge |
| 229 | `html .app.dark .chart-card` | `base` | `styles/workspace-01.css` `.app.dark .chart-card` | merge |
| 239 | `html .chart-title` | `base` | `styles/workspace-04.css` `.chart-title` | merge |
| 245 | `html .chart-title small` | `base` | `styles/workspace-04.css` `.chart-title small` | new-state |
| 250 | `html .read-chart-legend` | `base` | `block-read.css` `.read-chart-legend` | merge |
| 255 | `html .read-chart-legend i` | `base` | `block-read.css` `.read-chart-legend i` | merge |
| 259 | `html .chart-gridline` | `base` | `block-read.css` `.chart-gridline` | merge |
| 263 | `html .chart-data summary` | `base` | `block-read.css` `.chart-data summary` | merge |
| 269 | `html .callout` | `base` | `styles/workspace-04.css` `.callout` | merge |
| 281 | `html .callout-mark` | `base` | `styles/workspace-04.css` `.callout-mark` | merge |
| 286 | `html .callout strong` | `base` | `styles/workspace-08.css` `.callout strong` | merge |
| 291 | `html .callout p` | `base` | `styles/workspace-08.css` `.callout p` | merge |
| 295 | `html .callout-warn` | `base` | `block-read.css` `.callout-warn` | merge |
| 299 | `html .callout-warn .callout-mark` | `base` | `block-read.css` `.callout-warn .callout-mark` | new-state |
| 303 | `html .callout-danger` | `base` | `block-read.css` `.callout-danger` | merge |
| 307 | `html .callout-danger .callout-mark` | `base` | `block-read.css` `.callout-danger .callout-mark` | new-state |
| 311 | `html .callout-success` | `base` | `block-read.css` `.callout-success` | merge |
| 315 | `html .callout-success .callout-mark` | `base` | `block-read.css` `.callout-success .callout-mark` | new-state |
| 319 | `html .timeline` | `base` | `styles/workspace-04.css` `.timeline` | merge |
| 324 | `html .timeline-item` | `base` | `styles/workspace-04.css` `.timeline-item` | merge |
| 329 | `html .timeline-side` | `base` | `styles/workspace-04.css` `.timeline-side` | merge |
| 338 | `html .timeline-side i` | `base` | `styles/workspace-04.css` `.timeline-side i` | merge |
| 346 | `html .timeline-side i.active` | `base` | `styles/workspace-04.css` `.timeline-side i.active` | merge |
| 350 | `html .timeline-copy` | `base` | `styles/workspace-04.css` `.timeline-copy` | merge |
| 354 | `html .timeline-copy strong` | `base` | `styles/workspace-04.css` `.timeline-copy strong` | merge |
| 358 | `html .timeline-copy p` | `base` | `styles/workspace-04.css` `.timeline-copy p` | merge |
| 363 | `html .idea-grid` | `base` | `styles/workspace-04.css` `.idea-grid` | merge |
| 367 | `html .idea-card` | `base` | `styles/workspace-04.css` `.idea-card` | merge |
| 367 | `html .app.dark .idea-card` | `base` | `styles/workspace-01.css` `.app.dark .idea-card` | merge |
| 376 | `html .idea-card > span` | `base` | `styles/workspace-04.css` `.idea-card > span` | merge |
| 383 | `html .idea-card h4` | `base` | `styles/workspace-04.css` `.idea-card h4` | merge |
| 390 | `html .idea-card p` | `base` | `styles/workspace-04.css` `.idea-card p` | merge |
| 395 | `html table` | `base` | `styles/workspace-04.css` `table` | merge |
| 399 | `html th` | `base` | `styles/workspace-04.css` `th` occurrence=0 | merge |
| 399 | `html td` | `base` | `styles/workspace-04.css` `td` occurrence=0 | merge |
| 405 | `html th` | `base` | `styles/workspace-04.css` `th` occurrence=1 | merge |
| 413 | `html td` | `base` | `styles/workspace-04.css` `td` occurrence=1 | merge |
| 417 | `html .table-scroll caption` | `base` | `block-read.css` `.table-scroll caption` | merge |
| 422 | `html .inline-change` | `base` | `styles/workspace-04.css` `.inline-change` | merge |
| 427 | `html .module-quote` | `base` | `styles/workspace-08.css` `.module-quote` | merge |
| 432 | `html .document-image img` | `base` | `block-read.css` `.document-image img` | merge |
| 432 | `html .document-raw iframe` | `base` | `block-read.css` `.document-raw iframe` | merge |
| 437 | `html .document-raw iframe` | `base` | `block-read.css` `.document-raw iframe` | merge |
| 441 | `html .doc-end` | `base` | `styles/workspace-04.css` `.doc-end` | merge |
| 445 | `html .doc-end span` | `base` | `styles/workspace-04.css` `.doc-end span` | merge |
| 450 | `html .hcd-anchor-highlight` | `base` | `anchor-text.css` `.hcd-anchor-highlight` | merge |
| 450 | `html .dark .hcd-anchor-highlight` | `base` | `anchor-text.css` `.dark .hcd-anchor-highlight` | merge |
| 458 | `html .app [data-hcd-location-active='true']` | `base` | `discussion.css` `.app [data-hcd-location-active='true']` | merge |
| 458 | `html .app [data-hcd-thread-active='true']` | `base` | `discussion.css` `.app [data-hcd-thread-active='true']` | merge |
| 466 | `html .outline-rail` | `base` | `styles/workspace-02.css` `.outline-rail` | merge |
| 472 | `html .outline-heading` | `base` | `styles/workspace-02.css` `.outline-heading` | merge |
| 479 | `html .outline-heading span` | `base` | `styles/workspace-02.css` `.outline-heading span` | merge |
| 479 | `html .outline-version` | `base` | `styles/workspace-03.css` `.outline-version` | merge |
| 479 | `html .outline-item > span` | `base` | `styles/workspace-03.css` `.outline-item > span` | merge |
| 486 | `html .outline-item` | `base` | `styles/workspace-02.css` `.outline-item` | merge |
| 494 | `html .outline-item:hover` | `base` | `styles/workspace-02.css` `.outline-item:hover` | merge |
| 499 | `html .outline-item.active` | `base` | `styles/workspace-03.css` `.outline-item.active` | merge |
| 499 | `html .app.dark .outline-item.active` | `base` | `styles/workspace-03.css` `.app.dark .outline-item.active` | merge |
| 505 | `html .outline-item > span` | `base` | `styles/workspace-03.css` `.outline-item > span` | merge |
| 509 | `html .outline-bottom` | `base` | `styles/workspace-03.css` `.outline-bottom` | merge |
| 515 | `html .edit-dock` | `base` | `document-editor.css` `.edit-dock` occurrence=1 | merge |
| 520 | `html .edit-dock .button-primary` | `base` | `document-editor.css` `.edit-dock .button-primary` | merge |
| 525 | `html .add-module` | `base` | `styles/workspace-09.css` `.add-module` occurrence=1 | merge |
| 531 | `html .outline-rail.open` | `@media (min-width: 981px) and (max-width: 1599px)` | `styles/workspace-02.css` `.outline-rail.open` | new-context |
| 542 | `html .app` | `@media (max-width: 1190px)` | `styles/workspace-11.css` `.app` | merge |
| 548 | `html .kpi-grid` | `@media (max-width: 980px)` | `styles/workspace-04.css` `.kpi-grid` | new-context |
| 554 | `html .document-page` | `@media (max-width: 720px)` | `styles/workspace-07.css` `.document-page` | merge |
| 561 | `html .doc-title-block` | `@media (max-width: 720px)` | `styles/workspace-07.css` `.doc-title-block` | new-state |
| 565 | `html .module-title-row h2` | `@media (max-width: 720px)` | `styles/workspace-07.css` `.module-title-row h2` | merge |
