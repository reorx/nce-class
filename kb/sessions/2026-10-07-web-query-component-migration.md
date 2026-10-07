---
created: 2026-10-07
tags:
  - web
  - tanstack-query
  - migration
  - cache
  - classroom
  - testing
---

# Web 组件全量迁移到 TanStack Query（Plan 2）：页面往返复用缓存，写后跨页一致，课堂本地优先不变

## 概要

老师在收银台列表与详情间往返要重新等待请求（known issue「Web 页面往返重复加载、内容短暂空白」）。Plan 1 已在分支 `web-query-foundation` 建好 api / queries 基础层与兼容桥，本次按 Plan 2 的 A → F 批次把全部 21 个调用方迁到领域 hooks：身份入口、收银台与排班、班级 / 学生 / 老师、上课记录与考勤、课前配置与课堂、管理页，最后删掉 `lib/api.ts` 兼容桥并把所有类型改从 `api/<domain>` 导入。每批先写对应 B 编号的页面级行为测试（Testing Library 渲染整个 App + 假 fetch），再改组件。浏览器验收在开发库的副本上进行，过程中发现并修了三个计划没覆盖的问题：断网刷新时身份读取失败会挡住本地课堂、恢复联网后提交课堂会卡在「无法读取登录状态」、主动退出后来处残留导致下一个账号回到上一个账号的页面。最终 web 513 个测试、tsc、build、server 292 个测试通过；生产构建下收银台冷启动 → 详情 → 30 秒内返回，列表首帧有数据且列表 GET 不增加（HAR 证明）。分支未合并、未 push。

## 修改的文件

- `web/src/App.tsx` — 只用 `useMeQuery` 一套身份状态；`Guard` 组件区分已登录 / 未登录（被动退出记来处，主动退出不记）/ 读取失败（重试）/ 加载；课堂页 `LocalClassroomGuard`：本机有该班课堂时身份读取中或失败也进课堂
- `web/src/components/SignOut.tsx`（新）— App 层退出登录（`useLogoutMutation`），记录「主动退出」标记供守卫判断
- `web/src/components/BackgroundErrorToasts.tsx`、`web/src/queries/background-errors.ts`（新）— 后台刷新失败接 Toast，同文案 4 秒去重
- `web/src/components/QueryState.tsx`、`web/src/lib/queryView.ts`（新）— 页面读取状态统一口径与展示（`QueryBlock` / `LoadingBlock` / `LoadErrorBlock` / `RefreshStatus`）
- `web/src/pages/Login.tsx`、`components/TopBar.tsx` — 登录 / 退出 Mutation；退出失败如实提示
- `web/src/pages/Billing.tsx`、`BillingBatch.tsx`、`components/BillingBatchModal.tsx`、`components/ScheduleTab.tsx` — 收银台与排班全部走 hooks；卡片悬停预取详情；收款单每行独立 Mutation；创建弹窗选班纯派生、换班取消旧请求；排班编辑器等新鲜详情再一次性建草稿
- `web/src/pages/ClassList.tsx`、`ClassDetail.tsx`、`StudentProfile.tsx`、`Teachers.tsx`、`Sessions.tsx`、`components/ClassInfoModal.tsx`、`StudentEditModal.tsx`、`SessionsTable.tsx` — 班级 / 学生 / 老师 / 课堂列表走 hooks；默认分组改「服务端分组 + 草稿」；学生弹窗去掉 reload 契约，可带 classId 收窄失效
- `web/src/pages/SessionDetail.tsx`、`ClassAttendance.tsx`、`components/HomeworkTemplateEditor.tsx` — 上课记录详情与考勤表走 hooks；考勤用 pending overlay，撤销只收录成功写入、撤销失败可重试；模板弹窗只在打开时填草稿
- `web/src/pages/Setup.tsx`、`Classroom.tsx`、`components/PrevLessonContent.tsx`、`HomeworkSidebar.tsx` — 课前配置等最新名单建草稿；课堂进入判定、最新读取定稿一次、提交冻结；上节课参考改共享 `usePrevLessonQuery`
- `web/src/lib/classroomBoot.ts`（新）、`lib/classroomStore.ts` — 进入判定纯函数 `bootPlan` / `settleBoot`；`freezeCommit`、`loadCommitBackup`
- `web/src/pages/Admin.tsx` — 管理页三个密码类 Mutation 与共享查询
- `web/src/queries/classes.ts`、`sessions.ts` — 新增 `useLatestClassQuery`、`useLatestSessionQuery`
- `web/src/queries/client.ts` — 写成功且 me 读取失败无数据时，在写 resolve 前重读 me
- `web/src/queries/auth.ts` — 新增 `authStatus` 派生函数
- `web/src/queries/cache-effects.ts` — 删除批次时从缓存的收银台列表拿掉该项
- `web/src/lib/api.ts`、`lib/api.test.ts` — 删除；RecapCard*、RecapPanel、OverviewTab、`lib/*`、测试与故事的类型 import 改到 `api/<domain>`
- 测试（新）：`web/src/App.test.tsx`、`pages/Billing.test.tsx`、`ClassDetail.test.tsx`、`SessionDetail.test.tsx`、`Classroom.test.tsx`、`Admin.test.tsx`、`lib/queryView.test.ts`、`lib/classroomBoot.test.ts`、`queries/latest.test.tsx`、`test-utils/app.tsx`；补充 `queries/cache-effects.test.tsx`、`queries/auth.test.tsx`、`lib/classroomStore.test.ts`
- `kb/docs/web-data-layer.md`（新）— Web 数据层维护文档
- `AGENTS.md` — 结构里去掉兼容桥、补 classroomBoot / queryView / test-utils；改写「Web 请求层」约定；文档索引加 web-data-layer
- `kb/plans/2026-10-06-web-query-component-migration.md` — 状态改已实施、49 项打勾、加「实施记录」
- `kb/known-issues.md` — 删除「Web 页面往返重复加载、内容短暂空白」

B01–B20 与用例的对应（文件里用注释或用例名标了编号）：B01–B07、B09（收费 / 排班）、B17（批次）、B18（排班）、B19（弹窗班级列表）在 `pages/Billing.test.tsx`；B08、B09（资源 / 模板 / 分组）、B17（学生）、B19（老师列表）在 `pages/ClassDetail.test.tsx`；B09（作业 / 模板弹窗）、B12、B13、B18（考勤）在 `pages/SessionDetail.test.tsx`；B10、B11、B20 在 `App.test.tsx`；B14–B16 在 `pages/Classroom.test.tsx`，纯逻辑部分在 `lib/classroomBoot.test.ts` 与 `lib/classroomStore.test.ts`；B17（管理员删班）、B19（跨页老师列表）在 `pages/Admin.test.tsx`。删除课堂后旧 GET 不复活由 Plan 1 的 cache-effects 用例覆盖，本次在浏览器验证两个入口删除后汇总一致。

## 注意事项

- **页面级测试用 `test-utils/app.tsx` 渲染整个 App**：身份由测试 client 里的 me 缓存或 `/api/me` 假响应决定，能测到守卫、Provider、跨页导航和真实缓存，比 mock hook 返回值可靠。考勤 pending overlay 在 `onMutate` 异步完成后才出现，断言要 `waitFor`；Toast 2.6 秒才消失，断言「没有失败提示」要比较前后数量。
- **jsdom 测不出导航竞争**：退出后两次导航（守卫的 `<Navigate>` 与手动 `navigate`）在 jsdom 与浏览器里先后顺序相反，用例通过但浏览器里来处残留。涉及「谁最后跳转」的逻辑应保证只有一处跳转，而不是依赖顺序。
- **`refetchOnMount: 'always'` 只在挂载时生效**：查询从 disabled 切到 enabled 不会触发；「最新读取」要求查询从首次渲染起就启用，调用方等 `isFetchedAfterMount && !isFetching`。重试期间 `isError` 仍为 true，判定失败要加「不在读取中」。
- **守卫切换要保持同一棵组件树**：课堂页本地放行若在 `<Classroom/>` 与 `<Guard><Classroom/></Guard>` 之间切换，身份就绪时课堂会重挂载、丢 UI 状态；做成 Guard 的 `localOk` 参数后树形稳定，有回归用例。
- **删除实体时停用它的查询**：删除批次进行中起把详情查询 `enabled` 关掉，否则 Mutation 状态变化引发重渲染时，观察者会为已移除的 key 重建查询并发出一个 404 GET。
- **agent-browser 验证**：`network route "**/api/**"` 会拦掉 Vite 的 `/src/api/*.ts` 模块，要写成 `http://localhost:5173/api/**`；TanStack 的聚焦刷新监听的是 `window` 上的 `visibilitychange`，模拟时派发到 `window`；开发模式的 StrictMode 会让每个挂载请求出现「中止 + 重发」一对，网络证据用 `vite preview` 生产构建录制。
- **浏览器验证不碰开发库**：用 `sqlite3 .backup` 复制（开发库有 WAL，直接 cp 会丢最近写入）到 `tmp/` 再用 `NCE_DB_PATH` 起服务。

## 遗留问题

- 课堂离线进行时，窗口重新聚焦会让已过期的老师 / 奖章 / me 查询后台刷新失败并弹 Toast（同文案 4 秒去重）。不影响上课，但投屏场景可能显得打扰；如老师反馈再考虑在课堂页静默后台错误。
- 课前配置每次进入都要等一次班级详情请求（即便缓存新鲜），断网时无法从课前配置开新课（迁移前同样需要联网）。这是「开新课必须用最新名单」的取舍。
- 生产 build 有单个 JS chunk 超过 500 kB 的 Vite 提示（未拆包），不影响功能。
- 分支未合并、未 push、未部署，合并时机由用户决定。副本库 `tmp/2026-10-07-web-query-migration/app.db` 里留有测试数据（测试周期 A/B、测试老师 ceshi01、Leo测试 改名等），开发库未动。

## 已解决的已知问题

- **Web 页面往返重复加载、内容短暂空白**：全部页面改用共享 Query 缓存（新鲜期 30 秒、回收 30 分钟）。生产构建下录 HAR：冷启动列表 GET 1 次、悬停预取详情 1 次；进入详情与 30 秒内返回 0 个请求，列表首帧即有 2 张卡片（DOM 观测 4–5 ms，无加载态）；过期后返回先画缓存再后台刷新各 1 次。另验证首次失败可重试、后台刷新失败保留内容。证据在 `tmp/2026-10-07-web-query-migration/f05`–`f10` 截图与 `f-prod-billing-roundtrip.har` / `.api.txt`。

## 我自行决定的事

简报与 Plan 没覆盖、我自己拍板的选择（Plan 文件「实施记录」里有更完整的理由）：

- 页面状态统一用 `lib/queryView` + `components/QueryState` 实现，后台错误 Toast 加了同文案 4 秒去重。
- 退出登录放在 App 层 Provider；主动退出不记来处、被动过期记来处并在重新登录后回原页面。
- 课堂页在身份读取中 / 失败时凭本地课堂放行；写成功后自动重读失败的 me（改了 Plan 1 的 `queries/client.ts`，先写用例）。
- 新增「最新读取」两个 hooks，课前配置、URL 开课、编辑上课记录都等最新数据再建草稿；排班编辑器只要求详情未过期。
- 课堂建课所需读取失败时显示错误与重试，不再静默跳课前配置。
- 结束课堂以 localStorage 备份为冻结来源（刷新后重试也复用同一份 payload），课堂内容变了才重新冻结。
- cache-effects 新增「删批次时从缓存列表拿掉该项」；其余 Plan 1 规则与 hook 签名不变。
- `SessionsTable` / `Sessions` 提前到批次 C 迁移；为批次 F 之后发现的退出跳转问题单独加了一个修复提交。
- 新写维护文档 `kb/docs/web-data-layer.md` 并在 AGENTS.md 索引。

## 相关文档

- [任务简报](../plans/2026-10-07-web-query-migration-brief.md) — 本次执行依据
- [Plan 2：组件全量迁移](../plans/2026-10-06-web-query-component-migration.md) — 按此实施，已更新状态、清单与实施记录
- [Plan 1：请求与缓存基础层](../plans/2026-10-06-web-query-foundation.md) — 依赖的基础层
- [Plan 1 session](2026-10-06-web-query-foundation.md) — 测试 harness 的坑
- [Web 数据层](../docs/web-data-layer.md) — 本次新建
- [一节课的数据生命周期](../docs/classroom-session-lifecycle.md) — 课堂进入判定与提交契约的依据
- [业务口径](../docs/business-rules.md) — 收费不重算、学生姓名、归档等约束
- [验证手册](../docs/verification-guide.md) — 浏览器验证的拖拽与弹窗写法
