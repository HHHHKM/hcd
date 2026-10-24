# E5 editor 区域迁移准备（只读）

本文件对应 `outputs/E5-editor.manifest.json`，由当前 E4 冻结后的 CSS 重新生成。仅运行 `node scripts/e5-css-migrate.mjs preview`，没有写入生产文件、没有 apply、没有更新视觉基线。

## 范围与显式 owner

`theme/apple-editor.css` 的 45 个主题成员已逐项映射到原 owner：

- `document-editor.css`：`.structure-actions`、结构操作按钮/禁用态/删除态/编号、hover 状态、`.editable-block`（含移动媒体）、`.editor-feedback`；
- `block-editor.css`：`.block-editor` 与 `.be-actions` 按钮（含 hover 状态）、`.be-type`、字段标签和输入控件、picker、inline preview/focus、rich toolbar/input/pressed state/content/focus；
- `styles/workspace-08.css`：`.edit-mode-note`；
- `styles/workspace-04.css`：`.edit-live-dot`；
- `styles/workspace-09.css`：`.doc-title-edit`、`.add-paragraph`/`.add-module` 及 hover/dark 状态、`.rich-editor`/`.rich-toolbar` 的 dark 状态；
- `styles/workspace-10.css`：`.app.dark .doc-title-edit`。

每项操作的 source selector、声明哈希、媒体上下文、target selector、迁移理由和目标文件哈希均在 manifest。组合 selector 被拆成员处理，避免把无关规则一并删除。helper 会先删除目标中被新 shorthand 覆盖的旧声明，再把声明合回 owner；apply 时会保存完整 backup.json。

## 预览证据

- `outputs/E5-editor-preview.json`：preview 成功，45 actions；未写生产文件。
- 预览行数变化：`theme/apple-editor.css` 226→26（仅剩手工审查规则）；`document-editor.css` 85→101；`block-editor.css` 227→296；`styles/workspace-08.css` 353→353；`styles/workspace-09.css` 432→467；`styles/workspace-10.css` 449→458；`styles/workspace-04.css` 377→377。
- 主题预览仍保留未能自动 exact merge 的移动标题规则（theme line 222，`@media max-width:760px`；原 owner 标题在 `@media max-width:720px`），以及所有者差异/上下文需人工检查的 focus/hover createAfter 项。manifest 的 `manualMappings` 明确记录这些，不得将 preview 当成可直接 apply 的批准。

## 合回约束（apply 前人工复核）

1. apply 后每条主题声明必须进入对应 owner 原规则，删除旧冲突值并去掉 `html` 前缀；禁止把主题整段追加到 owner。
2. E4 当前最终 computed 值是事实来源：保留 `block-editor.css` 末尾 `.block-editor .be-rich-toolbar`、`.be-inline-content:focus`、`styles/workspace-09.css` 的 `.rich-editor:focus-within`、switch、OAuth、验证码分格等 E4 补丁；迁移主题规则不能删或覆盖这些补丁。
3. `document-editor.css` 与 `block-editor.css` 是实际组件 owner；`styles/workspace-09.css` 的 `rich-*` 和 `add-*` 仍在 styles 链路，不能为迁移方便改 import 或移文件，以免 C8 读取 styles.css 时丢布局。
4. apply 只允许单区域 `--region=editor`。完成后按指导先 build，再用未更新的视觉基线运行完整 `pnpm test:visual`；有任意差异必须用 backup.json 恢复并重新审查级联。
5. 当前 manifest 的文件哈希来自 E4 冻结后文件；若其它区域迁移先改动这些文件，必须重新 inventory/manifest，不能绕过 SHA guard。

## 人工审查/待决定

未触发 §4 产品决策：所有操作是 CSS owner 合回，接口、数据、交互和资源均不变。以下两项属于 E5 实现风险，需在 apply 前由迁移代理核对：

- 主题行 222 的移动标题规则媒体上下文不同，不能静默把 `max-width:760px` 改为原 `max-width:720px`；应在 owner 增加同等 `max-width:760px` 状态并验证，或保留极小覆盖并写明理由。
- createAfter 的 focus/hover 状态必须插入与 owner 同一上下文；如果真实视觉无法达到零差异，应按 §4 停止并把差异写「待决定」。
