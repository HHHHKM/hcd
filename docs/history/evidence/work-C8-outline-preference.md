# C8 目录开关持久化补齐

- 日期：2026-10-24。
- 缺陷：目录按钮状态原为 `useState(false)`；用户打开目录后重新挂载 App 会恢复收起，未满足指导 C8 的本机记忆要求。
- 公共测试入口：真实 App 中的目录按钮、`aria-expanded` 与目录栏打开状态；只模拟 API 和浏览器存储边界，不读取 hook 内部状态。
- 新测试：`packages/web/src/App-outline-preference.test.tsx`，新增 2 条，不改变或跳过任何旧断言。
  - `C8 remembers both open and collapsed outline choices after remounting the application`：默认收起→点击打开→重挂载仍打开→点击关闭→重挂载仍关闭。
  - `C8 keeps the outline usable with its default collapsed state when browser storage is unavailable`：存储读写均抛错，默认收起并可打开/关闭，重挂载正常。
- 修复前真实运行：1 失败 / 1 通过；第一次重挂载后 `aria-expanded` 实际 `false`，预期 `true`。原始日志：`C8-outline-preference-red.log`。
- 修复：仅 `packages/web/src/app/use-panel-state.tsx` 的 outline 状态增加 `hcd.outline.open` 读写与异常捕获；默认保持 false，已有 discussion 逻辑未改。
- 修复后专项：新测试及已有路由、主题测试共 15 项 / 3 文件通过，`C8-outline-preference-green.log`。
- `pnpm typecheck`：退出 0，`C8-outline-preference-typecheck.log`。
- 定向 ESLint：退出 0，`C8-outline-preference-eslint.log`。
- 格式：新增测试 99 行、最长 116 字符；hook 101 行、最长 88 字符，均满足≤400行/120字符。
- 以上为 jsdom UI 回归，不声明真实浏览器流程验收。完整阶段 D verify 由主任务统一执行和登记。
