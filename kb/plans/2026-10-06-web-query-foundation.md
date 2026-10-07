---
created: 2026-10-06
tags:
  - plan
  - web
  - tanstack-query
  - api
---

# Plan 1：Web API 与 TanStack Query 基础层

状态：已实施（2026-10-06，分支 `web-query-foundation`，未合并、未部署）。实施与计划的差异见文末「实施记录」。

后续：[Plan 2：组件全量迁移](2026-10-06-web-query-component-migration.md)。两个 Plan 顺序执行；本次会话只写规划。

## 目标与已确认边界

老师在收银台列表与详情之间往返时，目前组件卸载会丢失响应，重新挂载后从空状态请求。建立可复用、可测试的请求与缓存层，供 Plan 2 消费。

用户已确认：

- 只改造 `web/`，不迁移小程序，不修改后端接口或数据库。
- HTTP 层继续使用现有 fetch 封装，不引入 Axios。
- 采用 `api/`、`queries/`、React 组件三层，按业务领域拆分。
- hooks 使用 `useXxxQuery`、`useXxxMutation` 命名。
- 不改课堂本地优先、提交兼容性、收费快照及其他业务口径。

本 Plan 交付完整 API 与 Query/Mutation 模块、缓存规则、测试和兼容出口。业务组件迁移归 Plan 2；Plan 1 完成并不意味着页面白屏问题已经解决。

实施前阅读 `AGENTS.md`、`kb/docs/business-rules.md`、`kb/docs/classroom-session-lifecycle.md`。收费历史 Plan 中有旧计费规则，以当前业务文档及代码为准。

## 现状与清点范围

调研基线：2026-10-06。

- `web/src/lib/api.ts` 集中定义 DTO、ApiError、fetch 包装和 47 个方法（16 个读取、31 个写入/动作）。
- 实际业务请求出现在 21 个文件：13 个页面、7 个组件文件及 App。初步文本扫描的 22 个结果中，`lib/prevLesson.ts` 只是注释命中，不是请求调用方。类型引用还涉及纯逻辑、测试、Storybook，不能只搜 fetch。
- 列表和详情通常使用 effect + state；写后通过 reload、onSaved 回调或 setState 更新。
- `me`、老师列表、班级详情在多个调用方重复请求；上节课参考有班级详情 → session 详情的依赖链。
- HTTP 包装保留 cookie、JSON、204 和 ApiError 行为，但尚无取消信号接口。
- 小程序已有独立 Taro.request、上传和 Bearer 登录层。此次不改它，不为了跨端共享提前抽 workspace SDK。
- `/api/health`、独立 `/api/sessions/:id/recap` 当前无 Web 业务调用，不创建未使用 hooks。资源图片、字体和 html-to-image 内部加载也不属于业务 Query 迁移。

## 文件结构与依赖方向

```text
web/src/
  api/
    client.ts
    auth.ts
    teachers.ts
    admin.ts
    classes.ts
    students.ts
    sessions.ts
    attendance.ts
    schedules.ts
    billing.ts
    tags.ts
    invites.ts
  queries/
    client.ts
    keys.ts
    cache-effects.ts
    auth.ts
    teachers.ts
    admin.ts
    classes.ts
    students.ts
    sessions.ts
    attendance.ts
    schedules.ts
    billing.ts
    tags.ts
    invites.ts
    prev-lesson.ts
  lib/api.ts                  # 仅在迁移期间存在的兼容出口
```

- `api/client.ts` 只负责 HTTP；领域 API 文件导出具名纯异步函数和领域 DTO。不依赖 React、QueryClient、Toast、路由。
- `queries/<domain>.ts` 定义 queryOptions、读取 hooks 和写入 hooks；组件不接触 URL、key 拼接、缓存关联刷新。
- `queries/keys.ts` 导出按领域命名的 key factories；不导入 hooks。跨领域失效统一使用这些 factories。
- `queries/cache-effects.ts` 放具名、可测试的写后缓存操作，按业务动作组织；由领域 Mutation 和迁移兼容层复用。不建立通用事件总线，也不每次全局失效。
- `queries/client.ts` 导出 `createQueryClient()` 和应用稳定实例；测试每例创建独立实例。Provider 放在根部，不随页面路由重建。
- DTO 从旧 lib/api 迁到所属 api 文件；跨领域引用用 `import type`。CommitPayload 等课堂契约归 sessions，收费 DTO 归 billing。避免巨型 types.ts 和重复定义。
- `lib/` 继续放纯派生逻辑及同名测试；网络与 React hooks 不放回 lib。

命名约定：

| 层 | 示例 |
|---|---|
| API 查询 | `listBillingBatches()`、`getBillingBatch(id, options?)` |
| API 写入 | `createBillingBatch(input)`、`confirmInvoice(id)` |
| Query options | `billingBatchesQueryOptions()`、`billingBatchQueryOptions(id)` |
| Query hook | `useBillingBatchesQuery()`、`useBillingBatchQuery(id)` |
| Mutation hook | `useConfirmInvoiceMutation()` |
| Key factory | `billingKeys.lists()`、`billingKeys.detail(id)` |

读取 API 接受可选 `{ signal?: AbortSignal }`；queryFn 将 Query 提供的 signal 传到底层。写入参数保持原 API 语义；hook variables 可额外携带 classId/batchId 等失效上下文，但不得把这些客户端字段发送给后端。

hooks 保留 TanStack Query 标准返回结构，不另造 loading/error 状态协议。允许明确需要的 enabled/select 等选项，不向组件开放覆盖 queryKey/queryFn 或覆盖核心 Mutation onSuccess 的入口。组件用 mutateAsync 的结果处理导航、Toast 和关闭弹窗；缓存维护始终由 hook 保证。

## HTTP client 改动

- 将 req/get 和 ApiError 移到 `api/client.ts`，保持 `credentials: 'include'`、JSON body、可读错误及 204 返回 undefined。
- 请求取消保持 AbortError 语义，不转成业务失败或弹 Toast。
- 不在 HTTP 层重试；重试策略只由 Query 层负责。
- 保留错误 status，区分 HTTP 错误、网络错误、取消请求；对非 JSON 错误响应提供稳定兜底信息。业务错误不在 API 函数内吞掉。
- client 不直接跳登录、不清 localStorage；身份处理归 queries/auth 与 App 集成。
- 先为现有 HTTP 契约和新增取消行为写测试，再修改实现。按仓库约定避免在低层增加 try/catch；现有解析兜底需要调整时，以明确的响应解析流程保持兼容。

## 完整方法映射

表内 API 名是新 `api/<domain>.ts` 导出名；hook 名以本表为准。URL、请求体和响应字段以当前 `web/src/lib/api.ts` 与服务端对应路由为基线，搬迁不改变 wire contract。

| 领域 | 旧 api 方法 | 新 API 函数 | 新 hook |
|---|---|---|---|
| auth | me | getMe | useMeQuery |
| auth | login | login | useLoginMutation |
| auth | logout | logout | useLogoutMutation |
| auth | verifyPassword | verifyPassword | useVerifyPasswordMutation |
| teachers | teachers | listTeachers | useTeachersQuery |
| teachers | updateTeacher | updateTeacher | useUpdateTeacherMutation |
| tags | orgTags | listTags | useTagsQuery |
| admin | adminClasses | listAdminClasses | useAdminClassesQuery |
| admin | adminCreateTeacher | createAdminTeacher | useCreateAdminTeacherMutation |
| admin | adminDeleteClass | deleteAdminClass | useDeleteAdminClassMutation |
| admin | adminResetPassword | resetAdminTeacherPassword | useResetAdminTeacherPasswordMutation |
| classes | classes | listClasses | useClassesQuery |
| classes | classDetail | getClass | useClassQuery |
| classes | createClass | createClass | useCreateClassMutation |
| classes | updateClassInfo | updateClass | useUpdateClassMutation |
| classes | saveGrouping | saveClassGrouping | useSaveClassGroupingMutation |
| classes | updateClassNotes | updateClassNotes | useUpdateClassNotesMutation |
| classes | updateHomeworkTemplate | updateHomeworkTemplate | useUpdateHomeworkTemplateMutation |
| students | addStudent | createStudent | useCreateStudentMutation |
| students | updateStudent | updateStudent | useUpdateStudentMutation |
| students | deleteStudent | deleteStudent | useDeleteStudentMutation |
| students | setStudentStatus | updateStudentStatus | useUpdateStudentStatusMutation |
| students | getStudentProfile | getStudentProfile | useStudentProfileQuery |
| sessions | listSessions | listSessions | useSessionsQuery |
| sessions | sessionDetail | getSession | useSessionQuery |
| sessions | deleteSession | deleteSession | useDeleteSessionMutation |
| sessions | updateSessionInfo | updateSession | useUpdateSessionMutation |
| sessions | saveSessionHomework | updateSessionHomework | useUpdateSessionHomeworkMutation |
| sessions | commitSession | commitSession | useCommitSessionMutation |
| sessions | overwriteSession | overwriteSession | useOverwriteSessionMutation |
| attendance | classAttendance | getClassAttendance | useClassAttendanceQuery |
| attendance | updateAttendance | updateAttendance | useUpdateAttendanceMutation |
| invites | getJoinRequests | listJoinRequests | useJoinRequestsQuery |
| schedules | listSchedules | listSchedules | useSchedulesQuery |
| schedules | scheduleDetail | getSchedule | useScheduleQuery |
| schedules | createSchedule | createSchedule | useCreateScheduleMutation |
| schedules | updateSchedule | updateSchedule | useUpdateScheduleMutation |
| schedules | deleteSchedule | deleteSchedule | useDeleteScheduleMutation |
| billing | listBillingBatches | listBillingBatches | useBillingBatchesQuery |
| billing | billingBatchDetail | getBillingBatch | useBillingBatchQuery |
| billing | createBillingBatch | createBillingBatch | useCreateBillingBatchMutation |
| billing | recalculateBillingBatch | recalculateBillingBatch | useRecalculateBillingBatchMutation |
| billing | deleteBillingBatch | deleteBillingBatch | useDeleteBillingBatchMutation |
| billing | updateInvoice | updateInvoice | useUpdateInvoiceMutation |
| billing | confirmInvoice | confirmInvoice | useConfirmInvoiceMutation |
| billing | unconfirmInvoice | unconfirmInvoice | useUnconfirmInvoiceMutation |
| billing | invoiceLessons | getInvoiceLessons | useInvoiceLessonsQuery |

读取场景的 options 和 key：

| Hook | key 结构（由 factory 返回） | 条件与调用方 |
|---|---|---|
| useMeQuery | `['auth', 'me']` | App、Setup、Classroom，共享身份读取 |
| useTeachersQuery | `['teachers', 'list']` | Teachers、Admin、老师选择、课堂信息 |
| useTagsQuery | `['tags', 'list']` | Classroom；失败不阻断本地课堂 |
| useAdminClassesQuery | `['admin', 'classes']` | 已登录且有管理员权限 |
| useClassesQuery | `['classes', 'list']` | 班级列表、课堂列表筛选、收费创建弹窗 |
| useClassQuery | `['classes', 'detail', classId]` | 班级详情、课前配置、课堂资料、上节课 |
| useStudentProfileQuery | `['students', 'profile', studentId]` | 学生成长档案 |
| useSessionsQuery | `['sessions', 'list']` | 全机构课堂列表 |
| useSessionQuery | `['sessions', 'detail', sessionId]` | 课堂详情、编辑历史课堂、上节课参考 |
| useClassAttendanceQuery | `['attendance', 'class', classId]` | 考勤表 |
| useJoinRequestsQuery | `['invites', 'requests', classId]` | 班级邀请 tab |
| useSchedulesQuery | `['schedules', 'list', classId]` | 排班 tab、收费创建弹窗 |
| useScheduleQuery | `['schedules', 'detail', scheduleId]` | 打开编辑周期时 |
| useBillingBatchesQuery | `['billing', 'list']` | 收银台 |
| useBillingBatchQuery | `['billing', 'detail', batchId]` | 收款项详情、详情预取 |
| useInvoiceLessonsQuery | `['billing', 'invoice-lessons', invoiceId]` | 费用编辑弹窗打开时 |

缺失 ID 时禁用 query，不能请求空字符串路径。弹窗请求用 open + 必要 ID 控制。现有归档过滤和收银台 all/pending/settled 都是客户端筛选，不人为拆成多个相同 API 的缓存；未来新增服务端过滤参数时再纳入 key。

`queries/prev-lesson.ts` 提供 `usePrevLessonQuery(classId)`：复用班级和 session 两个查询，按班级响应派生上一节 ID，以 enabled 管理依赖；不另存一份重复的服务器数据。并行可读的 me、teachers、tags 不串联成瀑布。

## 缓存、身份与错误策略

| 策略 | 初始取值 |
|---|---|
| 普通业务查询 staleTime | 30 秒 |
| teachers / tags staleTime | 5 分钟 |
| me / 管理员列表 / 加入申请 staleTime | 30 秒；me 不采用永久静态缓存 |
| gcTime | 30 分钟，无订阅后计时 |
| refetchOnMount / WindowFocus / Reconnect | 保留过期后后台刷新，不使用 always |
| query retry | 网络错误或 5xx 至多重试 1 次；4xx 和取消不重试 |
| mutation retry | false；不做离线排队和自动重放 |
| 持久化 | 不持久化 Query 缓存，不引入跨标签实时广播 |

staleTime 到期只表示允许刷新，不是定时请求。聚焦/重连和手动刷新用于发现其他老师、小程序造成的变化，不承诺多端实时一致。时间敏感的收费展示沿用短时效，并提供非阻塞手动刷新。

身份设计：应用只保有一个稳定 QueryClient；认证状态来自 me query 和认证流程，不再维护第二份长期 me state。登录成功先隔离旧会话、取消旧查询并清缓存，再用登录响应写入 me；退出和已认证业务请求的 401 同样停止受保护查询、取消并清空缓存。需要一个递增会话代次，旧请求或 Mutation 完成回调不得向新会话写缓存。密码错误导致的登录 401、权限 403 不走“当前会话过期”处理；网络错误/5xx 不当作退出。

身份变化不删除 `nce.classroom.*` 和提交备份。课堂遇到会话失效保留本地数据并提示重新登录，不能由全局刷新销毁草稿。敏感登录/密码 Mutation 完成后 reset，避免密码长期滞留 Mutation 状态；不持久化这些 variables。

错误 UI 在 Plan 2 实现：首次读取失败显示重试；已有缓存刷新失败保留内容并提示；取消不提示。QueryCache 可统一发出一次后台错误通知，通过注入处理器接 Toast，避免每个 observer 重复弹。HTTP/API 层不发 Toast。写入已成功但随后 refetch 失败，不能把整个动作报成保存失败；缓存失效调用不使用 throwOnError 把读失败升级成写失败。

## 写后缓存规则（必须实现并测试）

“失效”指标记相关缓存过期，活跃查询后台重取；无需为了所有未挂载页面立即发请求。优先将完整、同形状的响应写入精确详情，再失效派生查询；不得把 StudentBasic、CommitResult、列表摘要冒充完整详情。

| 动作 | 响应回写与失效范围 |
|---|---|
| 创建/编辑班级 | 完整 ClassDetail 写详情；班级列表、admin 班级列表；编辑名称/老师等还影响 sessions、学生档案、billing 的班级展示 |
| 默认分组保存 | ClassDetail 写详情；相关学生档案、班级列表中的派生信息 |
| 班级资源修改 | ClassDetail 写详情；其他读取同一详情的 observer 自动更新 |
| 作业模板修改 | ClassDetail 写详情；相关 session 详情（含模板和上次作业引用） |
| 新增学生 | 班级详情/列表、考勤、admin 班级列表；已有费用快照不自动建单 |
| 修改学生姓名 | 班级详情/列表、该生档案、sessions 详情及嵌入 recap、班级 lastRecap、考勤、billing 列表/详情 |
| 学生状态修改 | 班级详情/列表（含分组）、档案、考勤、billing 详情、admin 班级列表；不自动重算金额 |
| 删除学生 | 删除该生 profile 缓存；失效班级、sessions、考勤、billing、admin 统计，因收款单也被删除 |
| 创建/覆盖/删除课堂 | sessions 列表/详情、班级详情/列表、学生档案、考勤、billing 列表/详情及 invoice-lessons、admin 统计；首次提交额外刷新 tags；覆盖同样可能新增 tags，必须刷新 |
| 修改课堂信息 | SessionDetail 写详情；sessions 列表、班级详情/列表、档案、考勤、billing 列表/详情和出勤明细（时间变化影响周期归属） |
| 修改课堂作业 | SessionDetail 写详情；sessions 列表、班级详情、其他 session 的 prevHomework 引用、上节课依赖 |
| 更正考勤/补课 | 精确考勤格回写；对应 session、班级摘要、学生档案、invoice-lessons；按当前读侧依赖刷新 billing 展示，但绝不重算快照 |
| 创建/编辑/删除排班 | 回写/删除精确 schedule 详情；该班 schedules、billing 列表/详情、invoice-lessons、admin 统计 |
| 创建批次 | 完整批次详情回写；billing 列表、schedules 列表/详情的占用信息、admin 统计 |
| 重算批次 | 完整批次详情回写；billing 列表、invoice-lessons、admin 统计 |
| 删除批次 | 清除详情和受影响 invoice-lessons；billing 列表、排班占用信息、admin 统计 |
| 修改费用/确认/撤销收款 | InvoiceItem 可回写已存在详情中的对应行，但汇总不得手工猜算；失效批次详情、billing 列表、admin 收款统计 |
| 老师改名 | teachers、me（若为本人）、班级列表/详情、sessions 列表/详情、billing 详情（收款人）、admin 列表 |
| 管理员创建老师 | teachers；不改现有用户权限 |
| 管理员删除班级 | 清除该班实体详情及关联缓存；失效班级、sessions、学生档案、考勤、schedules、billing、invites、admin。无法可靠判定所属班级的缓存清除该领域，不保留已删除实体 |
| 管理员改密 / 密码复核 | 不伪造数据更新；不假设服务端注销已有会话；完成后清理敏感 Mutation 状态 |

优先使用 action variables 中的 classId/batchId/sessionId 缩小范围；这些不是后端新增参数。缓存缺少关联信息时，可对受影响领域前缀保守失效，不为寻找归属新增请求，也不漏掉非活跃缓存。ID 仅存在于详情时，删除前采集缓存内的相关 ID。对真正删除的实体取消请求并移除缓存，防止旧响应复活。

考勤保留即时反馈：同一 sessionId + studentId 的未完成写操作禁止重复提交，其他格可并行；失败只回滚该格本次操作，不恢复整张表。撤销对应格 pending 时禁用。快照刷新不得覆盖其他 pending 格；用最小 pending overlay 或延迟该表刷新保证一致性。收费操作采用成功后更新，不乐观显示已到账。

## Plan 1 与 Plan 2 的过渡

1. 领域 API 搬迁后，`lib/api.ts` 暂时保持旧方法签名和类型 re-export，旧组件无需同时修改。
2. 兼容出口的写方法委托新 API，并调用与新 hooks 相同的 cache-effects；新 hooks 直接调用领域 API，避免双重失效。
3. 兼容桥只存在于 lib/api，不让纯 api 层依赖 Query。Plan 2 迁移过程中，旧组件写入也能使新页面缓存失效。
4. 兼容桥维护旧返回值和错误语义，测试旧调用和新 hook 的等价缓存效果。认证旧调用在 Plan 2 身份迁移前仍可运行；身份流程先整体迁移，不混用两套登录状态。
5. Plan 1 可在 main.tsx 装 Provider；根 QueryClient 不改变现有页面数据源。Plan 2 最终删除兼容桥和旧出口。

## 测试先行与实施步骤

按 BDD/TDD 先写行为测试，再拆实现；测试目录放在 api/queries 对应模块旁。新增测试依赖用 pnpm add，优先沿用 Vitest；需要 hook DOM harness 时加 Testing Library 与 jsdom，不引入额外状态框架。

- [x] 先建立 HTTP 回归用例：cookie、JSON、204、错误 status/message、非 JSON 错误、取消、缺省字段与空值区别。
- [x] 拆分 47 个 API 和 DTO，建立旧出口；检查 URL、HTTP method、payload 与响应不变，重点 commit、cnName、金额分、可选 recalculate body。
- [x] 写 Query 行为用例后实现 keys、options、client、Provider：相同 key 并发去重，fresh 重挂载不请求，stale 后台刷新保留数据，gc 后才冷加载，不同 ID 隔离，取消透传。
- [x] 写完整失效矩阵用例后实现 Mutation 与 cache-effects，验证精确响应回写、跨领域失效、删除清理及兼容桥；断言用户可观察的数据变化，不只 mock invalidateQueries 调用次数。
- [x] 完成 auth hooks 与会话代次保护测试：401/403/网络错误分流、账号切换、晚到查询/Mutation 不污染新会话。
- [x] 完成按需查询、上节课依赖查询、考勤并发/回滚测试；不存在上节课时不请求空 ID。
- [x] 测试写成功读刷新失败仍为成功；敏感 variables 清理；后台查询不覆盖本地课堂或编辑草稿的集成约束由 Plan 2 补充。
- [x] 运行 Web 测试、类型检查、生产 build；用现有页面做兼容冒烟。Provider/旧桥改变运行行为，仍按 verification-guide 做浏览器验证。
- [x] 文档记录交付与未迁移范围，提交代码，不 push/部署。

验证命令：`pnpm --filter web test`、`pnpm --filter web exec tsc --noEmit`、`pnpm --filter web build`。禁止主动运行 formatter/linter。测试截图存 `tmp/<实际日期>-web-query-foundation/`；结束后 `mac-dev-cleanup --only browser --min-age 2`。

验收：47 个旧方法均有新 API 与 hook，16 个读取均有可复用 options；旧页面仍可运行；基础缓存和 Mutation 规则有行为测试；未修改 miniapp、服务端或课堂提交契约。已知“往返白屏”保留到 Plan 2 验收成功再关闭。

## 实施记录

按本计划落地，以下是与正文不同或正文未写到的决定，Plan 2 以代码为准：

- **多出的两个文件**：`queries/session.ts`（会话代次、`switchSession` / `expireSession` / `dropSessionData`）与 `queries/mutation.ts`（`useAppMutation` 统一代次保护与 hook 层 onSuccess；`useSensitiveMutation` 完成即 reset、gcTime 0）。`test-utils/` 放假 fetch、fixtures、渲染 harness 和写后矩阵用的「全量缓存」。
- **Mutation variables 形状**：一律单对象，后端参数放 `input` / `payload` 等原样字段，`classId` / `batchId` 等失效上下文是同级可选字段，从不进请求体。例：`useUpdateClassMutation().mutateAsync({ classId, input })`。
- **key 命名**：列表统一 `xxxKeys.lists()`（为日后服务端筛选参数预留前缀），带参数的列表另有 `list(id)`；老师列表是 `teacherKeys.lists()`。
- **身份**：`useMeQuery` 的 data 为 `null` 表示未登录（/api/me 401 映射），`undefined + error` 才是读取失败。me 后台刷新读到 null（别处退出 / cookie 过期）时，QueryCache 也会丢弃其余服务端缓存。登录 Mutation 以 `meta.loginFlow` 排除在「401 = 会话过期」之外；写操作 401 只有发起时仍是当前会话才判定过期。
- **考勤**：没有做乐观写缓存，而是 pending overlay——缓存只放服务端确认的记录，`useClassAttendanceQuery` 用 select 叠加进行中的修改；失败时 overlay 自然消失，只回到这一格的服务端值。同格占用用每个 QueryClient 一份的集合在 onMutate 判定，重复提交抛 `AttendanceCellBusyError`；`usePendingAttendanceCells` 供撤销/格子禁用。写入完成时若该表正有请求在途，重启它，防写入前的旧快照覆盖本格。
- **写入完整详情前先取消该 key 的在途读取**（cache-effects 的 `put`），否则写入前发出的 GET 晚到会把新数据覆盖成旧的；本人改名同理失效 me。
- **HTTP 层**：断网等传输失败包装为 `NetworkError`（固定中文文案，cause 保留原错误）；非 JSON / 坏 JSON / 缺 `error` 字段的错误响应兜底为「请求失败（HTTP <status>）」。取消保持原生 AbortError。
- **后台错误通知**：`setBackgroundErrorHandler(client, handler)` 注入；只对已有数据的查询刷新失败触发，401 走会话过期，不通知。Plan 2 接 Toast。
- **兼容桥**：`lib/api.ts` 旧方法名、签名、返回值不变；写入成功后跑与 hook 相同的 cache-effects（缺 classId 时从缓存推断，推断不出按领域前缀失效）；旧 `login` / `logout` 也走 `switchSession`。`main.tsx` 已在路由外装 `QueryClientProvider`，页面仍未使用 hooks。
- **验证**：web 468 个测试（新增 api 契约、Query 行为、身份/代次、写后矩阵、考勤、上节课、兼容桥、清点）、tsc、build、server 292 个测试通过；浏览器冒烟走旧页面登录 → 班级 / 收银台（含创建弹窗）/ 老师改名并改回 / 上课记录 / 考勤 / 课前配置 / 管理 → 退出 → 重新登录，无页面错误。截图 `tmp/2026-10-06-web-query-foundation/`。

## 参考

- [官方 Query Options](https://tanstack.com/query/latest/docs/framework/react/guides/query-options)
- [官方 Important Defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [官方 Invalidations from Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations)
- `kb/known-issues.md`：Web 页面往返重复加载、内容短暂空白。
