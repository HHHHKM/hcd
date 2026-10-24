# UI_REPORT — 当前进度包

快照：`hcd-ai-test-20261025-686`。这是按用户于2026-10-25要求提前打包的工作进度，**不是 E0–E8 全部完成的最终验收包**。已暂停后续实施，无推送、部署或外部操作。

## 当前验证

- 最新代码的 `pnpm verify` 退出码0：**114个测试文件、686项测试全部通过**；lint、安全、27组浅深色对比度、类型检查和build通过。证据：[完整日志](outputs/verify-E4-followup-final.log)。
- 构建仍有负责人已批准暂留至E7的3条warning：Zod两条注释warning；647.13kB主包超过500kB。未过滤警告或提高阈值。测试输出中的 `Local warnings (1)` 是CLI测试验证的产品提示，不是新增编译/lint警告。
- 最近完整视觉检查为上传区补修后的 **38/38通过**；**此后危险操作展示标记又有修改，当前最终代码尚未重跑完整视觉检查和连续两轮稳定性验收**。不能把此前38通过当成本包当前代码的最终视觉门禁。
- 当前保留176张视觉基线：4张上传区图已按明确外观修正重建，其余172张当时逐字节未变。危险按钮补修后的相关基线尚未更新；主冻结清单仍为历史版本，新的上传区清单明确标为provisional。

## 阶段结果

| 阶段 | 状态 | 已做及证据 / 尚缺 |
| --- | --- | --- |
| E0 | 完成 | 原ZIP SHA256核验；真实install；665项基线仅B1/B2失败，2条预期hook warning。`install-E0.log`、`verify-E0.log`。 |
| E1 | 完成（保留获批warning） | 按批准更新B1/B2；修复AuthLink/SpaceIntegrations hook依赖；新增3项语言切换/请求次数测试。668项verify通过。`verify-E1.log`、`E1-hooks.md`。 |
| E2 | 完成 | 真实Chrome主验收45观察项、工具栏6场景、访客滚动5场景；新增38类真实界面覆盖；外部请求和运行错误为0。`ui-acceptance.md`、`verify-E2.log`。 |
| E3 | 完成 | 30个主场景截图、双主题、真实app/SQLite；完整基线连续两轮30通过。`E3-complete-run1.log`、`E3-complete-run2.log`、`verify-E3.log`。 |
| E4 | **部分，最终视觉补验未完成** | 11组界面精修、146张实际组件图，6项移动编辑N/A；原完整门禁通过。后来发现上传框和危险红字遗漏，已补修、红绿测试与686项verify通过。危险按钮修改后的实际颜色/截图更新及完整视觉连续两轮尚未执行。 |
| E5 | **未完成，迁移已回滚** | 区域01/02曾各通过build+完整visual；03差异已定位。因返回E4补漏，01/02已按完整备份逆序还原。当前5个theme文件和导入仍在，尚未合并清空、未删旧token、未做整阶段verify。清单/预览/工具保留，不能算完成。 |
| E6 | **未实施** | 仅静态阅读预查；尚未做reduced-motion完善、backdrop降级、高对比、键盘/弹窗焦点、44px触控与实际Safari阅读/编辑/分享验收。 |
| E7 | **未做** | 尚未拆包或修正Zod注释；3条获批构建warning仍在。 |
| E8 | **按用户要求完成进度打包** | 当前进度报告、入口文档、逐文件SHA256清单、ZIP及SHA256校验文件。未宣称达到原指导的全阶段最终交付标准。 |

证据均在`source/outputs/`。完整历史阶段记录和38界面逐行截图链接保存在 [历史报告](outputs/UI_REPORT-history-before-checkpoint.md) 与 [E4截图矩阵](outputs/E4-evidence.md)；其中“E4完成”等历史结论已被本报告的补漏状态取代。

## E1 断言对照和旧测试保护

| 批准项 | 旧断言 | 新断言 |
| --- | --- | --- |
| B1 作者 | 显示内部ID `Created by: u_owner` | 无名字时 `Unknown user`，有名字时显示名字；内部ID不可出现，原转义/姓名断言保留。 |
| B2 固定版本分享 | 固定v1仍保留v2新增成员根主题 | 排除v2新增成员根主题；保留可见v1正文和访客主题下全部回复。 |

与输入ZIP比对的108个原测试文件：106个字节未变，仅批准的B1/B2两个文件变动，没有删除。见 [哈希核查](outputs/E5-existing-test-integrity.json)、[批准diff](outputs/E5-approved-existing-test-diff.patch)。后续新增E4测试也未通过修改断言掩盖此次上传区/危险按钮缺陷。

## E4 已做与补漏证据

11组已实施：选区浮层、富文本编辑、通知、分享、提及/讨论、管理后台、CLI/OAuth/邮件/忘记密码、导入/AI、审核/对比、阅读/编辑块、全局状态/设置。完整逐组内容见 [实现说明](outputs/E4-audit-completion.md)，该说明中上传框“虚线已保留”的旧结论由以下真实补验纠正。

- 原真实验收：`verify-E4-final4.log`，113文件/682测试；`E4-visual-check1.log`和`check2.log`均34通过；主验收45、toolbar6、guest5复跑通过。152组合中146实际截图，6个390px编辑场景因既有移动只读逻辑为N/A，没有伪装为编辑通过。
- 上传区真实红：4项均失败，实际为solid/8px/paper；仅为owner规则增加实际文件输入的限定选择器，使既有dashed/16px/fill生效。真实绿4通过、完整38通过。详见 [上传区证据](outputs/E4-followup-import-summary.json)、[截图/样式](outputs/E4-followup-import-evidence.md)、[基线核查](outputs/E4-followup-import-baseline-integrity.json)。四张最新真实截图：[1440浅](outputs/E4-followup-import-green-1440-light.png)、[1440深](outputs/E4-followup-import-green-1440-dark.png)、[390浅](outputs/E4-followup-import-green-390-light.png)、[390深](outputs/E4-followup-import-green-390-dark.png)。
- 危险动作真实红：4项中撤销/禁用/移除3失败，启用对照通过；补展示标记后4项和旧定向测试共13项通过。测试同时保护“取消不写请求、最终确认仅写一次、endpoint/body/刷新次数不变”。详见 [审查和逐条TSX](outputs/E4-theme-override-audit.md)、[red](outputs/E4-danger-actions-red.log)、[green](outputs/E4-danger-actions-green.log)。**真实浏览器颜色及截图门禁尚未补跑。**

最小TSX展示改动共7处：MentionPicker本地首字头像；CliAuthPanels验证码的装饰分格与完整可访问值；OAuthConsent固定授权范围列表class；ShareLinks两个危险按钮class；ConfirmAction纯展示tone；Administration根据已有disabledAt设置tone；MembersPanel移除角色tone。另E1的AuthLink/SpaceIntegrations为已授权逻辑缺陷修复。没有改服务器接口、核心数据或原业务确认流程；没有新增依赖、字体、CDN或外部图片。

## E5 当前状态与恢复方法

起始CSS9161行，当前回滚后的生产CSS仍为主题叠加结构；不提供“迁移后减少行数”的完成结论。01、02、03的成功/失败/回滚均保留在 [迁移日志](outputs/E5-migration-log.md)；02首次31/34、03首次32/34的失败未被隐藏。最新已暂停并逆序恢复的生产状态见 [暂停/恢复清单](outputs/E5-paused-for-E4-followup.json)。

已备齐editor/document/panels/chrome/pages显式迁移清单、hash守卫、preview与完整备份工具，尚未按新E4基线重新执行。夹具竞态曾导致OAuth随机换行和移动讨论栏状态波动，修正后完整视觉连续两轮34通过，原176基线不变：[夹具稳定性](outputs/E5-fixture-stability-summary.json)。这些是测试夹具修正，不能算生产主题迁移完成。

若继续：先完成E4危险动作实际浏览器补验、受控更新相关基线、完整视觉连续两轮并冻结176张；报告记录后，再从E5区域01重新执行，每区build+完整visual，有差异就回滚。完成E5整阶段verify/visual并记录后，才进入E6、E7与完整E8。

## 偏离指导及待决定

- 曾在E2/E3证据不齐时提前开始E4，已恢复输入CSS补齐E2/E3再推进；原历史记录保留。E5又发现E4明确需求遗漏，已立即暂停并回滚迁移，补修后因用户要求提前打包而停止，未宣称通过最终视觉门禁。
- 唯一已决定的阶段例外：负责人允许两条Zod注释和一条体积warning暂留至E7，允许E1–E6继续；本包尚未执行E7，例外不等于警告已修。
- 390px通知层级最初曾被误判为产品决定，后确认可以纯CSS修复并有真实pointer证据；已解决，无需新授权。
- 当前没有新增等待产品批准的§4事项；未完成工作是本次按用户指示暂停，不能写成已经完成或被产品决定阻塞。

输入ZIP：`hcd-ai-test-20261024-665-apple-ui.zip`，SHA256 `0460977c9a61a23dd5b50ba662f75527f1a7deb4c9d37bfd349340df9a4817e3`。输入包未附UI指导，已使用用户提供的`CODEX_UI_GUIDE.md`复制到包根。历史A–D `FIX_REPORT.md`仅作来源记录，当前UI进度以本报告为准。
