# B1 / B2 / B9 工作记录

本记录供阶段 B 的 FIX_REPORT.md 汇总使用。未执行完整 `pnpm verify`，未进入阶段 C；阶段验证由主任务统一执行。没有修改任何既有测试断言，也没有修改既有测试的非断言部分（只新增测试用例/文件）。所有新增服务测试使用临时目录中的 SQLite 数据库，邮件仅使用本地注入的 fixture。

## 实现

| 编号 | 状态 | 改动文件 | 说明 |
| --- | --- | --- | --- |
| B1 | 实现完成；与 1 条旧断言冲突 | packages/server/src/app.ts、packages/web/src/VersionComparison.tsx、packages/web/src/api.ts、packages/server/test/version-authors.test.ts、packages/web/src/VersionComparison.test.tsx | 版本列表和快照接口 LEFT JOIN users 返回 authorName；没有名字时前端使用「未知用户 / Unknown user」，不再回退到内部 createdBy。 |
| B2 | 实现完成；与 1 条旧断言冲突 | packages/server/src/db.ts、app.ts、ai-tasks.ts、packages/web/src/DiscussionThreads.tsx、SharedDocument.tsx、packages/server/test/pinned-comments.test.ts、packages/web/src/DiscussionThreads-actions.test.tsx | 持久化不可变 created_version；固定链接根评论/成员主题回复按创建版本过滤；访客主题全部回复可见；固定链接回复检查父主题可见性；固定文档响应不返回 currentVersion；成员回复访客主题时显示可见性提示。 |
| B9 | 完成 | packages/server/src/app.ts、packages/web/src/DiscussionThreads.tsx、packages/server/test/comment-permissions.test.ts、packages/web/src/DiscussionThreads-actions.test.tsx | commenter 及以上且拥有未删除的主题评论/回复可解决、重新打开；owner 可以操作任意主题；令牌必须明确具有 comment 范围，只有 submit 不够。前端同步显示参与者操作。 |

## 新增测试与红绿证据

共新增 8 条回归测试：

- `B1 returns the author name in both version history APIs`：修复前缺少 authorName；修复后通过。`B1-api-red.log` / `B1-api-green.log`。
- `B1 hides internal creator IDs and falls back to an unknown-user label`：修复前显示 u_internal；修复后通过。`B1-web-red.log` / `B1-web-green.log`。
- `B2 filters pinned threads and member replies by creation version while keeping every guest-thread reply`：修复前 v1 固定链接读到 v2 主题；修复后通过。覆盖 v1 成员主题/回复、v2 主题/回复隔离、旧 pin 访客主题与回复、成员对访客主题的 v2 回复可见、不可见父主题 404、固定 doc 无 currentVersion、非固定链接行为保留。`B2-api-red.log` / `B2-api-green.log`。
- `B2 upgrades legacy comments using guest pins or their creation-time published version without losing data`：修复前缺少 created_version；修复后通过。`B2-migration-red.log` / `B2-api-green.log`。
- `B2 warns members above the reply box that a guest-started thread is visible externally`：修复前没有提示；修复后通过。`B2-web-red.log` / `B2-web-green.log`。
- `B9 lets an active participant resolve and reopen but rejects nonparticipants, deleted participation and viewers`：修复前参与者返回 403；修复后通过。`B9-api-red.log` / `B9-api-green.log`。
- `B9 requires explicit comment scope for tokens even when their owner or participant has submit scope`：修复前只有 submit 的 PAT 返回 200；修复后返回 403，comment PAT 可用。`B9-api-red.log` / `B9-api-green.log`。
- `B9 shows resolution actions to members with a nondeleted reply in the thread`：修复前没有 Resolve 按钮；修复后通过。`B9-web-red.log` / `B9-web-green.log`。

`B-comments-typecheck.log`：`pnpm typecheck` 通过。

`B-comments-regression.log`：11 个文件 / 70 条测试，68 通过，2 失败；9 个文件通过，2 个文件失败。包含版本、固定评论、权限、guest/share、评论锚点、通知、AI 系统回复和前端讨论回归。2 个失败均为下方列出的旧断言冲突；其余检查通过。不是浏览器验收。

## 数据库迁移

在既有 guest 作者迁移之后检查 `comments.created_version`，缺少时在事务内 ADD COLUMN `INTEGER NOT NULL DEFAULT 1` 并回填：访客关联的分享链接有 version_pin 时优先使用 pin；其余按 `versions.created_at <= comments.created_at` 找该文档最新版本；没有匹配版本取 1。旧评论正文、锚点、创建时间保持不变。成员根评论和回复写入当时正式版本；访客写入链接当前可见版本；系统回复写入当前正式版本；seed 演示评论明确写入 1。后续发布继续只迁移 anchor，created_version 不变。

旧库升级测试模拟缺失该列，验证版本 1/2 成员历史与固定 v1 访客根评论和回复的回填结果、数据不丢、升级后的固定链接可见性及外键完整性。

## 待决定

1. 旧测试 `packages/web/src/VersionComparison.test.tsx:30` 断言 `expect(html).toContain('Created by: u_owner')`，测试 fixture 只有 createdBy。它与 B1 明确要求「没有名字显示 Unknown user，任何情况下不显示内部编号」直接冲突。保留断言，正确实现 B1 后该旧测试失败。需要维护方允许按新规格更新旧测试断言，无法同时满足两种相反输出。
2. 旧测试 `packages/server/test/comment-selection.test.ts:220` 名称为 `strips unmatched future quotes, contexts and unavailable node IDs from public pinned responses while preserving discussion bodies`。它在 v2 发布后才创建 3 个成员主题及回复，再要求固定 v1 响应含这些主题正文（首次失败在 :232）。它与 D-1/B2 的创建版本隔离明确冲突。保留全部断言，按新规则这些主题不可见。需要维护方允许拆分旧锚点投影测试与新可见性规则，无法通过继续泄露 v2 主题正文来满足旧断言。

## 浏览器验收

未执行，由阶段 D 统一执行。本组前端结果仅 SSR/jsdom 证据。
