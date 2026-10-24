# E4 主题覆盖与危险动作补漏复核

本轮只按根指导 §2.4 / E4 的明确要求复核，不以个人视觉偏好扩展范围。上传区已由主代理单独修复，本记录不重复计数。审查没有启动 Chrome、build 或视觉基线更新；下面的 React 回归使用 jsdom 与真实组件，只在 fetch 边界提供固定回应。

## 确认并修复：危险按钮缺少展示标记

指导 §2.4 要求危险操作使用 `--danger` 红字、`--fill` 底与行内确认。行内确认已经存在，但是 E4 添加的 `.admin-confirm .danger-action` / `.share-revoke-confirm .danger-action` 没有命中实际 TSX：

- `ShareLinks.tsx` 的「撤销」与「确认撤销」均只有 `button button-soft`。
- `features/admin/admin-shared.tsx` 的 ConfirmAction 触发、确认按钮也只有 `button button-soft`；移除角色与禁用账户都使用它。
- `theme/apple-chrome.css` 的 `html .button-soft` 因而将这些按钮显示为 `--ink`，原 E4 danger 规则没有对应元素。
- ConfirmAction 还用于启用账户，不能把所有实例统一当成危险动作。

### 真实红 → 绿证据

新增长期 `packages/web/src/E4-danger-actions.test.tsx`，经 React createRoot 实际渲染 ShareLinks、Administration 与 MembersPanel，再通过原按钮完成操作。没有读取生产源码来代替行为测试，也没有修改旧断言。

- `outputs/E4-danger-actions-red.log`：实际 exit 1，4 项中 3 失败 / 1 通过。撤销、禁用、移除角色的触发与确认标记各失败；启用保持普通样式的对照通过。危险标记使用 soft 断言，因此后面的原流程保护断言仍完整执行。
- `outputs/E4-danger-actions-green.log`：实际 exit 0，4 文件 13 项通过，含新 4 项与旧 ShareLinks i18n、Administration i18n、E4 visual polish 测试。
- 各测试验证：取消前后没有写请求；最终确认只有一次原 DELETE/PATCH；原 endpoint、请求体和刷新次数保留；onUpdated 仅成功后调用一次；取消按钮和启用按钮不带危险标记。

这些测试验证展示标记接线与原行为，**不把 jsdom 当作真实浏览器计算样式/截图通过证据**。最终颜色、E4 截图、完整 verify 与完整视觉门禁由主代理和 E2 代理接续完成。

### 最小 TSX（逐条）

1. `ShareLinks.tsx`：只在撤销触发与确认按钮上添加 `danger-action`，所有事件、状态、API 与取消按钮不变（258 行）。
2. `features/admin/admin-shared.tsx`：ConfirmAction 增加可选的纯展示 `tone: 'neutral' | 'danger'`，默认 neutral；同一 class 字符串供原触发和确认按钮使用，所有 onClick / disabled / 状态流不变（77 行）。
3. `features/admin/AdministrationPanel.tsx`：只将现有 disabledAt 状态映射为展示 tone，禁用 danger、启用 neutral（286 行）。
4. `features/admin/MembersPanel.tsx`：只给移除角色 ConfirmAction 传 danger 展示 tone（222 行）。

owner CSS 仅给既有 danger 规则增加 `.administration-modal .danger-action` 与 `.share-links-modal .danger-action`，使触发和确认都显示红字；原 button-soft 的 fill 背景与 pill 形状继续生效。没有新增 token、依赖、交互或资源。

## 已核查，未发现被主题反转的明确要求

- 管理分段控件：实际按钮不带 button-soft，active 的 paper / ink / shadow-card 没有被 html button 体系覆盖。
- 富文本：组件作用域 `.block-editor .be-rich-toolbar` 优先于 html 单 class 工具条；选中项已有 accent-soft/accent；rich-editor 与行内编辑的焦点光圈已有计算样式测试。
- 通知：列表 hairline 与 unread 点不被主题覆盖；`.notifications-modal .notification-item` 保持 grid 和无重复分隔；开关明确限定 checkbox 并保留 checked / onChange。
- 提及：菜单 paper / radius-m / shadow-float 来自现有主题；新增 mention-name 使用 inherit，hover 名字跟随白字；头像独立的 accent-soft / accent 有真实 class。
- 选区浮层：shadow-float 与 pill 声明没有被主题覆盖；generic button 的 padding 不影响指导中明确的形状要求。
- AI 任务：任务状态 strong 有 pill / fill；confirm textarea 的 border 与 30% shadow 生效。全局 outline 额外存在不等于焦点不可见，不作为 E4 缺陷。
- 编辑嵌套块与表格：group / item raised、nested hairline 与行分隔规则没有对应 html 主题覆盖。

## E6 接续核查项（未在 E4 擅自修改）

`share-create-form select`、`new-share-link input`、administration / integrations 的 input/select 没有 owner 焦点 border+shadow 规则。`apple-pages.css` 的焦点表单列表仅覆盖 auth/create/settings/guest，它们当前只命中应用全局 outline。指导 §2.4 规定的 focus-ring 边框加 30% 光圈应在 E6 统一核验并补齐。已有清晰 outline，不把此项误报为焦点逃逸或键盘完全不可见。主代理已指定并入 E6，本轮不改。

## 待决定

本轮没有新增指导 §4 情况。危险展示采用指导已有状态语义和现有行内确认，启用保留普通展示；没有产品流程决定。
