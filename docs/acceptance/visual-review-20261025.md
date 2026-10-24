# 2026-10-25 macOS 视觉基线审阅

正式更新之前，对全部 176 张候选图使用原 Playwright 图像比较器（threshold 0.2、maxDiffPixelRatio 0.002）比对原始包基线；45 张超阈值差异逐张查看原图、候选图与差异图。其余 131 张未超阈值，不据此声称逐像素完全一致。未改变阈值、遮罩或业务断言。

候选采集使用仓库原样测试，输出到仓库之外的临时目录；该轮的通过仅表示场景及非图像断言完成，不能代替基线回归通过。CLI 四图在固定夹具后另行重采并检查纯文本值。

| 文件 | 更新前审阅结论 |
| --- | --- |
| `edit-1440-light.png` | 接受：画面中的图表柱形及图例由旧绿改为新分类色板；文字、数据、几何与其余界面无可见回归。 |
| `guest-1440-light.png` | 接受：画面中的图表柱形及图例由旧绿改为新分类色板；文字、数据、几何与其余界面无可见回归。 |
| `guest-390-light.png` | 接受：画面中的图表柱形及图例由旧绿改为新分类色板；文字、数据、几何与其余界面无可见回归。 |
| `more-1440-light.png` | 接受：画面中的图表柱形及图例由旧绿改为新分类色板；文字、数据、几何与其余界面无可见回归。 |
| `more-360-light.png` | 接受：画面中的图表柱形及图例由旧绿改为新分类色板；文字、数据、几何与其余界面无可见回归。 |
| `reading-1280-light.png` | 接受：画面中的图表柱形及图例由旧绿改为新分类色板；文字、数据、几何与其余界面无可见回归。 |
| `reading-1440-light.png` | 接受：画面中的图表柱形及图例由旧绿改为新分类色板；文字、数据、几何与其余界面无可见回归。 |
| `reading-1680-light.png` | 接受：画面中的图表柱形及图例由旧绿改为新分类色板；文字、数据、几何与其余界面无可见回归。 |
| `reading-390-light.png` | 接受：画面中的图表柱形及图例由旧绿改为新分类色板；文字、数据、几何与其余界面无可见回归。 |
| `reading-805-light.png` | 接受：画面中的图表柱形及图例由旧绿改为新分类色板；文字、数据、几何与其余界面无可见回归。 |
| `review-1440-light.png` | 接受：画面中的图表柱形及图例由旧绿改为新分类色板；文字、数据、几何与其余界面无可见回归。 |
| `surface-ai-confirm-1440-dark.png` | 接受：AI 弹窗移除双重内边距，只有任务列表滚动；确认操作保留。 |
| `surface-ai-confirm-1440-light.png` | 接受：AI 弹窗移除双重内边距，只有任务列表滚动；确认操作保留。 |
| `surface-ai-confirm-390-dark.png` | 接受：AI 弹窗移除双重内边距，只有任务列表滚动；确认操作保留。 |
| `surface-ai-confirm-390-light.png` | 接受：AI 弹窗移除双重内边距，只有任务列表滚动；确认操作保留。 |
| `surface-ai-tasks-1440-dark.png` | 接受：AI 弹窗移除双重内边距，只有任务列表滚动；确认操作保留。 |
| `surface-ai-tasks-1440-light.png` | 接受：AI 弹窗移除双重内边距，只有任务列表滚动；确认操作保留。 |
| `surface-ai-tasks-390-dark.png` | 接受：AI 弹窗移除双重内边距，只有任务列表滚动；确认操作保留。 |
| `surface-ai-tasks-390-light.png` | 接受：AI 弹窗移除双重内边距，只有任务列表滚动；确认操作保留。 |
| `surface-cli-consent-1440-dark.png` | 接受：单个纯文本药丸验证码与范围行布局；完整夹具码固定为 ABCD-EFGH。 |
| `surface-cli-consent-1440-light.png` | 接受：单个纯文本药丸验证码与范围行布局；完整夹具码固定为 ABCD-EFGH。 |
| `surface-cli-consent-390-dark.png` | 接受：单个纯文本药丸验证码与范围行布局；完整夹具码固定为 ABCD-EFGH。 |
| `surface-cli-consent-390-light.png` | 接受：单个纯文本药丸验证码与范围行布局；完整夹具码固定为 ABCD-EFGH。 |
| `surface-mentions-390-dark.png` | 接受：菜单左下锚定及受限宽度；菜单未撑出视口。 |
| `surface-mentions-390-light.png` | 接受：菜单左下锚定及受限宽度；菜单未撑出视口。 |
| `surface-notification-preferences-1440-dark.png` | 接受：清单外场景已核实：notifications.css 与通用 input 排除规则修复开关横排、38×22 尺寸，弹窗高度相应变化。 |
| `surface-notification-preferences-1440-light.png` | 接受：清单外场景已核实：notifications.css 与通用 input 排除规则修复开关横排、38×22 尺寸，弹窗高度相应变化。 |
| `surface-notification-preferences-390-dark.png` | 接受：清单外场景已核实：notifications.css 与通用 input 排除规则修复开关横排、38×22 尺寸，弹窗高度相应变化。 |
| `surface-notification-preferences-390-light.png` | 接受：清单外场景已核实：notifications.css 与通用 input 排除规则修复开关横排、38×22 尺寸，弹窗高度相应变化。 |
| `surface-notifications-1440-dark.png` | 接受：未读点绝对定位；已读与未读文字左对齐。 |
| `surface-notifications-1440-light.png` | 接受：未读点绝对定位；已读与未读文字左对齐。 |
| `surface-notifications-390-dark.png` | 接受：未读点绝对定位；已读与未读文字左对齐。 |
| `surface-notifications-390-light.png` | 接受：未读点绝对定位；已读与未读文字左对齐。 |
| `surface-oauth-consent-390-dark.png` | 接受：授权文档复选框与文字恢复同一横排。 |
| `surface-oauth-consent-390-light.png` | 接受：授权文档复选框与文字恢复同一横排。 |
| `surface-reading-chart-1440-light.png` | 接受：画面中的图表柱形及图例由旧绿改为新分类色板；文字、数据、几何与其余界面无可见回归。 |
| `surface-settings-tokens-1440-dark.png` | 接受：令牌范围复选框恢复 16px 横排；目标滚入视口造成面板滚动位置随高度改变。 |
| `surface-settings-tokens-1440-light.png` | 接受：令牌范围复选框恢复 16px 横排；目标滚入视口造成面板滚动位置随高度改变。 |
| `surface-settings-tokens-390-dark.png` | 接受：令牌范围复选框恢复 16px 横排；目标滚入视口造成面板滚动位置随高度改变。 |
| `surface-settings-tokens-390-light.png` | 接受：令牌范围复选框恢复 16px 横排；目标滚入视口造成面板滚动位置随高度改变。 |
| `surface-share-page-1440-light.png` | 接受：画面中的图表柱形及图例由旧绿改为新分类色板；文字、数据、几何与其余界面无可见回归。 |
| `surface-toast-1440-dark.png` | 接受：清单外场景已核实：toast 所在设置面板受令牌复选框高度修复影响；toast 行为不变。 |
| `surface-toast-1440-light.png` | 接受：清单外场景已核实：toast 所在设置面板受令牌复选框高度修复影响；toast 行为不变。 |
| `surface-toast-390-dark.png` | 接受：清单外场景已核实：toast 所在设置面板受令牌复选框高度修复影响；toast 行为不变。 |
| `surface-toast-390-light.png` | 接受：清单外场景已核实：toast 所在设置面板受令牌复选框高度修复影响；toast 行为不变。 |

清单外差异先按回归调查，逐项依据上述 CSS 变更和原图对照排除后才列入更新；没有直接全量重建或放宽断言。运行结果见本目录的 macos-release-verification.md。

正式更新结果：`pnpm test:visual:update` 退出 0，38 个测试完成；实际更新 45 张，逐一与上表核对，没有额外文件。更新后连续两轮比对均退出 0，每轮 38 个测试完成、176 张基线参与比对；代码及基线指纹在两轮期间保持不变。
