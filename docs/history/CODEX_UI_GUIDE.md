# HCD 前端后续工作指导（阶段 E）

> 给 Codex 的执行指导。适用快照：`hcd-ai-test-20261024-665-apple-ui`（Claude 在 665 基础上做的 Apple 风格改版）。
> 本文件用于新开的对话，不依赖之前的聊天记录。和 `source/CODEX_FIX_GUIDE.md` 冲突时，**前端相关事项以本文件为准**；其余规则继续沿用。

---

## 0. 背景（先读）

- 665 是你按 CODEX_FIX_GUIDE 完成 A→B→C→D 修复后交付的版本。之后 Claude 只改了前端视觉，改动全部是 CSS：
  - `source/packages/web/src/tokens.css`：重写取值，变量名全部保留；
  - `source/packages/web/src/styles.css`：末尾新增 5 行 `@import`；
  - 新增 `source/packages/web/src/theme/` 下 5 个文件：`apple-chrome.css`、`apple-document.css`、`apple-editor.css`、`apple-panels.css`、`apple-pages.css`。
- 改版说明在根目录 `FRONTEND_REDESIGN.md`，改版后的截图在 `reference/apple-ui-preview/`（13 个场景 × 浅色/深色，另有一张改版前后对比图）。
- Claude 的环境连不上 npm，**没有运行过 `pnpm verify`**。和样式有关的测试只在替身环境里复刻过。所以本轮第一件事，就是在真实环境里把它跑通。
- 本轮目标分三层：
  1. 在真实环境确认改版没有破坏任何东西，并把遗留问题清零；
  2. 把还没有精修的界面做到和主界面同一水准；
  3. 在视觉回归测试的保护下，把临时的主题层并回组件 CSS，降低维护成本。

---

## 1. 硬规则（每个阶段都适用）

1. **不改功能**：本轮除 E1 外，只做视觉层工作，不改接口、数据结构、业务逻辑和交互流程。如果某个视觉问题非改 TSX 不可（例如缺少 class、语义标签不对），可以改，但改动要最小，并在报告中逐条说明。
2. **颜色和字号只能用 token**：除 `tokens.css` 外，任何 CSS 都不能写死颜色（`#hex`、`rgb()`、`hsl()`）或 px/rem/em 字号（`design-tokens.test.ts` 的 C4 会检查）。需要新颜色时，在 `tokens.css` 里新增 token，并且**同时写三处**：浅色 `:root`、`@media (prefers-color-scheme: dark)` 块、`:root[data-theme='dark'], .dark` 块。新 token 如果是「文字 + 背景」组合，要加入 `scripts/check-contrast.mjs` 的检查对，必须达到 WCAG AA。
3. **旧断言不动**：只有 E1 列出的 B1、B2 两条已经获得负责人批准，可以更新。其余现有测试断言一律不能改、不能跳过、不能删。可以新增测试。
4. **布局底线**：1280 和 1440 宽、右侧讨论面板打开时，正文宽度 ≥680px；任何页面在 360、805、1280、1440 宽都不能有横向滚动；工具栏按钮文字不能被截断。
5. **文件长度**：TS/TSX 单文件 ≤400 行（`web-structure.test.ts`）。CSS 没有行数限制，但单文件建议不超过 700 行。
6. **不引入外部资源**：不加网络字体、CDN 和外部图片（验收要求 `blockedExternalRequests: 0`）。不新增 npm 依赖；确实需要时先写进报告的「待决定」，等批准。
7. **守住设计语言**（第 2 节）：不要把已经去掉的旧风格带回来，包括 Georgia 衬线标题、暖米色底、深色侧栏、彩色左边框、方角描边按钮、等宽字体编号、蓝底红字徽章。
8. **每个阶段结束都要过两道关**：`pnpm verify` 全绿（退出码 0，0 error，0 warning），以及视觉回归（E3 建好之后）。不能把部分通过写成通过。
9. **证据留档**：日志、截图和 JSON 放在 `source/outputs/`，文件名用阶段前缀（如 `E2-reading-1440-dark.png`、`verify-E1.log`）。
10. **不推送、不部署**，也不做任何外部操作。

---

## 2. 设计规范速查（精修和新增界面都按这个来）

### 2.1 颜色和表面

| 用途 | token | 说明 |
| --- | --- | --- |
| 页面底色 | `--chrome` | 浅灰 `#f5f5f7` / 深色 `#111113` |
| 主内容纸面 | `--paper` | 白 / `#1c1c1e`，放在 `--chrome` 上，配 `--shadow-card` |
| 卡片填充 | `--surface-raised` | 用在纸面内的 KPI、评论卡、元信息块，**不加边框** |
| 控件浅填充 | `--fill` / `--fill-hover` / `--fill-strong` | 次按钮、分段控件底、选中项 |
| 分隔线 | `--hairline`（细）/ `--line`（输入框边框） | 不要用粗线 |
| 正文 / 次要 / 辅助文字 | `--ink` / `--muted-ink` / `--faint-ink` | 标题一律用 `--ink` |
| 强调色 | 文字用 `--accent`，填充用 `--accent-fill`，浅底用 `--accent-soft` | **全站只有这一种强调色** |
| 状态 | `--danger` `--success` `--warning` `--info` 及对应的 `-surface` | 提示块用浅底，不用左边框 |
| 半透明顶栏 | `--chrome-translucent` + `--blur-chrome` | 同时写 `-webkit-backdrop-filter` |
| 遮罩 | `--overlay` + `blur(12px)` | 弹窗背景 |

### 2.2 形状、阴影和动效

- 圆角：`--radius-xs` 6、`--radius-s` 8（输入框、小控件）、`--radius-m` 12（卡片、菜单）、`--radius-l` 16（大卡片）、`--radius-xl` 20（纸面、弹窗）、`--radius-pill`（按钮、标签）。
- 阴影：`--shadow-card`（静态卡片）、`--shadow-float`（菜单、浮层、hover）、`--shadow-sheet`（弹窗）。
- 动效：`--duration-fast` 0.15s、`--duration-base` 0.25s，配 `--ease-standard`。按钮按下只用 `scale(.98)`，不用位移；只有可点击的卡片 hover 时上浮 2px。

### 2.3 字体层级

| 层级 | 字号 token | 字重 |
| --- | --- | --- |
| 元信息、标签 | `--font-size-12` | 500–600 |
| 次要 UI | `--font-size-13` | 400–500 |
| 常规 UI | `--font-size-14` | 400–600 |
| 正文 | `--font-size-16`，行高 `--leading-reading` | 400 |
| 小标题 | `--font-size-18` | 600 |
| 区块标题 | `--font-size-20` 到 `--font-size-24` | 600 |
| 页面标题 | `--font-size-28` 到 `--font-size-34`，或 `--font-fluid-hero` | 700，字距 `--tracking-display` |

字体只用 `--font-body`、`--font-display`、`--font-mono`（`--font-mono` 只给代码和验证码用）。

### 2.4 组件模式（直接复用现有 class）

- **按钮**：`.button.button-primary`（蓝色填充药丸，每个区域最多一个），`.button.button-soft`（浅灰药丸，次要操作），`.button.button-ink`（只用于编辑模式的「提交修改」），文字链接用 `--accent`。危险操作用红字，放在 `--fill` 底上，并且要有行内二次确认。
- **输入框**：最小高度 36px，1px `--line` 边框，`--radius-s` 圆角；获得焦点时边框变为 `--focus-ring`，外加 `0 0 0 3px color-mix(in srgb, var(--focus-ring) 30%, transparent)` 光圈。
- **分段控件**：参照 `.right-tabs`（`apple-panels.css`）。
- **列表**：行与行之间用 `--hairline` 分隔，行高 ≥44px，次要信息右对齐、用 `--faint-ink`。
- **弹窗**：参照 `.review-modal` 和 `.settings-modal`，`--radius-xl` 加 `--shadow-sheet`，顶部依次是小号说明、标题和圆形关闭按钮。
- **空状态**：居中，`--accent-soft` 圆角方块图标，一句说明，最多一个主按钮。
- **浮层和菜单**：`--paper` 加 `--radius-m` 加 `--shadow-float`；菜单项 hover 时蓝底白字。

---

## 3. 阶段任务

执行顺序：**E0 → E1 → E2 → E3 → E4 → E5 → E6**，E7 可选，最后做 E8 交付。每个阶段完成后，在 `UI_REPORT.md` 里记录结果再进入下一阶段。

### E0 接入与基线（必须）

1. 先确定代码来源，二选一：
   - **用改版包**：解压 `hcd-ai-test-20261024-665-apple-ui.zip`，核对 `.sha256`，进入 `source/`。
   - **用你自己的工作区**（665 之后可能已有提交）：只需要把 7 个文件带过去，即 `tokens.css`、`styles.css` 和 `theme/` 下 5 个文件。覆盖前先确认你那边的 `tokens.css` 和 `styles.css` 与 665 完全一致；如果不一致，手动合并。`styles.css` 只需在末尾**按以下顺序**追加 5 行：chrome、document、editor、panels、pages。
2. 运行 `pnpm install --frozen-lockfile` 和 `pnpm verify`，日志存为 `outputs/verify-E0.log`。
3. 预期：只有 B1、B2 两条旧断言失败（如果你还没处理），lint 只有 2 条 hooks 警告。**出现其他任何失败，都按改版引入的问题处理**：在主题层修复，不能改测试，并在报告中写明原因和改法。

### E1 遗留问题清零（必须）

1. **B1**（负责人已批准）：把 `VersionComparison.test.tsx` 中旧断言 `Created by: u_owner` 改为新行为，即显示作者名字；没有名字时显示「未知用户 / Unknown user」；任何情况都不能出现内部编号。
2. **B2**（负责人已批准）：把服务器 `comment-selection.test.ts` 中 "preserving discussion bodies" 一条改成符合 D-1 的断言：固定 v1 的分享页**不显示** v2 才创建的成员根主题；访客主题下的回复全部保留；可见主题的正文保持不变。
3. **两条 lint 警告**：AuthLink 缺少依赖 `t`，SpaceIntegrations 缺少依赖 `report`。要真正修复（补上依赖、用 `useCallback`，或把函数移出组件），**不能用 eslint-disable**。修完要确认没有引入重复请求或渲染循环，必要时补一条测试。
4. 验收：`pnpm verify` 退出码 0，0 warning。报告中逐条写清旧断言 → 新断言的对照。

### E2 真实环境视觉验收（必须）

1. 先运行 `pnpm build`，再按 665 的方式运行 `scripts/acceptance-browser.ts`、`acceptance-toolbar-menu.ts`、`acceptance-guest-scroll.ts`，全部通过。
2. 把截图和 `reference/apple-ui-preview/` 中的同名场景逐一对比。注意：Claude 的截图是在 Linux 上拍的，没有 SF/PingFang 字体；你的 macOS 会显示真正的系统字体，字宽略有差异属于正常。重点检查：
   - 805 和 360 宽时，工具栏、标签和按钮文字有没有换行或被截断；
   - 有没有残留旧风格的元素（衬线标题、米色底、方角描边按钮、深色侧栏）；
   - 深色模式下，标题和输入框文字是否清晰（旧的 `.dark` 规则会把它们压暗，见 E5）；
   - 菜单、弹窗、浮层的层级（z-index）和遮罩是否正常。
3. **替身环境没能验证、必须在真实环境检查的界面**：tiptap 富文本编辑（`.be-rich-toolbar`、`.be-inline-content`、`.rich-editor`）、@提及选择器、选区评论浮层、通知弹窗、分享链接弹窗、导入对话框、AI 任务面板、管理后台、CLI 授权页、OAuth 授权页、忘记密码和邮件链接页、全局错误提示、toast。
4. 发现的问题：已有主题覆盖的，在主题层修；还没覆盖的，留到 E4 一起做。每个问题都要附截图记录。
5. 产出：`outputs/E2-*.png`、`outputs/ui-acceptance.md`。

### E3 建立视觉回归基线（必须，E4/E5 的前提）

目的：E4 是有意改变外观，E5 要求外观完全不变，两者都需要截图对比来把关。

1. **只用已有依赖** `@playwright/test`：
   - 新建 `playwright.visual.config.ts`：`testMatch: '**/*.visual.ts'`（**不要用 `.spec.ts` 或 `.test.ts`**，否则会被 vitest 当成单元测试运行），`snapshotPathTemplate` 指向 `outputs/visual-baseline/{arg}{ext}`，`expect.toHaveScreenshot` 设置 `{ maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' }`。
   - 新建 `visual/ui.visual.ts`：参照 `acceptance-browser.ts` 用一次性数据目录启动 app（seed 数据，静态服务 `dist/`），浏览器用 Chrome。
   - `package.json` 增加 `"test:visual": "playwright test -c playwright.visual.config.ts"`，不放进 `verify`。
2. **场景清单**（浅色、深色各一张；用 `zh-CN`，和参考截图一致）：

   | 场景 | 路由 / 操作 | 宽度 |
   | --- | --- | --- |
   | 首页 | `/` | 1440 |
   | 文档阅读 | `/d/d_aaaaaaab`（右侧面板打开） | 1680、1440、1280、805、390 |
   | 编辑模式 | 文档页点击「编辑文档」 | 1440 |
   | 审核队列 | `/d/d_aaaaaaab/review` | 1440 |
   | 版本历史 | `/d/d_aaaaaaab/history` | 1440 |
   | 设置 | `/settings` | 1440 |
   | 分享页 | `/s/<演示 token>` | 1440、390 |
   | 登录 | 未登录访问 `/login` | 1440 |
   | 「更多」菜单展开 | 文档页 | 1440、360 |

   E4 每精修一个界面，就把它加进清单（例如管理后台、通知、分享弹窗、选区浮层、导入、AI 任务、CLI/OAuth 授权页）。
3. 时间、相对时间、随机头像等动态内容，用 `mask` 遮住，保证连续跑两次结果完全一致。
4. 验收：同一份代码连跑两次 `pnpm test:visual` 都通过，基线 PNG 提交到 `outputs/visual-baseline/`。

### E4 精修未覆盖的界面（必须，有意改变外观）

这些界面目前只是继承了新 token，颜色已经协调，但排版、间距和控件形状还是旧样式。**直接在各组件自己的 CSS 文件里改**（这些 class 没被主题层覆盖，不需要加 `html` 前缀），完全按第 2 节的规范执行。每个界面都要提交浅色/深色、1440/390 的改前改后截图，并更新视觉基线。

按优先级（用户最常看到的排在前面）：

1. **选区评论浮层** `selection-comment.css`（`.selection-comment*`）：改成 `--shadow-float` 加药丸形的浮动工具条，类似 macOS 的文本选择菜单。
2. **富文本编辑** `block-editor.css` / `workspace-09.css`（`.be-rich-toolbar`、`.rich-editor`、`.rich-text-input`）：工具条改为浅填充分段按钮，选中状态用 `--accent-soft` 加 `--accent`；编辑区焦点光圈和输入框保持一致。
3. **通知** `notifications.css`（`.notifications-modal`、`.notification-list`、`.unread`、`.notification-preferences`、`.notification-empty`）：列表行加 hairline 分隔，未读用蓝色小圆点，偏好设置用开关行（参照 `.settings-switch-row`），空状态按 2.4。
4. **分享链接弹窗** `sharing.css`（`.share-links-modal`、`.share-list-heading`、`.share-note`、`.share-revoke-confirm`、`.shared-state`、`.shared-anchor-status`）：弹窗参照设置弹窗；撤销用行内确认；分享页的错误/过期状态（`.shared-state`）做成居中空状态卡。
5. **@提及与讨论细节** `discussion.css`（`.mention-picker`、`.discussion-empty`、`.comment-selection-summary`）：提及列表做成浮层菜单样式，带头像和名字。
6. **管理后台** `administration.css`（`.administration-modal`、`.admin-tabs`、`.admin-list`、`.admin-form-grid`、`.admin-invite`、`.admin-row-actions`、`.admin-confirm`、`.space-integrations`）：标签页改为分段控件，成员列表用 hairline 行，危险操作用行内确认。
7. **CLI / OAuth / 邮件链接 / 忘记密码** `cli-auth.css`、`workspace-07.css`（`.cli-auth*`、`.auth-language`、`.auth-brand`）：统一用登录页的 `.auth-card` 样式；设备验证码用 `--font-mono` 大字号、分格显示；授权范围做成带勾选的列表。
8. **导入与 AI 任务** `workspace-10.css`（`.import-report`、`.import-module-list`、`.import-preview-blocks`、`.import-content-preview`、`.file-picker`、`.ai-task-modal`、`.ai-task-card`、`.ai-task-list`、`.ai-task-toolbar`、`.ai-task-confirm`）：上传区用虚线大圆角拖放框，报告用浅底摘要卡，任务状态用药丸标签。
9. **审核与对比细节** `workspace-11.css`、`version-comparison.css`、`changes.css`（`.submission-document`、`.submission-select`、`.operation-outcomes`、`.ai-conflict-suggestion`、`.conflict-placement`、`.mobile-review-note`、`.version-swap`、`.version-comparison-result`、`.version-read-error`、`.version-snapshot`、`.change-heading`、`.change-empty`、`.review-presentation`）。
10. **阅读块和编辑块细节** `block-read.css`、`workspace-04.css`、`block-editor.css`（`.read-chart*`、`.read-timeline`、`.read-columns`、`.read-cards`、`.bar-chart`、`.chart-legend`、`.image-upload`、`.kpi-good` / `.kpi-bad`、`.be-list`、`.be-data-table`、`.be-grid`、`.be-group`、`.be-nested`、`.be-checkbox`、`.be-placeholder`）。
11. **全局状态和设置细节**（`.global-error`、`.empty-state`、`.error-pill`、`.unresolved-note`、`.keyboard-hint`、toast、`.token-list`、`.token-scopes`、`.settings-title-form`）。

验收：每个界面的截图都放进报告；`pnpm verify` 和 `pnpm test:visual` 通过（基线已按新外观更新）；E2 检查表复跑通过。

### E5 主题层并回组件 CSS（必须，外观零变化）

`theme/` 是为了不动旧代码而叠上去的覆盖层，全部选择器都加了 `html` 前缀，用来压过旧的高权重选择器和排在后面的组件 CSS。长期看，同一个元素的样式分散在两处，不好维护。本阶段把它们合并回去。

1. **原则**：每次只并一个区域，并完立刻跑 `pnpm test:visual`，必须零差异（在阈值内）。有差异就回退这一步，重新做。
2. **把规则放回组件自己导入的 CSS 文件**（例如讨论面板的规则放进 `discussion.css`），**不要留在 `styles.css` 链路里**。原因：`App.tsx` 先导入 `styles.css`，各组件再导入自己的 CSS，所以打包后组件 CSS 总是排在 `styles.css` 后面，懒加载的还会更晚注入。去掉 `html` 前缀后，留在 `styles.css` 链路里的同权重规则会被组件 CSS 覆盖。
3. **合并方式**：把主题层的声明写进原规则（替换旧值），删掉已经没用的旧声明和旧规则，再删除主题层里对应的块。不要只是把主题层整段剪切过去。
4. **建议顺序和对应关系**：

   | 主题文件 | 主要并入目标 |
   | --- | --- |
   | `apple-pages.css` 中的「Dark mode reconciliation」块 | 和 `workspace-08.css`、`version-comparison.css` 里压暗标题/输入框的 `.dark` 规则**一起删除**（先删旧规则，再删修正块） |
   | `apple-pages.css` 中的 `.pending-pin` | `workspace-03.css` 的 `.pending-pin` |
   | `apple-editor.css` | `document-editor.css`、`block-editor.css`、`workspace-08/09/10.css` 中与编辑相关的部分 |
   | `apple-document.css` | `workspace-01/03/04.css`、`block-read.css`、`anchor-text.css`（`anchor-text.css` 必须保留 `.hcd-anchor-highlight` 和 `box-decoration-break: clone`，C7 会检查） |
   | `apple-panels.css` | `discussion.css`、`changes.css`、`version-comparison.css`、`workspace-05/06/11.css` |
   | `apple-chrome.css` | `workspace-01/02/07.css`、`document-toolbar.css`、`notifications.css` |
   | `apple-pages.css` 其余部分 | `workspace-07/08/09/10.css`、`sharing.css` |

5. **顶栏和侧栏的局部变量重定义**（`html .topbar, html .left-sidebar { --dark: var(--chrome); … }`）：先把旧 CSS 中顶栏和侧栏用到的 `--dark`、`--on-dark`、`--muted-on-dark`、`--dark-2`、`--dark-line` 改成语义 token（`--chrome`、`--ink`、`--faint-ink`、`--fill`、`--hairline`），再删除这段重定义。
6. **旧 token 清理**：`--shadow-1..16`、`--radius-control`、`--radius-sm`、`--radius-md`、`--warm-paper` 等旧别名，用 `grep` 确认已经没有引用后再删。删 token 之后要重跑对比度检查。
7. 验收：`theme/` 清空并删除，`styles.css` 去掉这 5 行导入（如果确实有必须保留的覆盖，保留一个文件并写明原因）；全仓库除合理例外外不再有 `html .` 前缀的选择器；`pnpm verify` 和 `pnpm test:visual` 都通过；报告中给出 CSS 总行数的前后对比。

### E6 可访问性与浏览器细节（必须）

1. `@media (prefers-reduced-motion: reduce)`：关闭位移、缩放和非必要的过渡动画。
2. `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))`：顶栏、工具栏和遮罩退回到不透明的 `--chrome`。
3. `@media (prefers-contrast: more)`：`--hairline` 改用 `--line`，`--faint-ink` 改用 `--muted-ink`，焦点光圈加粗。
4. 键盘：Tab 能依次走遍工具栏、菜单、分段控件和弹窗，每个可交互元素都有清晰的 `:focus-visible` 光圈；弹窗打开时焦点不会跑出去，关闭后回到触发按钮（如果已有实现，就补测试来验证）。
5. 触控：≤720 宽时，主要操作的点击区域至少 44×44px。
6. 浏览器：用本机 Safari 走一遍阅读、编辑和分享三个页面（重点看 `backdrop-filter`、`position: sticky`、`select` 样式和 `:has()`）。当前 CSS 用到了 `color-mix()` 和 `:has()`，最低需要 Chrome 111、Safari 16.2、Firefox 121。把这个支持范围写进 README；如果需要支持更老的浏览器，记入「待决定」，不要擅自加大量降级代码。

### E7 包体积（可选，时间够再做）

主包 646kB，超过 Vite 的 500kB 提示线。可以把低频页面改成按路由 `React.lazy` 懒加载，包括管理后台、版本对比、审核、导入、AI 任务、CLI/OAuth 授权页。目标是主包降到 500kB 以下、构建不再出现警告。拆分后懒加载 CSS 的注入顺序会变，**必须复跑 `pnpm test:visual`**。

### E8 交付（必须）

1. 包名：`hcd-ai-test-YYYYMMDD-<测试总数>`，目录结构和 665 一致；同时提供 `.zip` 和 `.sha256`。
2. 根目录新增 `UI_REPORT.md`，格式参照 `FIX_REPORT.md`：
   - 阶段结果总表（E0–E8：完成 / 部分 / 未做，证据路径）；
   - E1 断言新旧对照；
   - E2 发现的问题和修复（附截图）；
   - E4 每个界面的改前改后截图；
   - E5 并回记录和 CSS 行数对比；
   - 偏离本指导的地方；
   - 待决定事项。
3. 同步更新 `START_HERE.md`、`source/README.md`、`source/PROGRESS.md` 和 `FRONTEND_REDESIGN.md`（写明主题层已并回哪些部分），重新生成 `MANIFEST.json`（每个文件的 sha256）。
4. 实话实说：没跑的、没通过的、跳过的，都要写清楚。

---

## 4. 遇到这些情况，先停下来写进「待决定」

- 某个视觉需求必须改动接口、数据或交互流程才能实现；
- 某条现有测试和本指导冲突（除 B1、B2 外）；
- 需要新增 npm 依赖、网络字体或外部资源；
- 设计语言里没有覆盖的新组件，有两种以上合理做法，且影响范围大；
- E5 某一步怎么做都无法做到零视觉差异。

小的、可逆的选择，自己按第 2 节判断后直接做，报告里写明理由就行。

---

## 5. 附：主题层目前覆盖了什么

- `apple-chrome.css`：页面底色、焦点光圈、半透明顶栏、品牌标识、搜索框、图标按钮、通知角标、浅色侧栏（导航、空间、文档列表）、文档工具栏、按钮体系、菜单和浮层、遮罩、审核弹窗外框、toast。
- `apple-document.css`：文档纸面、目录按钮、标题区、模块编号和标题、正文排版、KPI/图表/卡片、提示块、时间线、表格、引用高亮、定位高亮（仅 `.app` 内部，不影响分享页）、目录栏、编辑浮条、各断点的布局。
- `apple-editor.css`：编辑模式的标题输入、结构操作按钮、块卡片、字段、行内预览、添加内容块、富文本工具条的基础样式。
- `apple-panels.css`：右侧面板卡片、分段标签、讨论上下文、评论卡、回复、输入框、团队和动态、通知列表的基础样式、审核进度与提交、冲突卡、差异对比、变更卡、版本历史页。
- `apple-pages.css`：各种表单、设置、首页、登录、分享页、深色模式修正、`.pending-pin`、移动端阅读提示。
