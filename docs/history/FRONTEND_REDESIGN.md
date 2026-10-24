# Apple UI 后续进度 — 2026-10-25

当前是用户要求提前打包的`hcd-ai-test-20261025-686`进度快照；详见`UI_REPORT.md`。下方是原Apple改版说明，原先“没有运行verify”“仅改CSS”“B1/B2未更新”等描述属于输入包历史，不代表本包当前状态。

E0–E3已完成；E4对11组界面补样式，并有7处最小TSX展示标记改动，另修复E1 hook依赖。上传框与危险红字漏项已补修，最新verify686项全通过；危险按钮最后的真实颜色/截图与视觉连续两轮尚未跑。E5曾验证部分迁移但现已全部回滚，5个theme文件和styles.css导入仍在，尚无“已并回”的生产区域；显式清单与备份可供继续。E6与E7未实施，构建仍有3条获批warning。

---

# HCD 前端 Apple 风格改版说明

快照：`hcd-ai-test-20261024-665-apple-ui`，基线是 `hcd-ai-test-20261024-665`（Codex 按 CODEX_FIX_GUIDE 修完的版本）。改版由 Claude 完成，只动了视觉层。

## 1. 改了什么

只改 CSS，没有改任何 TS/TSX、接口、数据和交互逻辑。和 665 相比的完整差异：

| 文件 | 变化 |
| --- | --- |
| `source/packages/web/src/tokens.css` | 重写取值，**变量名全部保留**（含旧别名），并新增 Apple 风格变量 |
| `source/packages/web/src/styles.css` | 末尾加 5 行 `@import`，引入主题层 |
| `source/packages/web/src/theme/apple-chrome.css` | 新增：顶栏、左侧栏、文档工具栏、按钮、菜单、弹窗、提示 |
| `source/packages/web/src/theme/apple-document.css` | 新增：文档纸面、标题、模块、KPI/图表/卡片、标注高亮、目录 |
| `source/packages/web/src/theme/apple-editor.css` | 新增：编辑模式（块卡片、字段、结构操作按钮、添加内容块） |
| `source/packages/web/src/theme/apple-panels.css` | 新增：右侧讨论/版本面板、评论、审核、冲突、版本历史 |
| `source/packages/web/src/theme/apple-pages.css` | 新增：首页、登录、分享页、设置/新建表单、深色模式修正 |

`reference/apple-ui-preview/` 里有改版后的截图（13 个场景 × 浅色/深色），还有一张改版前后对比图。

## 2. 设计语言

- **字体**：系统字体栈 `-apple-system / SF Pro / PingFang SC`，Windows 回退到 Microsoft YaHei，Linux 回退到 Noto Sans SC。没有引入网络字体。
- **颜色**：中性灰白底（`#f5f5f7`）配白色纸面，只用一种强调色：系统蓝（`#0066cc` 用于文字，`#0071e3` 用于填充）。成功、警告、危险使用 Apple 系统色的可读版本。
- **层次**：用浅阴影、大圆角（纸面 20px，卡片 16px，控件 8px）和细分隔线区分层级，不靠粗边框。
- **控件**：药丸按钮（主按钮蓝色填充，次按钮浅灰填充）；分段控件做「讨论 / 版本历史」切换；输入框获得焦点时显示蓝色光圈；顶栏和工具栏用半透明毛玻璃。
- **阅读**：正文 16px，行高 1.78；模块编号做成小号 `01` 标签，不再用竖线装订栏；标题负字距。
- **深色模式**：每个变量都有深色取值（`prefers-color-scheme` 自动切换，`data-theme` / `.dark` 手动切换）。

## 3. 技术结构（给 Codex 看）

1. **Token 是唯一的颜色和字号来源**。主题层没有写死任何颜色或 px 字号，满足 `design-tokens.test.ts`（C4）。新增的语义变量包括 `--accent-fill`、`--on-accent`、`--fill`、`--fill-hover`、`--fill-strong`、`--chrome`、`--chrome-translucent`、`--hairline`、`--shadow-card`、`--shadow-float`、`--shadow-sheet`、`--radius-s/m/l/xl/pill`、`--blur-chrome`、`--topbar-height`、`--overlay` 等。旧的 `--shadow-1..16`、`--radius-control` 等已映射到新值。
2. **主题层最后引入，所有选择器都以 `html` 开头**。原因有两个：旧组件 CSS 里有不少 `.app.dark .x`、`.dark .x h1` 这类高权重选择器；另外按组件懒加载的 CSS（如 `discussion.css`、`version-comparison.css`）在生产环境会比 `styles.css` 更晚注入。加上 `html` 前缀后，主题层不管加载顺序都能稳定覆盖。
3. **顶栏和左侧栏在局部重新定义旧的深色变量**（`--dark`、`--on-dark` 等）。这样旧组件 CSS 不用改，也会变成浅色毛玻璃风格。
4. **布局预算没有变**：1280 宽、右侧讨论面板打开时，正文宽 694px（要求 ≥680）；1440 宽时为 810px。顶栏高 52px，工具栏在 ≤1190 时仍是 86px。

## 4. 我做过的验证

我的环境无法访问 npm 源，所以**没有运行** `pnpm install / pnpm verify / vitest / tsc / vite build`。我用 esbuild 打包了真实的前端代码（router、i18n、tiptap 用最小替身），配合模拟 API，在 Playwright Chromium 里做了下面的检查：

- `node scripts/check-contrast.mjs`：27 组文字和背景的浅深色对比度都达到 WCAG AA。
- 复刻 C4：除 `tokens.css` 外没有写死颜色或字号；最小字号 12px；包含 `prefers-color-scheme: dark`。
- 复刻 C7：分享页定位段落没有 outline，引用高亮背景正常。
- 复刻 C8（`reading-layout.test.ts`）：正文宽度 1280 下 694px，1440 下 810px，1680 下 862px，都没有横向滚动。
- 复刻 `App-sidebar-layout.test.tsx`：805、980、1440 三种宽度，浅色和深色，侧栏「全部文档 / 最近访问」图标都完整显示，没有被截断。
- 近似 `acceptance-browser.ts`：文档、版本对比、审核、设置、分享、首页 6 个页面，360、805、1280、1440 四种宽度，浅色和深色，都没有横向溢出；工具栏按钮文字没有被截断；「更多」菜单在屏幕内，每一项都能点到。
- 截图人工检查：文档页（1680、1440、1280、805、390）、编辑模式、审核弹窗、版本历史、设置、首页、登录、分享页（1440、390），浅色和深色都看过。

TS/TSX 没有改动，typecheck 和单元测试的行为应该和 665 一致（仍然只有 B1、B2 两条旧断言待更新）。

## 5. 交给 Codex 的后续工作（按优先级）

1. **先跑 `pnpm verify` 和 `scripts/acceptance-browser.ts`**，确认上面复刻的检查在真实环境里也通过，并用新截图替换 `source/outputs` 里的旧证据。
2. **B1、B2 两条旧断言**和 2 条 ESLint hooks 警告，按之前已确认的方案处理（更新断言，不要跳过）。
3. **把主题层逐步并回组件 CSS**：每并入一块，就删除被覆盖的旧规则，最后去掉 `html` 前缀。优先清理这几处：
   - `styles/workspace-08.css` 里的 `.dark` 规则：会把标题和输入框文字压成 `--faint-ink`，现在由 `apple-pages.css` 的「Dark mode reconciliation」一段修正；
   - `styles/workspace-03.css` 的 `.pending-pin`（原来是蓝底红字）、`.outline-item.active`（原来是 danger 色）；
   - `document-editor.css` 和 `block-editor.css` 里方角带边框的按钮。
4. **没有逐一精修的界面**：AI 任务面板、导入报告详情、管理后台（Administration）、OAuth/CLI 授权页、空间集成页。它们继承了新 token，整体是协调的，但细节没有逐一调整。
5. **编辑器富文本**（tiptap 工具栏和行内编辑态）：预览里用的是替身，样式已经写了，但要在真实环境确认一次。
6. 主包超过 500kB 的提示和这次改版无关，可以之后再做代码分割。

## 6. 回滚

想回到 665 的外观，删掉 `styles.css` 末尾的 5 行 `@import`，再用 665 的 `tokens.css` 覆盖即可。
