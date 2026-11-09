---
created: 2026-11-09
tags:
  - brief
  - makeup
---

# 执行简报：补课记录功能

- **执行者**：codex（由 Claude 派发，本简报和 plan 都是 Claude 写的）
- **工作位置**：当前 checkout `/Users/reorx/Code/nce-class`，`master` 分支，不新建分支和 worktree
- **开始前先读**：
  1. `AGENTS.md`
  2. `kb/plans/2026-11-09-makeup-lesson-records.md`：本次的 plan，PRD 和 Tech Design 都以它为准
  3. `kb/docs/business-rules.md`「出勤与作业」「排班与收费」
  4. `kb/docs/web-data-layer.md`
  5. `kb/docs/classroom-session-lifecycle.md`
  6. `kb/docs/verification-guide.md`

## 目标

老师可以在考勤页登记补课：日期、学生、时长、抵扣哪几节缺的课（包括插班前「未在班」的课）。被抵扣的格子显示为带「补」角标的 ✓，出勤统计和收费参考按「已补」计算。旧的「已补课」开关去掉，线上的旧标记迁移成补课记录。

## 完成标准

- plan「实施步骤」1–8 全部勾选。
- 「测试与验证」表里每个用例都有对应的自动化测试，并且通过。
- server、web 两个包的 `test` 和 `tsc --noEmit` 全部通过（miniapp 没有改动就不用跑）。
- 人工验收流程 1–9 用 agent-browser 跑通，每一步的截图放在 `tmp/2026-11-09-makeup-lesson-records/`。
- 改动集中在一个本地 commit 里，不 push。

## 已定的决策（不要重新讨论）

| 问题 | 决定 | 谁定的 |
|---|---|---|
| 旧「已补课」开关 | 去掉，只保留补课记录一套；线上旧标记迁移成「未记录时长」的补课记录 | 用户 |
| 一条记录对应几个学生 | 一个 | 用户 |
| 插班前的课被抵扣后是否计入出勤率 | 计入（应上、实到都 +1），收费的「已上到堂」也计入 | 用户 |
| 已被抵扣的课改成到勤 | 自动解除抵扣（考勤页先二次确认），记录本身保留 | Claude |
| 补课数据放在哪 | 并入 `GET /api/classes/:id/attendance` 的 `makeups`，不另开读取接口 | Claude |
| 旧 `made_up` 列 | 迁移后清零，但不 DROP，这样回滚旧镜像不会报错 | Claude |

标「Claude」的几条，如果实施时发现有更好的做法或者明显的问题，可以在 session 总结里提出异议，但这次仍按 plan 实现。只有在照 plan 做不下去的情况下才偏离，并在 plan 对应段落写一句原因。

## 怎么做

- **测试先行**：
  - 服务端：新增写接口、改动考勤更正接口，都按 AGENTS.md 先写测试再实现。
  - Web：lib 和缓存矩阵先写用例。
- **兼容纪律**：遵守 AGENTS.md 里「结束课堂 schema 向后兼容」那一条。`api.test.ts` 里的「向后/向前兼容」用例挂了，就改实现，不要改测试。
- **只用临时数据**：
  - 本地 `pnpm db:reset` 生成的 seed 数据可以随便改。
  - **绝不连生产**，不 ssh，不查线上库。迁移是否正确由 `provision.test.ts` 构造的旧库保证。
- **端口**：
  - 5173 / 5177 常被邻近项目 tenderbuddy 占用。起服务前先 `lsof -nP -iTCP:5177 -sTCP:LISTEN` 看一下。
  - `web/vite.config.ts` 把 `/api` 代理写死在 5177 上，所以 server 默认要占 5177。
  - 如果 5177 被占用：server 改用 `PORT=5187`，在 `tmp/` 下写一份临时 vite 配置，把 proxy 指向 5187，web 用 `--port 5180` 启动。不要提交对 `vite.config.ts` 的修改。
  - 不要杀别的项目的进程。
- **agent-browser**：
  - 弹窗表单里 `@e` 引用会失效，要用 `eval` 写法，照抄 `kb/docs/verification-guide.md`。
  - 跑完执行 `mac-dev-cleanup --only browser`，自己起的 dev server 也要关掉。
- **不要跑 formatter / linter**；不要写 try/catch，除非是顶层处理。

## 约束

- 可以改 `server/`、`web/`、`kb/docs/`、`kb/plans/2026-11-09-makeup-lesson-records.md`（只勾选步骤，或写偏离原因）、`kb/sessions/`、`kb/next-up.md`、`kb/known-issues.md`、`AGENTS.md`。
- 不改 `miniapp/`，不改 `kb/todo.md`。
- `git add` 只加自己改过的文件。提交信息按 AGENTS.md 的格式：首行一句总结，空行后用 `-` 列表写详情。
- **不 push，不 merge**：push master 就是上线，需要用户确认。

## 完成后留下

- 一个本地 commit：代码、测试、文档、session 总结、next-up 条目都在里面。
- `kb/sessions/2026-11-09-makeup-lesson-records.md`：用 `/kb ss` 的格式（如果没有这个 skill，就写这几节：做了什么 / 偏离 plan 的地方及原因 / 测试结果 / 遗留问题 / 相关文档）。
- `kb/next-up.md`：增加「补课记录部署之后」一节，内容是 plan「风险与待定」第一条里的线上核对项。
- 截图：`tmp/2026-11-09-makeup-lesson-records/`。
- 发现 plan 范围外的问题：够得上 `kb/known-issues.md` 标准的写进去，其余写进 session 总结的「遗留问题」，不要顺手修。
- 最后在终端回复一段简短汇报：commit hash、测试结果、偏离 plan 的地方、需要用户决定的事。
