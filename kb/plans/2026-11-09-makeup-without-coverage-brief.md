---
created: 2026-11-09
tags:
  - brief
  - makeup
---

# 执行简报：补课记录允许不抵扣任何课

- **执行者**：Claude Sonnet（由 Claude Opus 派发，本简报和 plan 都是 Opus 写的）
- **工作位置**：当前 checkout `/Users/reorx/Code/nce-class`，`master` 分支，不新建分支和 worktree
- **开始前先读**：
  1. `AGENTS.md`
  2. `kb/plans/2026-11-09-makeup-without-coverage.md`：本次的 plan，PRD 和 Tech Design 都以它为准
  3. `kb/docs/business-rules.md`「出勤、作业与补课记录」
  4. `kb/docs/verification-guide.md`（agent-browser 部分）

## 目标

登记或编辑补课时，「抵扣的课」改为选填：没有可抵扣的课、或者一节都没勾，也能保存。这样老师可以先登记提前补的课，之后学生缺课了再编辑记录去勾选。改动只在服务端请求校验和 Web 表单两层，存储和接口格式都不变。

## 完成标准

- plan「实施步骤」1–7 全部勾选。
- plan「测试与验证」里的 server 和 web 用例都有对应的自动化测试，并且通过。
- `pnpm --filter server test`、`pnpm --filter web test`，以及两个包的 `exec tsc --noEmit` 全部通过。
- 端到端流程 1–5 用 agent-browser 跑通，截图放在 `tmp/2026-11-09-makeup-without-coverage/`。
- 改动集中在一个本地 commit 里，不 push。

## 已定的决策（不要重新讨论）

| 问题 | 决定 | 谁定的 |
|---|---|---|
| 是否允许 0 节 | 新建、编辑都允许；编辑时可以把原有勾选全部取消 | 用户 |
| 出勤表格子弹窗要不要提示「该生有未抵扣的记录」、提供「用这条抵扣」 | 不做，老师去「补课记录」里编辑那条记录 | 用户 |
| 0 节记录在列表里的显示 | 沿用醒目的「未抵扣任何课」，提醒老师之后去关联 | Opus |
| 服务端缺少 `sessionIds` 字段或传的不是数组 | 仍然 400，只放开空数组 | Opus |
| 409 后勾选被清空，再点保存 | 不额外拦截，允许存成 0 节记录 | Opus |

标「Opus」的几条，如果实施时发现更好的做法或明显的问题，可以在 session 总结里提出异议，但这次仍按 plan 实现。

## 怎么做

- **测试先行**：按 plan 的实施步骤，server 和 web 都先写或改测试、确认新用例失败，再改实现。
- **只用临时数据**：本地 `pnpm db:reset` 生成的 seed 数据可以随便改。**绝不连生产**，不 ssh，不查线上库。
- **端口**：5173 / 5177 常被邻近项目 tenderbuddy 占用。起服务前先 `lsof -nP -iTCP:5177 -sTCP:LISTEN` 看一下；被占用的话，server 用 `PORT=5187`，在 `tmp/` 下写一份临时 vite 配置把 proxy 指向 5187，web 用 `--port 5180`。不要提交对 `vite.config.ts` 的修改，不要杀别的项目的进程。
- **agent-browser**：弹窗表单里 `@e` 引用会失效，用 `eval` 写法，照抄 `kb/docs/verification-guide.md`。跑完执行 `mac-dev-cleanup --only browser`，自己起的 dev server 也要关掉。
- **不要跑 formatter / linter**；不写 try/catch。

## 约束

- 可以改 `server/`、`web/`、`kb/docs/business-rules.md`、`kb/plans/2026-11-09-makeup-without-coverage.md`（勾选步骤，或写偏离原因）、`kb/plans/2026-11-09-makeup-lesson-records.md`（只改 plan 里点名的那几处）、`kb/sessions/`。
- 不改 `miniapp/`、`AGENTS.md`、`kb/todo.md`、`kb/next-up.md`：这几个文件由派发者在工作完成后更新。
- `git add` 只加自己改过的文件。提交信息按 AGENTS.md 的格式：首行一句总结，空行后用 `-` 列表写详情。
- **不 push，不 merge**：push master 就会部署到生产，需要用户确认。

## 完成后留下

- 一个本地 commit：代码、测试、文档、session 总结都在里面。
- `kb/sessions/2026-11-09-makeup-without-coverage.md`，分这几节：做了什么 / 偏离 plan 的地方及原因 / 测试结果 / 遗留问题 / 相关文档。
- 截图：`tmp/2026-11-09-makeup-without-coverage/`。
- 发现 plan 范围外的问题：够得上 `kb/known-issues.md` 标准的写进去，其余写进 session 总结的「遗留问题」，不要顺手修。
- 最后在终端回复一段简短汇报：commit hash、测试结果、偏离 plan 的地方、需要用户决定的事。
