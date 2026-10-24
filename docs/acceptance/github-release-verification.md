# GitHub 发布验收 · 2026-10-25（Asia/Taipei）

- 仓库：https://github.com/HHHHKM/hcd 。先按要求创建 Private；随后 Alkaid 明确授权公开，已切换为 Public，并经 CLI 和 GitHub 页面复核。
- 首次提交：`571b97f7a87a4f1e47a3e55d07ac23a0f2fb4e98`，作者 Alkaid，GitHub noreply 邮箱；包含 Claude 与 Codex 两条 Co-authored-by 署名。README、AUTHORS、LICENSE 和仓库简介中的署名已经核对。
- 首轮 Actions：[CI 40121985155](https://github.com/HHHHKM/hcd/actions/runs/40121985155) 为 success。Ubuntu 上完成冻结锁文件安装、Playwright Chromium 安装、lint、类型检查、114 个文件 / 686 项测试与构建。原有三条构建警告保留；Actions/依赖还输出 Node 弃用警告，原始日志未隐藏。
- 在全新目录从 GitHub 克隆上述提交，`pnpm install --frozen-lockfile`、`pnpm verify` 均退出 0；仍为 114 个文件、686 项测试通过。
- 在真实 GitHub 页面目测 README 图片可显示，Alkaid 版权、Claude/Codex 共同完成署名与文档链接可见。
- `hondrytravis` 的协作者写入邀请已按 Alkaid 的明确指示发出，邀请编号 339519743；接受状态以 GitHub 为准。
- 发布目标为带注释标签 `v0.1.0` 和 prerelease；本记录随发布文档提交，标签指向这次文档提交。发布结果以 [Release 页面](https://github.com/HHHHKM/hcd/releases/tag/v0.1.0) 为准。
- 首轮 CI 和全新克隆复验之后的本次提交只补充文档和日志，不修改产品代码、测试、锁文件、构建配置或视觉基线。

## 失败尝试与原因

首次推送被 GitHub 拒绝，原因是 OAuth 登录缺少 `workflow` scope，无法创建 `.github/workflows/ci.yml`。负责人在 GitHub 完成补充授权后，原提交重新推送成功；未删除或跳过 CI 文件。CI 观察命令曾遇到网络 `unexpected EOF`，随后重新读取 Actions 的正式结果为 success，该观察错误不是 CI 失败。

## 原始命令与证据

| 操作 | 命令 | 结果/证据 |
| --- | --- | --- |
| 建仓 | `gh repo create HHHHKM/hcd --private --source <source> --remote origin` | 退出 0；之后按负责人明确指示公开 |
| 首次推送 | `git push -u origin main`（GitHub CLI 临时凭据助手） | 退出 1；[原始日志](github-release-20261025-logs/github-push-first.log) |
| 补充授权后推送 | 相同提交与推送命令 | 退出 0；[原始日志](github-release-20261025-logs/github-push.log) |
| 首轮 Actions | `gh run view 40121985155 --repo HHHHKM/hcd` | [实际状态 JSON](github-release-20261025-logs/ci-first-result.json)、[完整日志](github-release-20261025-logs/ci-first.log) |
| 全新克隆、冻结安装、完整 verify | `git clone https://github.com/HHHHKM/hcd.git <fresh>` → `pnpm install --frozen-lockfile` → `pnpm verify` | 全部退出 0；[命令与退出码](github-release-20261025-logs/fresh-verification.json)、[verify 日志](github-release-20261025-logs/fresh-verify.log) |
| 公开仓库 | `gh repo edit HHHHKM/hcd --visibility public --accept-visibility-change-consequences` | 退出 0；后续查询 visibility=PUBLIC |
| 协作者邀请 | `gh api --method PUT repos/HHHHKM/hcd/collaborators/hondrytravis -f permission=push` | 负责人明确同意写入权限后成功，返回 permissions=write |

授权码和认证令牌未写入仓库。公开前再次扫描受版本控制文件，未发现密钥、私人会话链接或禁止提交产物。服务器未部署，未接入真实 SMTP、飞书或 OAuth 服务。
