# E5 后续区域 owner 映射（只读准备）

这些 `*-unique-owner.manifest.json` 是从最新只读 inventory 生成的**候选映射**，preview 已运行且全部退出 0；它们没有 apply，不能直接当作正式 E5 区域执行。一个文件中可能含多个功能组，正式应用前应按下表继续拆成单一可审阅区域，尤其要把 dark reconciliation、responsive、新状态和全局规则单独列出。

| 候选主题 | 精确唯一 owner 操作 | 涉及文件 | 预览净减行数 | 应拆成 |
| --- | ---: | ---: | ---: | --- |
| document | 76 | 8 | 315 | paper/title + reading blocks + anchor + outline + responsive |
| panels | 65 | 7 | 249 | discussion + review/conflicts + changes/history + notifications |
| chrome | 63 | 8 | 274 | body/app/chrome（全局需人工）+ toolbar + menu/modal + notification |
| pages | 33 | 7 | 33 | forms/settings/home + guest/share + mobile helpers |

文件：

- `E5-document-unique-owner.manifest.json` / `.preview.json`
- `E5-panels-unique-owner.manifest.json` / `.preview.json`
- `E5-chrome-unique-owner.manifest.json` / `.preview.json`
- `E5-pages-unique-owner.manifest.json` / `.preview.json`
- `E5-unresolved-owner-candidates.json`：所有无候选或同上下文不唯一的选择器。

为便于逐步执行，还生成了按目标 owner 拆分的 33 份候选 manifest 和对应 preview，索引为 `E5-document-region-index.json`、`E5-panels-region-index.json`、`E5-chrome-region-index.json`、`E5-pages-region-index.json`。它们的命名形如 `E5-document-block-read.manifest.json`；每份只写一个目标 CSS 文件，但仍需按功能边界人工复核（例如 workspace 文件可能同时包含布局和状态），不能把“一个文件”自动视作“一个已批准区域”。全部 preview 均 `applied:false` 且非空。

生成规则只收录：主题 selector 去掉 `html ` 后在非主题 CSS 中有且仅有一个精确 selector，且 `@media`/`@supports` context 完全相同的成员。每个操作携带当前主题 rule 的 declaration SHA，防止在 E4 并发修改后误用。生成时的 `inventory` 已重跑；正式 apply 前仍须重跑并刷新全体 hash。

## 明确不自动映射的规则

- `html body`、`html .app`、topbar/sidebar/right-rail/toolbar 等有多个 owner 或全局级联影响的规则。
- `:is(...)`、`:has(...)`、伪元素/伪类而无一一对应旧 rule 的块，需要手工建 `createAfter` 或合入真实 owner。
- 所有 `.dark` / `.app.dark` reconciliation，必须按当前最终计算值逐条审计；不能由 selector 相似度删除。
- 主题新增状态（例如 `.pending-pin`）和无 owner 候选的规则。
- C7 `.hcd-anchor-highlight` 的 clone 声明、C8 styles 链路中的阅读布局；这些必须由对应人工 manifest 保留。
- 不同断点的同名 selector。不能把基础、720px、980px、1190px 或 1440px 规则混合。

正式执行步骤仍固定为：刷新 inventory/hash → 选一个功能区域 → preview → 人工核对有效旧声明/级联 → apply → `pnpm build` → 完整 `pnpm test:visual`，不带 `--update-snapshots`。有任何差异就用该区域 backup 恢复，不能通过更新基线消除差异。
