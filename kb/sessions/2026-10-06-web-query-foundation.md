---
created: 2026-10-06
tags:
  - web
  - tanstack-query
  - api
  - cache
  - testing
---

# Web 请求与缓存基础层（Plan 1）落地：领域 API、TanStack Query hooks、写后缓存规则与兼容桥

## 概要

老师在收银台列表与详情间往返时每次都从空状态重新请求（known issue「Web 页面往返重复加载」）。本次按 Plan 1 在分支 `web-query-foundation` 上建好可复用的请求与缓存层，供 Plan 2 迁移页面：把 `lib/api.ts` 的 47 个方法与 DTO 拆到 `web/src/api/<domain>.ts`，在 `web/src/queries/` 建立 key factories、16 个 queryOptions、47 个 `useXxxQuery` / `useXxxMutation`、按业务动作组织的写后缓存规则（cache-effects）、身份与会话代次保护，并把 `lib/api.ts` 改成旧签名不变、写入后跑同一套缓存规则的兼容桥；`main.tsx` 装上根 Provider。全程测试先行，web 测试共 468 个全部通过，tsc / build / server 测试通过，旧页面浏览器冒烟正常。页面还没接 hooks，所以用户可见的白屏问题要等 Plan 2。

## 修改的文件

- `web/src/api/*.ts` — 新增。`client.ts`：`request` / `get`、`ApiError`、`NetworkError`、`isAbortError`，读取支持 `signal`；其余 11 个领域文件放 API 函数与 DTO（从旧 `lib/api.ts` 原样搬迁，wire contract 不变）。
- `web/src/api/client.test.ts`、`contract.test.ts` — HTTP 行为回归；47 个函数逐一断言 method / URL / 原始 body，16 个读取断言 signal 透传，并校验导出数恰为 47。
- `web/src/queries/keys.ts` — 各领域 key factory。
- `web/src/queries/client.ts` — `createQueryClient()` 与应用实例：staleTime 30s / 字典类 5min、gcTime 30min、查询只对网络错误与 5xx 重试一次、写不重试；QueryCache/MutationCache 处理 401 会话过期、me 读到 null 时丢弃缓存、后台刷新失败通知注入点。
- `web/src/queries/session.ts` — 会话代次与 `switchSession` / `expireSession` / `dropSessionData`。
- `web/src/queries/mutation.ts` — `useAppMutation`（代次保护、hook 层 onSuccess 等待失效刷新）、`useSensitiveMutation` / `useResetWhenSettled`（密码类完成即清状态）。
- `web/src/queries/cache-effects.ts` — Plan 1 写后缓存矩阵的全部规则，含从缓存推断归属、删除实体移除缓存、写入前取消在途读取。
- `web/src/queries/{auth,teachers,tags,admin,classes,students,sessions,attendance,invites,schedules,billing,prev-lesson}.ts` — 领域 queryOptions 与 hooks；考勤 pending overlay 与同格防重；`usePrefetchBillingBatch`；`usePrevLessonQuery` 复用班级与 session 缓存。
- `web/src/queries/*.test.tsx` / `inventory.test.ts` — Query 基础行为、身份与代次、写后矩阵（两个班一份「全量缓存」逐条比对移除/失效/改写）、可观察结果、考勤并发与回滚、上节课依赖、清点。
- `web/src/test-utils/` — 新增假 fetch（路由表 + 支持 abort）、DTO fixtures、`renderWithClient`、`cacheUniverse`。
- `web/src/lib/api.ts` — 改写为兼容桥：类型 re-export，旧方法委托领域 API，写入后跑 cache-effects，旧 login/logout 走 `switchSession`。
- `web/src/lib/api.test.ts` — 新增：47 个旧方法 wire 不变、错误语义、与新 hook 缓存效果等价、代次保护。
- `web/src/main.tsx` — 路由外层装 `QueryClientProvider`。
- `web/package.json`、`pnpm-lock.yaml` — 加 `@tanstack/react-query`，开发依赖 `@testing-library/react`、`jsdom`。
- `AGENTS.md` — 结构里补 `api/`、`queries/`，注明 `lib/api.ts` 是兼容桥；新增「Web 请求层」约定。
- `kb/plans/2026-10-06-web-query-foundation.md` — 状态、清单打勾、「实施记录」（与计划的差异）。
- `kb/known-issues.md` — 往返白屏条目更新为 Plan 1 已实施、Plan 2 待做。

## 注意事项

- **测试 harness 的 tracked props 坑**：useQuery 默认只在「读过的字段」变化时重渲染。renderHook 测试里如果断言前从没读过 `data`，后台刷新不会触发重渲染，`result.current.data` 一直是旧值，看起来像缓存没更新。harness 里在渲染时读一次 `data`（与真实组件一致）。
- **观察者通知是异步批处理**：`await act(() => mutateAsync())` 之后 observer 的新数据不一定已渲染，断言用 `waitFor`。
- **写入完整详情前要先 `cancelQueries` 该 key**：写入前发出的 GET 晚到会把新数据覆盖成旧的。用例「a read issued before a write cannot overwrite…」先复现再修。
- **`Mutation.onSuccess` 抛错会让写操作变成失败**（TanStack 把它放在同一个 try 里），cache-effects 必须不抛；`invalidateQueries` 默认不抛，刷新失败不会误报保存失败。
- **`switchSession` 保留 me 查询对象原地更新**：`client.clear()` 不会通知已挂载观察者，用 `removeQueries` 排除 me 再 `setQueryData`，`useMeQuery` 才能立刻看到新身份。
- **考勤用 overlay 而非乐观写缓存**：缓存只放服务端确认值，失败自然只回滚那一格，整表重取也覆盖不了 pending 格；做了一次「去掉重启逻辑看用例是否失败」的反向验证。
- 浏览器冒烟用的是现有开发库，没有 reset；老师改名「陈晓（冒烟）」已改回，dev 库里没有收款批次，收费写入只由单测覆盖。

## 遗留问题

- 页面尚未接入 hooks，往返白屏的用户症状仍在，按 Plan 2 迁移（known-issues 条目保留）。
- 后台错误通知只留了注入点（`setBackgroundErrorHandler`），尚未接 Toast，归 Plan 2 批次 A。
- 分支未合并、未 push；合并时机由用户决定。Plan 2 分批上线时需单独验收新旧调用混合场景。

## 相关文档

- [Plan 1：Web API 与 TanStack Query 基础层](../plans/2026-10-06-web-query-foundation.md) — 本次按此实施并更新状态与实施记录
- [Plan 2：组件全量迁移](../plans/2026-10-06-web-query-component-migration.md) — 下一步，依赖本次交付
- [验证手册](../docs/verification-guide.md) — 浏览器冒烟依据
- [业务口径](../docs/business-rules.md) — 计费不重算、学生姓名 cnName 语义等约束的依据
