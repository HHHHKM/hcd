# E5 前两区域：只读预览审核

状态：已生成 current-hash manifest，运行 helper `preview` 成功；两份结果均为 `applied:false`。没有运行 `apply`，没有修改生产 CSS。E4 尚未完成，本审核不属于 E5 正式阶段门禁，也不替代真实应用 `build + test:visual`。

## 01 暗色标题/表单

清单 `E5-01-dark-titles-forms.manifest.json`；预览 `E5-01-dark-titles-forms.preview.json`。

12 次明确操作，目标仅 `styles/workspace-08.css` 与 `theme/apple-pages.css`。主题只消耗两个标题/输入 reconciliation 规则，surface/home/version 修正留给其后区域。预览 CSS 总行数净减11（theme -9，workspace-08 -2）。

- 删除旧 `.dark .auth-card h1` / `.dark .home-heading h1` / `.dark .history-heading h1` / `.dark .doc-card-title` 的 faint-ink 覆盖。原 h1 基规则或 body 继承提供 ink；doc-card-title 尚有一般 theme 的 ink。删同名 reconciliation 后预期颜色一致。
- `.history-row strong` 的浅色基值为 muted-ink，深色当前有效为 ink，**不能**把 dark 和 reconciliation 一起无条件删掉。将 `color:ink` 替换写入原 `.dark .history-row strong`，删其余四个冗余 dark 成员，再移除标题 reconciliation。
- `.auth-card input` / `.create-modal input` / `.create-modal select` 的一般 forms theme 已有 paper/ink/line。删这三个旧 `.dark` 成员后，它们直接提供当前的有效值；主题已有 focus-visible 单独保留。
- `.manual-resolution` 和 `.module-title-edit` 的浅色基值仍是 surface；深色当前有效 paper/ink/line。只在这两个原 `.dark` 规则内替换声明，保留真实浅深差异。移除输入 reconciliation 后，这两个原规则接管完全相同属性。
- 原组合 dark 表面、auth-page、module-quote 不变。没有扩大 `.dark`、`.app` 或分享页作用域，没有改断点，没有加入新 class。

上述结论经过逐规则 AST 预览和现有 source 声明审阅，正式应用仍须实际截图证明。一次额外的本地 Chrome 内存 fixture 审核尝试因沙箱 Chrome 启动 SIGABRT/EPERM 失败，未形成任何视觉通过证据；不将其写作通过。

## 02 pending-pin

清单 `E5-02-pending-pin.manifest.json`；预览 `E5-02-pending-pin.preview.json`。

单个 merge，目标 `styles/workspace-03.css` 原 `.pending-pin`。保留结构 `display:inline-grid;place-items:center`；替换旧尺寸、accent/danger、方角、mono 字体、字体权重，写入当前主题的20px、accent-fill/on-accent、pill、body、tabular-nums等声明。消耗主题单一 pending-pin 规则，目标没有 html 前缀。预览总行数净减10（theme -12，owner +2）。

## hash 与正式执行

准备时当前源文件 SHA256 已写入 `E5-prepare-current-hashes.json`。两份 manifest 都绑定**准备时当前值**，不是绑定虚构的 E5 将来状态。

01 通过后会修改共享 `apple-pages.css`，因此02的当前 hash将过期。应重新 inventory，确认pending-pin源规则完全未变，重新记录02的theme hash，再 preview/apply；不能关掉hash保护。E4仍可能补CSS，正式开始之前也必须再次核对所有目标。

回退使用 helper 保存的每一区域 `outputs/E5-migrations/<time>-<region>/backup.json`，恢复该区域 before 后再试。不得使用 `--update-snapshots` 把差异写成通过。
