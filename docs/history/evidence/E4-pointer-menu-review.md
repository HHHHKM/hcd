# E4 通知与提及菜单最终 CSS 修复

- 真实应用修复前证据：由 UI surface 验收的 E4-after-b / E4-after-e 记录，390通知筛选被 mobile right-rail 遮挡，1440提及菜单导致页面 scrollWidth1461。这里没有把替身测试通过写成修复前失败。
- 新 fixture 初次未复现两个真实失败：E4-pointer-menu-red.log 与 E4-pointer-menu-red-real.log 实际均2项通过，文件名 red 不代表失败。它们属于夹具局限，保留原始日志。
- 实际层级调试：通知input中心(78.5,104.5)命中 z25 的 aside，而topbar为z20；将含notifications-modal的topbar提高至z50后同点命中input。
- 生产仅改 CSS：notifications.css 加 `.topbar:has(.notifications-modal){z-index:50}`；discussion.css `.mention-options` 设置left:auto/right:0，`.mention-picker` 加flex:1/min-width:0，使右锚点使用composer可用宽度，避免手机负x。
- E4-pointer-menu-green.log 确有1项失败：只改right0时390菜单x=-105.4375。该结果保留，不视为通过。
- E4-pointer-menu-green-final.log 最终实际exit0、2项通过，1440/390通知normal checkbox check、菜单x≥0且right≤viewport与页面无横向溢出。没有force、TSX、依赖或旧断言修改。
- 最终真实app验证与截图由surface验收代理在重新build后执行；以对应新日志为完整E4门禁证据。
