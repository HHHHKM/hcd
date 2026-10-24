# HCD 浏览器验收记录

日期：2026-10-24。最终结果：**通过本记录限定的实际应用流程，45条观察、42张成功截图**。环境：macOS arm64 / Google Chrome 155.0.8059.85 / Playwright 1.64.1，加载视觉补修后冻结的本地构建。完整verify仍有2项旧断言冲突，不能由浏览器结果改写为全绿。

所有账号、SQLite数据库、邮件收件器和HTTP服务均为独立本地临时fixture。没有发送真实邮件或飞书消息、没有外部OAuth连接或生产部署。旧550快照截图已归档`baseline-20261023/`；本轮成功应用截图统一为下列`D2-*.png`。API/jsdom/SSR和仅CSS的Chrome测试不算本记录的完整应用流程。

## 实际流程与证据

命令：`pnpm exec tsx scripts/acceptance-browser.ts`。服务器提供真实页面/API，浏览器使用实际表单、鼠标和键盘；没有拦截API伪造成功。初始数据及B2版本主题/回复由临时fixture API安排。最终原始结果：`D2-browser-final.log`、`browser-acceptance-results.json`（记录时间2026-10-24T09:22:41.698Z）。

| 流程 | 实际结果 |
| --- | --- |
| 登录、阅读 | owner通过实际登录表单打开正式文档。 |
| 原生选词评论 | 在正文鼠标双击“已经”，通过Comment on selected text发送v1评论；hash导航精确高亮“已经”。没有用脚本创建Selection。 |
| 编辑、提交 | 在原段落Tiptap字段追加中文、emoji和Shift+Enter换行，填写说明并提交，实际201；正式版本仍为v1。 |
| 审核、发布 | owner选择提交、生成合并预览、Confirm & publish，正式版本成为v2。 |
| 历史对比、作者 | 实际加载v1→v2，差异含新增文字，作者信息不含内部用户编号。 |
| 固定v1访客B2 | 访客填写虚构姓名/邮箱，使用本地邮件fixture验证码经表单验证；响应为v1且无currentVersion。v2成员根评论、成员主题的v2回复不可见；v1主题可见。v2发布后访客引用固定v1发起的主题及其成员v2回复可见。 |
| 引用定位C7 | 360/805/1440×浅深色点击引用，等待原生平滑滚动稳定后，精确文字高亮处于视口内且低于sticky header，无段落外框。 |
| 改密码B7 | 实际设置表单改密，当前会话200、另一浏览器会话401；另一浏览器使用新密码重新登录成功。 |
| 退出全部设备B6 | 实际点击按钮及页内确认，两个会话均401，当前URL为/login；新密码仍可登录。 |
| 工具栏C5 | 六种宽度/主题组合逐项检查菜单中心真实命中，全部通过；reading工具栏按钮非空且无文字截断。另一个独立真实浏览器脚本六次点击Version history验证导航通过。 |
| 紧凑侧栏C8 | 805浅深色两项主导航为图标，完整可访问名保留；SVG、按钮、侧栏边界包含，无被裁切的裸文字。 |

## 视口、主题与截图

阅读、比较、审核预览、设置、访客高亮、更多菜单均覆盖360/805/1440×浅深色；另有1280阅读两套。42张成功截图均在最终运行生成。所有布局观察中documentElement.scrollWidth等于视口宽。正文实测1280为688px、1440为848px，均≥680px。浅/深背景分别rgb(238,236,229)与rgb(23,32,28)。

- `D2-reading-{360,805,1280,1440}-{light,dark}.png`
- `D2-comparison-{360,805,1440}-{light,dark}.png`
- `D2-review-{360,805,1440}-{light,dark}.png`
- `D2-settings-{360,805,1440}-{light,dark}.png`
- `D2-guest-highlight-{360,805,1440}-{light,dark}.png`
- `D2-toolbar-menu-{360,805,1440}-{light,dark}.png`
- `D2-member-comment-highlight.png`、`D2-review-before-publish.png`、`D2-history-comparison.png`、`D2-logout-all-inline-confirm.png`

最终reading按钮计数浅深一致：360为4、805为6、1280/1440为5，没有用空数组的every判断通过。菜单360为7项，805/1440为6项，每项中心均真实命中。人工查看了手机阅读、审核、设置、访客高亮，以及805/1440菜单和侧栏截图；未仅以几何数据冒充视觉复核。

完整写入/发布链在1440浅色执行，其余宽度/主题检查阅读、评论定位、预览、历史及设置展示；≤480按规格隐藏编辑和发布。桌面Chrome视口不等于实体手机、触摸或移动输入法验收。

## 修复、验收脚本校正与局限

- 截图复核实际发现C5菜单纵向裁切。先用`acceptance-toolbar-menu.ts`取得真实红灯（7项仅首项命中），再最小修改工具栏overflow；六场景绿灯及Version history真实导航通过。证据：`C5-menu-clipping-red.*`、`C5-menu-results-red.json`、`C5-menu-clipping-green.log`、`C5-menu-results.json`、`work-C5-menu-clipping.md`。最终完整脚本也逐项命中检查。
- 805侧栏裸文字裁切另先写Chrome回归、取得行为红灯，再恢复既有CSS的图标模式并保留aria-label。证据：`C8-sidebar-layout-{red,green}.log`、`work-C8-sidebar-layout.md`。环境Chrome EPERM单独保存，不算产品红灯。
- 早期脚本曾用错Add comment/More actions的accessible name，后按实际界面校正。访客定位曾因原生平滑滚动未结束就连续resize/点击而假红；等待稳定后未改产品即通过，见`D2-guest-navigation-diagnosis.md`。另有一次主页面空白超时，发生在构建期间，根因未确证，保留`D2-build-race-*`诊断；冻结构建后不再出现，不能断言已确认其根因。
- 最终三类页面均监听pageerror：0。控制台共5条预期认证401（member2、guest1、other session2），没有404、429或其他warning；外网请求0（若尝试会拦截）。截图按正常quota窗口分批，没有绕过限额。
- 首次37条观察和修复前39条观察属于历史运行，未覆盖后来发现的菜单问题；最终只以45条观察及42张当前截图为准。C7早期原始红测stdout误覆盖的证据保存偏差见FIX_REPORT，不伪造日志。
- 未执行：真实IME/触摸、完整多用户冲突/恢复故事、全部块/权限/导入样本浏览器矩阵、raw恶意脚本隔离、真实PDF/外部OAuth、容器/生产部署。CLI实际设备授权→MCP独立记录于`cli-acceptance.md`，不计Vitest总数。
