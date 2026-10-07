---
created: 2026-10-07
tags:
  - plan
  - brief
  - web
  - tanstack-query
  - migration
---

# 任务简报：执行 Plan 2（Web 组件全量迁移到 Query / Mutation）

- **执行者**：一个独立的 Claude agent（你），在 Herdr 新 tab 中运行。
- **简报作者**：实现 Plan 1 的那个 agent（不是用户）。Plan 2 正文是用户确认过的设计；下文「Plan 1 实际落地的决定」是我实现时自己做的选择，用户没有逐条确认——你若有更好的理由，可以在总结里提出异议，但不要中途推翻已提交的基础层接口。
- **工作位置**：主 checkout `/Users/reorx/Code/nce-class`，分支 `web-query-foundation`（Plan 1 已提交在此分支）。不要建 worktree、不要切分支。
- **开工前必读**（按顺序）：
  1. `AGENTS.md`
  2. `kb/plans/2026-10-06-web-query-component-migration.md` — **Plan 2，本任务的主计划，逐条执行**
  3. `kb/plans/2026-10-06-web-query-foundation.md` — Plan 1，重点读末尾「实施记录」
  4. `kb/sessions/2026-10-06-web-query-foundation.md` — Plan 1 的 session 总结，「注意事项」里有测试 harness 的坑
  5. `kb/docs/business-rules.md`、`kb/docs/classroom-session-lifecycle.md`、`kb/docs/verification-guide.md`
  6. 代码：`web/src/queries/`（尤其 `cache-effects.ts`、`mutation.ts`、`session.ts`、`attendance.ts`）、`web/src/api/`、`web/src/lib/api.ts`（兼容桥）

## 目标

Web 端所有业务请求从 `lib/api` 的旧调用迁到 `queries/<domain>` 的 hooks：页面往返时直接显示缓存、过期后台刷新，写操作后相关页面一致更新，首次加载 / 空数据 / 错误 / 后台刷新各有对应展示。全部迁完后删除 `lib/api.ts` 兼容桥，known-issues 的「Web 页面往返重复加载、内容短暂空白」验收通过后删除。

## 完成标准

逐条可检查：

1. Plan 2「浏览器验收与完成标准」清单全部勾选，每项有截图或网络证据。
2. `rg -n "lib/api|from '\.\./lib/api'|from '\./api'" web/src` 无业务引用；`lib/api.ts` 与 `lib/api.test.ts` 已删除；组件内没有直接调用 `api/<domain>` 函数（类型 `import type` 除外）。
3. `pnpm --filter web test`、`pnpm --filter web exec tsc --noEmit`、`pnpm --filter web build`、`pnpm --filter server test` 全部通过。
4. Plan 2「先写的行为测试」B01–B20 每条都有对应的自动化用例（文件里用注释标出编号），或在总结里写明为什么只能靠浏览器验收。
5. 收银台冷启动 → 详情 → 返回列表：在 30 秒内返回时列表首帧即有数据、列表 GET 不增加（用网络记录证明，不只截图）。
6. `kb/sessions/2026-10-07-web-query-component-migration.md` 已写好（格式见下）。

## 已定决定（不要重新讨论）

| 问题 | 决定 | 谁定的 |
|---|---|---|
| 迁移范围 | 只改 `web/`；不改小程序、服务端、数据库、收费口径、结束课堂提交 schema | 用户 |
| HTTP | 保留 fetch，不引入 Axios | 用户 |
| 分层与命名 | 组件 → `queries/<domain>` hooks；类型从 `api/<domain>` 用 `import type`；`useXxxQuery` / `useXxxMutation` | 用户 |
| 课堂 | 本地优先不变；后台刷新、StrictMode 重挂载不得重置课堂 / 生成新 clientSessionId / 覆盖草稿 | 用户 |
| Mutation 参数形状 | 单对象，后端参数在 `input` / `payload` 等字段原样传，`classId` 等失效上下文是同级字段，不发给后端 | 我（Plan 1） |
| 身份 | `useMeQuery().data === null` = 未登录，`undefined + error` = 读取失败；登录/退出走 `useLoginMutation` / `useLogoutMutation`，它们负责清缓存 | 我（Plan 1） |
| 密码类 Mutation | `useLoginMutation`、`useVerifyPasswordMutation`、管理员三个写操作完成即 reset，`error` 不会留在返回值上——**错误提示必须用 `mutateAsync` 的 rejection 处理** | 我（Plan 1） |
| 考勤 | `useClassAttendanceQuery` 已叠加 pending overlay；`usePendingAttendanceCells` 给撤销/格子禁用；同格重复提交抛 `AttendanceCellBusyError`（页面应提前禁用而不是依赖它） | 我（Plan 1） |
| 后台错误通知 | `setBackgroundErrorHandler(client, handler)` 已留注入点，Plan 2 批次 A 接 Toast | 我（Plan 1） |

## 范围

按 Plan 2「实施批次」A → F 的顺序做，每个批次是一个可独立提交的单元。Plan 2 的「逐文件迁移清单」是覆盖范围的依据，嵌套组件和弹窗也要迁。

允许你在 `web/src/queries/` 内**新增**东西（例如 Plan 2 提到的预取 hook、身份状态派生函数、Toast 接线 hook）。修改已有 hook 的签名或 cache-effects 规则时：先写/改测试，并在总结里列出改了什么、为什么。

## 不做的事

- 不做视觉重设计、不换路由框架、不改服务端接口。
- 不为了「消灭 useEffect/useState」重写课堂 reducer、计时、表单草稿等本地状态。
- 不做 Query 缓存持久化、跨标签同步、离线排队。
- 发现超出范围、但会影响使用的问题：记到 `kb/known-issues.md`（标准见 `/kb` skill），并在总结「遗留问题」里写一句；不要顺手去修服务端或小程序。

## 工作方式

- **测试先行**：每个批次先写该批次对应的 B 编号用例再改组件（沿用 `web/src/test-utils/` 的假 fetch、fixtures、`renderWithClient`）。需要驱动真实页面组件时用 Testing Library 渲染页面 + MemoryRouter，测试文件头加 `// @vitest-environment jsdom`。
- **测试坑**（Plan 1 踩过）：useQuery 默认只在渲染中读过的字段变化时重渲染，hook harness 里要在渲染时读 `data`；observer 更新是异步批处理，`mutateAsync` 之后的断言用 `waitFor`。
- **浏览器验证不碰用户的开发库**：把 `server/data/app.db` 复制到 `tmp/2026-10-07-web-query-migration/app.db`，用 `NCE_DB_PATH=<该副本绝对路径> pnpm --filter server dev` 起服务（会自动带 `WX_MOCK=1`），`pnpm --filter web dev` 起 web。开发库里没有收款批次，收费流程在副本里自建测试数据（名字带「测试」）。不要 `pnpm db:reset`。
- **端口**：起服务前 `lsof -nP -iTCP:5173 -sTCP:LISTEN`、`lsof -nP -iTCP:5177 -sTCP:LISTEN`。被占用时先看进程 cwd；不是本项目的（常见是邻近项目 tenderbuddy）**不要杀**，停下在总结里说明，或 web 换端口 `pnpm --filter web exec vite --port 5180`（server 必须在 5177，vite 代理写死了）。
- **agent-browser**：用自己的命名 session；拖拽与弹窗表单的坑照 `kb/docs/verification-guide.md` 用 `eval`。验收时同时看 DOM 和网络请求。
- **收尾必须释放资源**：关掉 dev server、`agent-browser close`、`mac-dev-cleanup --only browser --min-age 2`。不要留下后台进程。
- 不运行 formatter / linter。

## 约束

- 只改 `web/` 和 `kb/`（以及 `AGENTS.md` 里与请求层相关的几行，见下）。
- 每个批次完成且测试通过后提交一次：`git add` 只加你改的文件；commit message 按 AGENTS.md 约定（首行一句中文总结，空行后 `-` 列表：改了什么 / 口径与根因 / 测试与验证结果），末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`（以你实际的模型名为准）。
- **不合并、不 push、不部署**。合并时机由用户决定。
- 共享文件：`AGENTS.md` 只按 Plan 2 批次 F 更新请求层约定与目录描述（删掉「lib/api.ts 是兼容桥」那句等），不动其他段落；`kb/known-issues.md` 只动「Web 页面往返重复加载」条目（全部验收通过才删除），以及新登记你发现的问题；`kb/next-up.md`、`kb/todo.md` 不要动。

## 完成后留下

1. 所有批次的提交，工作区干净（`git status` 无改动）。
2. Plan 2 文件：状态改为已实施，清单打勾，末尾加「实施记录」写与计划不同的决定。
3. Session 总结 `kb/sessions/2026-10-07-web-query-component-migration.md`：按 `/kb` skill 的 session 格式（概要 / 修改的文件 / 注意事项 / 遗留问题 / 已解决的已知问题 / 相关文档），另加一节「我自行决定的事」列出简报和 Plan 没覆盖、你自己拍板的选择。
4. 截图与网络证据归档在 `tmp/2026-10-07-web-query-migration/`（主 checkout 下，不会随 worktree 消失），总结里写路径。
5. 最后在终端里回复一段简短报告：完成了哪些批次、测试数字、遗留问题、总结文件路径。
