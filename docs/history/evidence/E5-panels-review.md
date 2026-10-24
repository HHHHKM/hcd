# E5 panels 区域迁移审查（未 apply）

- `E5-05-inspector-discussion.manifest.json`：56 个 inspector/discussion theme selector members，113 个显式操作（包括 54 条原 owner 规则移位）。right-rail/right-tabs 是 App 布局预算，保留 workspace owner 以满足只加载 styles 链路的 C8。讨论、评论、composer、团队与动态的原 workspace-05 规则先按原规则替换主题声明，再连同辅助基础规则迁入 DiscussionThreads 自导入的 discussion.css，避免在 styles 链路保留同权重覆盖。
- 右侧栏 981–1199 新边界和 ≥1200 原状态分开处理，不改媒体条件。分段按钮保留 `:not(.right-tab-more)`，更多按钮的基础字体、定位与状态声明继续有效；不会把普通按钮的填充套到更多按钮。
- comment-card/composer/team-card 的旧 `.app.dark` 背景成员和冗余主题暗色成员一起移除，浅/深主题均从合回后的基础规则读取语义 token。
- `E5-06-review-changes-history.manifest.json`：48 个 review/changes/history/version theme members，50 个操作。changes 与 version 声明进自导入组件 CSS；review dialog 没有单独 CSS import，保留原 workspace-06 owner。旧 max620 history padding 和 max720 submission gap 已被当前主题永久覆盖，移除这两个冲突旧声明，保留其余有效换行/间距属性。
- max720 的 history/version mobile 状态保留精确媒体条件；不映射成旧 max620。ins/del 原 clone 规则继续保留。
- panels 的通知 4 个 selector members 留给 chrome/notifications 功能区域，不能误称 panels 全部消费。

以上只保存 manifest 与 preview，尚未改生产 CSS。每区 apply 前必须刷新共享文件 SHA，preview 后检查；apply 后立即 build 和完整 34 项 visual，失败完整回滚，绝不更新冻结的 176 张 PNG。
