# E5 旧 token 别名清理准备（只读，未 apply）

已审查当前 `tokens.css`、全生产 CSS 的精确 `var(--name)` 引用、`scripts/check-contrast.mjs` 和现有测试。没有修改生产文件或旧断言。机器可读引用位置、取值与哈希见 `E5-alias-plan.json`。这是准备时快照，实际清理前需重新计数。

## 等价映射与真实引用

| 旧 token | 当前值 / 精确替代 | 生产 CSS 引用数 |
| --- | --- | ---: |
| shadow-1 | shadow-float | 1 |
| shadow-2 | shadow-card | 0 |
| shadow-3 | shadow-card | 1 |
| shadow-4 | none | 1 |
| shadow-5 | none | 1 |
| shadow-6 | none | 1 |
| shadow-7 | shadow-float | 1 |
| shadow-8 | shadow-float | 1 |
| shadow-9 | shadow-sheet | 1 |
| shadow-10 | shadow-float | 1 |
| shadow-11 | shadow-card | 1 |
| shadow-12 | shadow-card | 1 |
| shadow-13 | shadow-card | 1 |
| shadow-14 | none | 1 |
| shadow-15 | shadow-card | 1 |
| shadow-16 | shadow-float | 1 |
| radius-control | 8px = radius-s | 0 |
| radius-sm | 6px = radius-xs | 2 |
| radius-md | **10px，无精确 semantic 等价** | 1 |
| warm-paper | **chrome**，浅 #f5f5f7 / 两处深 #111113 | 15 |

指导指定的20个旧 token 共33处生产引用。计数只含 `packages/web/src/**/*.css`，不含 outputs、dist、node_modules、文档或测试。每处文件/行/源码已逐条列入 JSON。

顺手识别的额外旧别名：`--shadow`→shadow-float，0引用；`--shadow-menu`→shadow-float，3引用（action-menu及workspace-12两个 rail）；`--font-sm`→font-size-13，1引用。这些同样可先精确替换再删除，不能误改 shadow-card/float/sheet 等新语义变量。

阴影别名在浅色 root 里以 var 指向语义阴影，深色两块重定义语义阴影，因此替换为相同语义 var 在三主题条件均等价。`none` 是原别名本来的值，直接替换为 `none` 不引入颜色或字号字面量。

## 两个不能机械替换的点

1. **warm-paper 只等价 chrome，深色不等价 surface-raised。** 当前浅色三者都是 #f5f5f7；深色 warm-paper/chrome 是 #111113，而 surface-raised 是 #2c2c2e。把 warm-paper 全换 surface-raised 会产生实质深色视觉差异，应禁止。
2. **radius-md 10px 不等于 radius-m 12px。** 唯一引用在 `shared/action-menu.css .action-menu-items`，实际主题 `html .action-menu-items` 已覆盖为 radius-m。先完成菜单 owner 合并，删除原被覆盖的10px声明，届时引用应归零再删除 token。不能单靠近似取值将10改12；若某个未覆盖场景仍实际需要10px，应先记录并保留该别名，或另建精确 token 后走零差异门禁，不得静默改变外观。

## 对比度检查不能少覆盖

当前真实执行 `node scripts/check-contrast.mjs` 退出0，27组在浅/深均通过。脚本 parse 只解析 hex 字面量，因此删除 warm-paper 后不能留下 `warm-paper` pair，也不能把这些检查删掉。

把现有3组逐一更名为等价语义背景，仍保持27组：

- ink/warm-paper → ink/chrome；
- muted-ink/warm-paper → muted-ink/chrome；
- faint-ink/warm-paper → faint-ink/chrome。

chrome 在浅色、自动深色和显式深色块继续保留现有 hex 声明，解析器无需支持 var。paper/surface/surface-raised 的其余7组检查保留，尤其 surface-raised 在深色与chrome颜色不同，不能去重。其余状态、avatar、highlight、accent/on-dark 检查也保持。这样覆盖的三套实际 RGB 组合与清理前完全一致，不减少有效覆盖。

## 旧测试审计

全仓排除 outputs/node_modules/dist 的 `*test*` 精确检索：没有旧测试直接要求 `warm-paper`、`radius-control/sm/md`、`shadow-1..16`、`shadow-menu` 或 `font-sm` 字符串存在。`design-tokens.test.ts` 的 C4 只要求组件无字面颜色/字号、字号最小12px、自动dark存在、对比度输出含WCAG AA；C7要求锚点clone/分享定位边框。没有发现与别名删除冲突的旧断言，**旧断言保持不变**。

`design-tokens.test.ts` 通过 subprocess 调用 check-contrast，因此遗漏对比度pair改名会自然报 Missing theme contrast token，应由该现有门禁拦住，不能降低测试。

## 实际执行次序与门禁

先完成逐区域 owner/theme 零差异合并，尽量直接删除被覆盖的旧别名声明；再重计数，按上表对剩余有效引用作精确替换。随后按上述3组更新对比度脚本检查对，确认所有 var引用（包括token之间引用）归零后才删定义：warm-paper 三个主题块都删，其余继承别名位于浅root。

实际修改后运行原 design-tokens 测试、check-contrast、pnpm verify 与完整 pnpm test:visual，视觉基线不更新。任何差异恢复本步备份调查。本计划没有运行或宣称通过上述修改后的门禁。

## 待决定

当前没有 §4 产品决策项，也没有旧测试冲突。radius-md 是明确技术等价风险，优先用 owner 合并消除唯一被覆盖引用；若最终仍有实际10px需求，应保留并记录原因，不能把近似映射当作零变化。
