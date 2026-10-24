# D2 访客引用定位诊断

结论：没有依据修改生产代码。失败来自验收脚本在原生平滑滚动尚未结束时切换视口、再次点击，不能把该时序失败报告为已经确认的产品缺陷。

## 执行证据

- `D2-guest-navigation-red.log`：再次运行原完整脚本，在 pinned guest 阶段等待引用进入视口超时；临时 DB、浏览器和 listener 均清理。
- `D2-guest-minimized-red.log`：去掉认证、邮件、发布和评论创建，改为真实 Chrome + 本地构建 + 固定 v1 文档及主题 HTTP fixture；1440 首次点击时引用可见，紧接着切成 360 再点时，4 秒后引用 top=-2105.61 / bottom=-2069.61、scrollY=2444，确实不在视口。
- 诊断时依次排查：DOM 节点被 React 替换、focus 导致滚动、原生平滑滚动的时序。目标在后续帧始终 connected，禁用 focus 仍失败，浏览器 fixture 仅替换 smooth 为 instant 时全部通过。未将这些临时 probe 写入生产代码。
- `D2-guest-settled-green.log` 与最终 `D2-guest-minimized-green.log`：生产代码保持不变，只在 click 后等待 1500ms，让原生 smooth 动画稳定，再读取几何位置并切换下一种视口。真实 Chrome 的 5 场景全部通过：1440浅、360浅、1440浅、360深、1440深。引用 top 338.39–408.59px，始终低于 sticky header.bottom=58px，且 bottom≤1000px；无 pageerror。
- 最终可重复脚本：`pnpm exec tsx scripts/acceptance-guest-scroll.ts`。这是一条真实浏览器回归检查；它不增加 Vitest 的测试数。
- 完整 `scripts/acceptance-browser.ts` 仅增加相同的稳定等待，没有放宽引用可见性、版本过滤、隐藏内容、面板几何等断言。正常 quota window 保留；完整结果由 `D2-guest-full.log` 和主浏览器报告记录。

## 验收脚本修正

“某一帧几何位置在视口内”只说明平滑滚动经过该位置。立即 resize 会打断仍在运行的原生滚动，再加上 Playwright 为点击远处按钮自动滚动，造成下一次定位的滚动互相干扰。原脚本只等 mark 出现 / 首次可见，缺少稳定条件。修正增加动画稳定等待，保留最终可见性断言。

## 证据保全更正

诊断时误把新的 D2 完整失败重定向到了旧 `C7-browser-red.log`，覆盖了 C 阶段 outline 问题的原 stdout。旧 stdout 无备份，无法恢复。原文件名现为明确披露记录，绝不伪造旧执行日志；旧 `C4-C7-red.log` 静态红测和 C 阶段绿测/截图仍保留。D2 新证据统一使用 `D2-guest-*` 文件名。

期间有一版临时浏览器 probe 被 tsx 的 `__name` 转换污染，抛出了脚本自身错误；它没有用于产品结论。最终脚本已清除 probe、替换和调试代码，重新在未改动的产品代码上通过。

## 后续完整脚本的独立问题

- 第一轮加入稳定等待后的完整执行通过访客定位，后续首次返回成员阅读时出现空白页（`D2-build-race-*`）。当时存在并发 build，但失败分支未保存 console，无法确证根因；文件名仅表示排查方向。冻结构建后重跑未再出现该空白页。
- 下一轮因脚本误写 `More actions` 而非组件实际的 `More document actions` 超时（`D2-menu-selector-*`），仅修正了新验收脚本的选择器，未改产品；该轮失败 JSON 记录外网拦截 0、无 pageerror、仅预期 401。
- 使用正确选择器的后续完整执行自然结束，39 条观察通过、外网拦截 0、无 pageerror、仅 2 条预期 401。但截图复核发现工具栏菜单纵向裁切，横向几何断言无法发现，因此该轮不作为最终完成依据。菜单问题另以 `acceptance-toolbar-menu.ts` 先取得真实断言红测，再修复；详见 `work-C5-menu-clipping.md`。访客平滑滚动诊断与该菜单产品缺陷互相独立。
- 菜单与紧凑侧栏修复、统一 build 后，最终完整流程实际 exit 0：45 条观察、42 张本轮成功截图，guest 360/805/1440 浅深全部完成。`D2-browser-final.log` / `browser-acceptance-results.json` 记录全部页面 pageErrors=[]、外网拦截 0，console 5 条均为预期 401。最终成功不覆盖保留的失败证据。
