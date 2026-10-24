# E5 静态迁移准备（未执行）

准备时完整阅读包根 `CODEX_UI_GUIDE.md`（尤其 §1、E5、§4）和 `FRONTEND_REDESIGN.md`。本文件只是静态审计和工具交接，**没有执行任何生产 CSS 迁移，没有声称视觉通过**。E4 完成并记录后，才能开始本计划。E4 完成时请重新生成 inventory 和 CSS 总行数，本次读数不应冒充 E5 正式前值。

## 工具与读数

- `scripts/e5-css-migrate.mjs`：使用 Vite 已安装的传递依赖 PostCSS 8.5.31，无新增 npm 依赖。
- 已运行 `node --check scripts/e5-css-migrate.mjs`，退出 0；运行 `inventory`（只读），结果为 `outputs/E5-inventory.json`。
- `inventory` 为每个主题选择器列出移除开头 `html ` 后的精确原规则候选、原位置、`@media` 上下文、声明和 CSS 文件 SHA256。候选是静态匹配，不能代替所有权判断、级联分析或截图。
- 准备期间 CSS（含 tokens，所有 src CSS）共 8,837 行。主题 AST 规则：chrome 100 / document 94 / editor 30 / panels 94 / pages 55。含组合选择器时成员分别为 115 / 109 / 47 / 110 / 77。
- 完全没有精确原规则候选的主题块分别为 13 / 5 / 6 / 10 / 7。多为新增状态、细化选择器、媒体条件或全局焦点；需要显式选择插入位置，不能把整个主题追加到目标文件。
- `outputs/E5-old-token-references.txt`：准备时旧别名引用快照。仍有大量真实引用，不能现在直接删除 aliases。

## 每一步的门槛

1. 以 E4 验收后的真实 Chrome 基线为准，保存该区域相关文件和 SHA256。所有 E5 截图命令都不带 `--update-snapshots`。
2. 只编辑一个区域。若使用 helper，先写一份明确 region、原规则、目标规则、at 上下文、操作理由的 JSON，然后 `preview` 保存完整前后文件；人工检查后才 `apply`。
3. 每一区域 `pnpm build`，再跑**完整** `pnpm test:visual`，保存阶段/区域前缀日志及 JSON；目标为实际 0 diff，不能以重新生成基线消除差异。
4. 有差异立即恢复该次 `backup.json` 中的 `before`，按失败截图调查级联/媒体条件，然后重做同一区域。重复尝试仍无法保持外观，则遵守 §4 停止并记「待决定」。单次可解释差异不等于已触发必须问产品的问题。
5. 每一区域记录 theme 消耗成员、owner 修改、旧声明删除、截图结果。全部完成后跑 `pnpm verify`、`pnpm test:visual`、C7/C8；重跑对比度，记录真实剩余警告（E1–E6 的三条已知构建警告已有用户特批）。

## 建议拆分和真正的所有者

| 顺序 / 区域 | theme 来源 | 原所有者及注意点 |
| --- | --- | --- |
| 1a 标题/表单暗色修正 | pages 的 reconciliation 前四块 | `styles/workspace-08.css`。对组合旧规则只删相应 selector 成员或被覆写属性，保留 `.history-list/.history-row/.columns-view/.image-placeholder/.raw-placeholder` 的有效旧声明。标题基规则本来已继承 `--ink`；对输入框显式并回 paper/ink，不能整段删除旧 `.dark` 区域。 |
| 1b 版本暗色修正 | pages reconciliation 最后一块 + panels 对应块 | `version-comparison.css`。见下方已确认的暗色 snapshot 非冗余风险。一次处理一类，确保 dark baseline。 |
| 2 审核计数徽章 | pages `.pending-pin` | `styles/workspace-03.css` `.pending-pin`，保留原 `display:inline-grid/place-items:center`，替换尺寸、颜色、圆角、字体等。已有未执行示例清单 `outputs/E5-pending-pin.example.json`。 |
| 3a 标题编辑与结构操作 | editor `.doc-title-edit/.structure-*` | `document-editor.css` 为其 TSX 自导入所有者；`styles/workspace-08/09/10.css` 中同名旧编辑声明需一起审查。不要把 editor 整体挪去 workspace 文件。 |
| 3b 块编辑和富文本 | editor `.block-editor/.be-*/.editable-block` | `block-editor.css`（`BlockEditor.tsx` 自导入）；富文本 `.rich-*` 的旧规则在 `styles/workspace-09.css`。E4 已有更具体的富文本精修，必须保留 E4 验收后的实际计算值，不以 theme 声明作为唯一真值。 |
| 4a 纸面、标题、模块与目录 | document 主体、outline | 原 `styles/workspace-01/03/04.css`，这些布局规则原本属于 App 的 styles 链路，继续留在原 owner 是合理例外；不能为迁移而凭空增加 CSS import 或移动到组件文件导致 C8 缺失。 |
| 4b 阅读块 | document KPI/chart/callout/timeline/cards/table | `block-read.css` 与原 `styles/workspace-04.css` 对应部分。真实可复用 `.read-chart-*` 放 `block-read.css`；旧全局 table/卡片保持原 owner，逐规则匹配，不能以相似 class 批量替换。 |
| 4c 锚点高亮 | document `.hcd-anchor-highlight` | `anchor-text.css`，合入两个现有浅深规则；保留 `box-decoration-break: clone`、`-webkit-box-decoration-break: clone` 与 forced-colors。定位 outline 必须继续限制 `.app [data-hcd-*]`，不能泄漏分享页。 |
| 5a Inspector/讨论 | panels rail/tabs/context/comment/reply/team/activity | 真正 DiscussionThreads 自导入 `discussion.css`；App 布局 right-rail/tabs 的原规则在 `styles/workspace-05.css`，保留其结构所有权。组合 `.app.dark` 背景旧规则见 `workspace-01.css`，只删已被等价基础声明替代成员。 |
| 5b 变化/版本 | panels `.change-*` 与 version/history | `changes.css`、`version-comparison.css`；队列与 conflict 原规则在 `styles/workspace-06/11.css`。`VersionComparison.tsx` 自导入版本 CSS，禁止把新版规则留在 styles 链路压后加载。 |
| 5c 通知基础 | panels `.popover-head/.notification-item/.notification-icon` | `notifications.css`，和 E4 通知精修一起处理原规则。 |
| 6a 全局/顶栏/侧栏 | chrome topbar/sidebar/button/base | 原 `styles/workspace-01/02/07.css`。先改顶栏/侧栏及后代实际使用的五个旧局部 token，再删除 theme 局部重定义。不能全仓替换 `--dark`（toast 和其他表面有独立语义）。 |
| 6b 工具栏/菜单/通知/弹窗 | chrome toolbar/menu/notification/dialog | `document-toolbar.css`、`shared/action-menu.css`、`notifications.css`；原全局 overlay/modal/button/toast 仍在其 workspace owner。menu 一块组合 theme 可能跨多个目标，拆 selector 成员合入；避免因先消耗整块让后续 owner 漏声明。 |
| 7a 表单/设置/首页/登录 | pages 其余 | 原 `styles/workspace-07/08/09/10.css` 各所有者；CLI 专用状态在 `cli-auth.css`。不把一般 `.auth-card` 重复剪贴到 cli-auth。 |
| 7b 分享页与分享创建 | pages `.shared-*`、guest/share | `sharing.css`，其两个组件都已有 CSS import；保持手机 720 断点，不用390代替原条件。 |
| 7c 剩余 responsive/helpers | pages mobile note/workspace-manage/outline :has | 各规则原 owner；`:has()` 是现有合理选择器，去掉 html 后不扩大 `.app` 原范围。最后一个主题成员删除后才移除该 import 和空 theme 文件。 |

## 静态已发现的级联风险（不能当成已验证的失败）

1. **暗色 `.version-snapshot-banner` 当前有效背景是 `--surface-raised`，不是 panels 的 `--warning-surface`。** pages 的 reconciliation 最后一块后加载，覆盖 panels dark 块；旧 `version-comparison.css` dark 块又有 `color: --warning`，被 panels `color: --ink` 覆盖。若按照“删旧 dark + 删 reconciliation”机械处理，会将暗色背景变成 warning-surface。需把当前有效暗色背景合回原 `.dark .version-snapshot-banner`，或在真实等价的 owner 里保留明确暗色规则。不要将这个修正误判为完全冗余。pages 的版本 metadata 背景则和 panels 一致，可按实际计算值精简。
2. **去 html 降权后旧 `.app.dark` 仍会胜出。** `workspace-01.css` 将许多卡片组合为 dark 背景，workspace-03 的 active outline、workspace-08 的输入/标题、editor 的 dark 状态也有高权重规则。每区域同时删除已覆盖的旧 selector 成员（保留组合中的其他成员），或者等价合并到其原 dark 规则；不能只把主题前缀删掉。
3. **C8 只加载 styles.css 链路。** 它不加载 discussion/block-read/document-editor 的组件 CSS。`document-page` 的 padding/margin、`.doc-module` 单列、`.module-body` 左padding、rail/sidebar宽度等预算须继续在原 workspace owner 可用。当前主题删除后若把这些放到组件 CSS，旧 C8 会失败，且不能改旧断言/fixture。
4. **C7 的独立分享 fixture。** 它另外加载 discussion/sharing/anchor。`.hcd-anchor-highlight` 的两个 clone 声明必须保留；`.app` 定位 outline 不可扩展成全局 `[data-hcd-location-active]`。移除 html 不能移除 `.app` 作用域。
5. **同一元素在不同 owner/媒体条件出现多次。** helper 对精确 selector + context 匹配要求唯一；重复必须提供 occurrence。不要把 `(max-width:720px)` 迁移到 `(max-width:760px)`、把媒体内规则合到基础规则，或统一移动相同选择器造成重排。
6. **E4 新样式与主题互相覆盖。** 本次 inventory 是准备时快照；E5 以 E4 验收后的实际 computed style 为准。helper 的 SHA guard 会阻止使用过期示例覆盖新改动，遇到 hash不符先重新审查，不能盲目删 guard。
7. **旧 alias 不全是同一个样式。** 先将每一处有效 alias 引用换成其等值语义 token，再零 diff 验证；只有全仓无 var引用才删 token（包括 token 间引用）。`--dark` 并非本节要求全局删除的 alias。删后跑27组以及新增组合的对比度检查。

尚未发现“怎么做都无法零差异”的确定阻塞；静态审计不能预先承诺整个迁移零差异。上述第1项需要谨慎保留有效暗色差异，不需要产品决定。

## helper 清单格式与限制

```
node scripts/e5-css-migrate.mjs inventory > outputs/E5-inventory.json
node scripts/e5-css-migrate.mjs preview outputs/E5-region.json > outputs/E5-region-preview.json
node scripts/e5-css-migrate.mjs apply outputs/E5-region.json --region=NAME > outputs/E5-region-applied.json
```

`preview` 默认只操作内存。`apply` 必须显式匹配 region，所有输出先经过 AST 解析，再保存每文件完整备份到 `outputs/E5-migrations/<time>-<region>/backup.json` 后写入。它不会自动跑 build/visual、更新基线、删除 token 或删除文件。

- `merge`：from 是一个 theme selector 成员；into 是真正 owner 的现有 selector 成员。组合目标被拆成等价相邻规则；旧同名声明与被新 shorthand 完全覆盖的旧声明删除，主题声明合入现有规则末尾；只消耗所选主题成员，其他成员保留。
- `createAfter` 只用于原 CSS 缺少的新状态，必须显式提供同媒体条件的定位锚点、reason 包含 `new state`，创建单一状态规则；不支持整个主题块追加。
- `remove`：删除一个 selector 成员，或删除该成员的明确 properties。组合旧规则其余成员保留。
- `variables`：仅在明确选中的原规则成员值中替换 `var(--token)`，不会改全仓 dark 变量。
- `remove-import`：仅移除一个准确 import。需先确认该主题不再有有效规则。
- 无 selector parser 依赖，借 PostCSS 的 comma list 分析组合选择器，保留 `:is()/ :has()` 内的逗号。它**不计算浏览器 specificity/级联，也不能自动保证视觉等价**。
- prepared 示例仅演示 pending-pin，**未运行 preview/apply**。E4 结束后需重新核对 SHA；不存在由本助手自动提前执行 E5 的情况。
