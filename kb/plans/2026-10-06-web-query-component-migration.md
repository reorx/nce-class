---
created: 2026-10-06
tags:
  - plan
  - web
  - tanstack-query
  - migration
---

# Plan 2：Web 组件全量迁移到 Query / Mutation

状态：已实施（2026-10-07，分支 `web-query-foundation`，未合并、未部署）。前置：[Plan 1：请求与缓存基础层](2026-10-06-web-query-foundation.md)。与正文不同或正文未写到的决定见文末「实施记录」，维护口径见 `kb/docs/web-data-layer.md`。

## 目标与约束

将所有 Web 业务 API 调用迁到 Plan 1 的领域 hooks：页面往返复用缓存，写后相关页面一致更新，首次加载、空数据、错误和后台刷新有不同表现。只迁 Web，保留 fetch；不修改 miniapp、服务端、收费规则或课堂提交 schema。

不以“消灭所有 useEffect/useState”为目标。课堂 localStorage、表单草稿、计时、弹窗、滚动和浏览器事件仍需本地状态及 effect。要删除的是自行维护服务器响应、请求生命周期和写后 reload 的重复机制。

实施前阅读：`AGENTS.md`、`kb/docs/business-rules.md`、`kb/docs/classroom-session-lifecycle.md`、`kb/docs/verification-guide.md`。UI 迁移不扩大为视觉重设计，也不更换路由框架。

## 组件调用规则

- React 组件导入 `queries/<domain>` 的 hooks；DTO 用 `import type` 从 `api/<domain>` 导入。
- 不直接调用领域 API、不拼 URL、不自行拼 queryKey；预取通过领域导出的 `usePrefetchBillingBatch()` 等明确辅助 hook 复用 options。
- query.data 是服务器响应的来源，不再 `.then(setData)` 复制整份响应。页面派生使用纯函数/select/useMemo。
- 表单在“开始一次编辑”时从响应建立 draft，后续后台刷新不覆盖 dirty draft；切实体或重新打开编辑才按规则初始化。
- 组件通过 mutation.isPending 控制按钮，通过 mutateAsync 处理 Toast、关闭、导航。缓存操作保留在领域 hook 的生命周期，不能因组件提前卸载而丢失。
- 取消查询不弹错误；写成功而后台读失败分别呈现；不要在 catch 中统一误报“保存失败”。
- 同一 key 同一会话共享查询；并行请求不人为串行。依赖查询用 enabled，弹窗关闭后不继续启动新的按需请求。

## 页面状态统一

| 情况 | 呈现 |
|---|---|
| 无数据且首次请求进行中 | 页面框架及对应区域骨架/加载文案；不把 undefined 当空列表 |
| 首次请求失败且无数据 | 明确错误、重试按钮；404 为不存在、403 为无权限 |
| 成功返回空集合 | 业务空态，例如尚无收款项 |
| 有缓存且正在后台请求 | 保留列表/详情，必要时显示轻量刷新状态 |
| 有缓存但后台请求失败 | 保留内容，说明刷新失败并允许重试 |
| 切换到不同实体 ID | 使用目标实体自己的缓存或骨架，不能显示上一位学生/上一批次数据 |
| Mutation pending | 禁止同一操作重复提交；不同无关操作不必锁死整页 |

优先按有无 data 决定内容是否可展示；不能用 isFetching 作为整页白屏条件。enabled=false 的 query 不应显示永久加载；条件未满足时显示选择提示。缓存过期仍展示已有数据，必要操作继续由服务端校验。

## 逐文件迁移清单

下表覆盖业务调用方；嵌套在页面内的组件与弹窗也必须迁移。具体 hook 签名见 Plan 1 的 47 行映射。

| 文件 | Query / Mutation 接入 | 删除或保留的机制 |
|---|---|---|
| `App.tsx` | useMeQuery；消费 auth 会话流程 | 删除手动 me 请求及重复长期 me/status 状态；保留路由 guard，区分未登录与读取失败 |
| `components/TopBar.tsx` | useLogoutMutation | 退出清缓存后跳转；不依赖整页刷新清理状态，不吞掉退出失败 |
| `pages/Login.tsx` | useLoginMutation | 登录响应由 auth hook 写 me；移除 App onLogin(setMe) 回写链；失败留在表单 |
| `pages/Billing.tsx` | useBillingBatchesQuery；详情预取 | 删除 batches state/reload/effect；保留筛选和创建弹窗状态 |
| `pages/BillingBatch.tsx` | useBillingBatchQuery、useInvoiceLessonsQuery；确认、撤销、改费用、删除 mutations | 删除 d/rows 响应副本和 reload；InvoiceEditModal 草稿保留；按行显示 pending |
| `components/BillingBatchModal.tsx` | useClassesQuery、useSchedulesQuery；创建/重算 mutations | open/reset 控制读取；删除 classes/schedules 请求状态与取消标志；保留选班、周期、条款 draft |
| `components/ScheduleTab.tsx` | useSchedulesQuery、useScheduleQuery；创建/编辑/删除 mutations | 编辑 ID 决定详情查询；详情到达后一次性初始化编辑器，不在点击 handler 直接 await API |
| `pages/ClassList.tsx` | useClassesQuery、useCreateClassMutation | 删除列表响应 state；归档筛选继续纯派生 |
| `pages/ClassDetail.tsx` | useClassQuery、useJoinRequestsQuery；班级信息、资源、模板、分组、学生增删与状态 mutations | 删除主 reload 与跨 tab 刷新回调；保留资源草稿、分组拖拽草稿、tab 状态和弹窗 |
| `components/ClassInfoModal.tsx` | useTeachersQuery | open 时读取共享老师列表；保留校验和表单 draft；提交由调用方领域 Mutation 处理 |
| `components/StudentEditModal.tsx` | useUpdateStudentMutation | Provider 保留；移除“调用方必须传 reload”契约，回调仅作交互通知；传入必要 classId 供失效，不传后端 |
| `pages/StudentProfile.tsx` | useStudentProfileQuery | 删除详情请求 state；改名后共享失效更新 |
| `pages/Teachers.tsx` | useTeachersQuery、useUpdateTeacherMutation | 删除老师列表 state/reload；编辑姓名 draft 保留 |
| `pages/Sessions.tsx` | useSessionsQuery、useClassesQuery | 独立查询并行；筛选从响应派生 |
| `components/SessionsTable.tsx` | useDeleteSessionMutation | 删除手动刷新回调，保留删除确认；覆盖班级页和全局列表两个入口 |
| `pages/SessionDetail.tsx` | useSessionQuery、useTeachersQuery；课堂信息/作业/模板 mutations | 删除 d state 和 onSaved(fresh) 回写链；保留各表单草稿和 tab |
| `pages/ClassAttendance.tsx` | useClassAttendanceQuery、useUpdateAttendanceMutation | 删除服务器 records 的独立长期副本；保留 UI hover、弹层、撤销栈及必要 pending overlay |
| `pages/Setup.tsx` | useClassQuery、useMeQuery、useTeachersQuery | 保留本地课堂优先检查、课前配置 draft 和新建本地 session；移除三个独立请求 |
| `pages/Classroom.tsx` | 班级/session 读取、me、teachers、tags；提交、覆盖提交、密码复核、资源修改 mutations | 保留课堂 reducer/localStorage/计时/冲突拦截/备份；移除请求型 effect，包括嵌套班级资源组件 |
| `components/PrevLessonContent.tsx` | usePrevLessonQuery | 删除 usePrevLessonData 的独立请求实现；展示差异留给各调用方 |
| `pages/Admin.tsx` | useAdminClassesQuery、useTeachersQuery；创建老师、删除班级、改密 mutations | 管理员权限控制 enabled；删除 reload；保留危险操作复核和弹窗 draft |

补充清理范围：`lib/*`、测试、`RecapCard*`、`RecapPanel`、`OverviewTab`、Storybook 中对旧 lib/api 的类型引用全部迁到领域 DTO。它们不因为引用类型就新增 Query。根 `main.tsx` 使用 Plan 1 稳定 Provider；Storybook/组件测试中真正消费 hooks 的故事或 harness 要独立包 Provider，不能共享生产缓存。

## 实施批次

### A. 身份入口与共享状态

- [x] 一起迁 App、Login、TopBar，确保应用中只有一套身份状态。
- [x] 使用 me query 返回的数据，允许既有 me props 作为同一来源的传递，避免为“全用 hooks”而无意义重写展示组件。
- [x] 401 清理服务端缓存但保留本地课堂；403 不登出；网络失败显示重试。
- [x] 登录/退出期间卸载受保护观察者，旧会话晚到回调不能写入新会话。退出 HTTP 失败要显示失败，不假装服务端 cookie 已清理。
- [x] Query 后台错误通知与 Toast 接通，同一失败不因多个 observer 弹多次。

### B. 收银台与排班，先解决用户反馈

- [x] 列表、详情、费用编辑、创建/重算、排班编辑一起接 hooks。
- [x] 新建/重算返回完整 BillingBatchDetail，可由 Mutation 写入详情缓存；创建后导航详情不再冷请求等待。
- [x] 列表卡片 pointer enter / focus 预取完整详情，复用领域 options 和 staleTime；不要预取整个机构所有批次。
- [x] 首次无缓存显示加载区域；返回仍在 gcTime 内的列表立即展示；过期时后台刷新。
- [x] 确认/撤销/改费用后刷新详情与列表汇总；返回列表不能停留在旧金额。写后失效与更新失败要有不同提示。
- [x] 创建弹窗保留归档班过滤、再次打开时的选班修复及选班切换取消旧请求；避免旧班级晚到结果覆盖新班级周期列表。
- [x] 收银台 all/pending/settled 等既有筛选逻辑保持不变，不将纯客户端筛选拼入 API key。本轮不额外改造筛选状态的持久化方式。
- [x] 首次访问不承诺零等待；验收分别衡量缓存命中和冷启动。

### C. 班级、学生、老师及全局编辑

- [x] 接入共享 classes/teachers 查询，多个弹窗同时使用不重复发同一请求。
- [x] StudentModal 的失效责任迁入 Mutation，清理各入口 reload 回调；确认中文名 key 缺省/清空语义保持。
- [x] 班级资源、作业模板、默认分组保持 draft；后台刷新不能重置输入或拖拽结果。
- [x] 学生状态变化继续清理默认分组等既有服务端行为，关联缓存反映最新结果。
- [x] 修改老师名后当前用户和所有显示老师名的页面更新。

### D. 上课记录与考勤

- [x] 迁移 SessionDetail 内所有嵌套表单；修改作业后上节课参考及 prevHomework 依赖更新。
- [x] 考勤保留即时反馈和撤销；沿用 Plan 1 的同格 pending 锁及局部回滚，其他格可并行。
- [x] 仅成功写入进入可撤销历史，pending 时禁用相关撤销；撤销本身也走 Mutation，失败保留可重试记录。
- [x] Query 重取不能覆盖尚未完成的其他格修改；失败不回滚整张表，不误删无关撤销记录。
- [x] 更正出勤后 session/成长档案更新；不自动修改已有收费快照，不触发 recalculate。

### E. 课前配置与课堂（高风险，最后迁移核心流程）

- [x] 先保留进入判定：本地课堂恢复 → 编辑冲突 → edit_id → URL 直接开课 → setup。
- [x] 本地恢复不等待服务器成功；me/老师/奖章失败不阻断已有课堂。
- [x] 需要服务器数据初始化的分支使用对应 hooks + enabled；一个本地课堂只初始化一次。背景 refetch、StrictMode 重挂载或对象引用变化不能生成新 clientSessionId、重置分数或重写草稿。
- [x] 建立本地 session 前再次检查存储/初始化标记与当前路由实体，防止请求晚到覆盖刚恢复的课堂；edit_id 校验 detail.classId 仍保留。
- [x] 编辑历史课堂在初始化前校验最新记录，避免将 stale 缓存直接固化为编辑底稿；已有本地编辑草稿则始终优先恢复。开新课前需要最新名单时明确等待这一读取，不能以避免加载为由使用错误名单。
- [x] 上节课参考从独立 usePrevLessonData 切到共享依赖查询；没有上一节是正常空态。
- [x] 结束课堂先冻结本次 payload/endedAt 并写备份，再 Mutation；请求失败保留课堂、备份和幂等键。重试使用该次备份 payload，不额外改变时间或 clientSessionId。
- [x] 仅服务端确认成功后清本地课堂及本次备份；随后刷新失败不把已成功提交报为失败。CommitResult 不是 SessionDetail，导航页需完整读取或预取，不能强转填充。
- [x] 覆盖历史课堂不回写默认分组、不改原作业，保留考勤更正；这些后端契约继续受现有测试保护。
- [x] 保留课堂资源编辑、密码复核放弃课堂、补录、作业草稿、奖章及计时功能。

### F. 管理员、类型迁移与收尾

- [x] 迁移管理员所有读取和写入，删班后的缓存不得显示残留实体；失效范围包括排班、收款和学生历史。
- [x] 清理所有旧类型 import、测试 fixture 和故事；禁止新增运行时 API 依赖回到 lib。
- [x] 确认全部业务调用方已迁移后删除 `lib/api.ts` 兼容桥；领域 hooks 继续复用 cache-effects。
- [x] 全局搜索 fetch、api.、旧路径和 effect 请求，人工区分业务网络、类型、注释、资源加载，形成零遗漏清单。
- [x] 更新 AGENTS.md 的请求层约定与目录描述，移除 api 位于 lib 的过时描述；必要时写面向维护者的数据缓存文档并索引。不要在实施前把计划写成已实现事实。

批次执行期间保留 Plan 1 兼容桥，使尚未迁移组件的写入也能失效新缓存。每个可提交批次先完成对应测试；全部完成才关闭用户反馈问题。若分批上线，必须单独验收混合调用场景；本 Plan 本身不授权 push/部署。

## 先写的行为测试

以下逻辑用例先于对应改动，采用受控响应/延迟和可计数请求的测试 transport。沿用 Plan 1 Vitest harness；必要时用 Testing Library 驱动真实页面组件。避免只 mock hook 返回值而无法发现缓存失效问题。

| 编号 | Given / When / Then |
|---|---|
| B01 | 列表已成功加载；进入详情后在 30 秒内返回；列表首帧显示已有数据，列表 GET 不增加 |
| B02 | 缓存已过 staleTime 但未过 gcTime；返回列表并延迟响应；保留已有行，后台刷新后替换，不展示业务空态 |
| B03 | 首次读取分别返回空集合、500、404；分别出现空态、可重试错误、不存在提示，不永久加载 |
| B04 | 详情确认收款成功；返回列表；人数、已收/待收金额最终与服务端一致，没有重复确认请求 |
| B05 | Mutation 成功、随后详情 GET 失败；显示保存成功及刷新失败，保留内容，用户无需重新提交写入 |
| B06 | 创建/重算返回完整详情；打开详情；立即读到回写数据，没有用列表摘要冒充 invoices |
| B07 | 弹窗选班 A 后迅速选 B，A 晚返回；只显示 B 的周期，不覆盖 B 的选择 |
| B08 | 改学生英文/中文名；查看已缓存的班级、档案、历史课堂及收费；展示统一更新，缺省中文名不被清空 |
| B09 | 表单已编辑，query 后台刷新；未保存的班级资源、作业、收费条款和分组草稿不被覆盖 |
| B10 | 登录 A 发出慢查询/写操作后退出并登录 B；旧回调晚到；B 不显示 A 数据，本地课堂备份保留 |
| B11 | 身份查询网络失败或业务 403；不误判退出；已认证 401 才进入重新登录流程 |
| B12 | 两个考勤格并行修改，其中一格失败；只回滚失败格，另一个保留；同格 pending 不重复提交 |
| B13 | 成功考勤修改后撤销，撤销失败再重试；历史栈对应正确，后台刷新不覆盖其他 pending 格 |
| B14 | 本地已有课堂，服务器离线；进入/刷新仍恢复原事件流、计时和草稿；背景刷新不重新初始化 |
| B15 | edit_id 与已有本地课堂冲突；仍拦截；无草稿编辑路径读取新记录后只初始化一次 |
| B16 | 结束课堂网络失败后重试；备份和 payload/幂等键不变；成功只形成一个 session，读刷新失败不再次提交 |
| B17 | 学生/课堂/批次/管理员删班成功；已缓存相关详情清除或显示不存在，旧 GET 不复活实体 |
| B18 | 改排班/考勤；相关展示更新；网络记录中没有自动 recalculate 请求，收费快照不被改动 |
| B19 | 两个组件读取同一老师列表/班级详情；共享请求；关闭弹窗再开且数据 fresh 时不重复加载 |
| B20 | 同一次 query 失败有多个 observer；后台错误通知只显示一次，取消不提示失败 |

课堂既有纯逻辑、兼容性测试继续跑；如果只改前端，不新增服务端业务接口测试，但须运行现有 server 测试保护提交行为。

## 浏览器验收与完成标准

先读 verification-guide；使用 agent-browser 技能按真实交互验收。不要重置用户当前数据库或误杀 5173/5177 的邻近项目进程；使用可识别测试数据及可用端口。

- [x] 收银台冷启动 → 详情 → 返回：分别记录首次请求、fresh 返回和 stale 后台刷新；同时观察 DOM 与网络，不能用截图独自证明“没有请求”。
- [x] 延迟读取时保留列表；失败时可重试；创建、重算、修改费用、确认、撤销、删除后跨页金额一致。
- [x] 创建弹窗切班、归档班不可新建周期/收款项，已有记录仍可维护。
- [x] 学生改名/状态、班级资源、默认分组、老师改名、邀请 tab、成长档案真实回归。
- [x] 上课记录改作业/信息、考勤修改与撤销；两个入口删除课堂后汇总一致。
- [x] 开课、恢复、断网本地继续、补录、编辑历史课堂、冲突拦截、失败重试、成功跳详情及草稿保留。
- [x] 登录退出、重新登录、管理员创建老师/改密/删测试班级；只操作测试数据。
- [x] 测试、Web tsc、Web build、现有 server 测试通过；不运行 formatter/linter。
- [x] 静态扫描无组件直接业务 API 调用、无旧 lib/api 引用；预取也经领域 Query 封装。
- [x] 截图、必要网络证据归档 `tmp/<实际日期>-web-query-migration/`，报告路径；`mac-dev-cleanup --only browser --min-age 2` 释放本次测试资源。
- [x] 在 kb session 记录结果；仅全部验收通过后从 known-issues 删除往返白屏条目；提交代码与文档，不自动 push。

命令：

```bash
pnpm --filter web test
pnpm --filter web exec tsc --noEmit
pnpm --filter web build
pnpm --filter server test
rg -n 'fetch\(|api\.|lib/api' web/src
```

最终验收口径：已缓存且未回收的页面返回时可立即呈现，后台刷新不清空已有内容；冷启动有明确加载反馈；跨页写后数据一致；课堂本地草稿、备份和历史提交契约保持不变。Query 缓存不承担多端实时同步、服务端性能优化或收费自动重算。

## 实施记录

按 A → F 分批提交（每批先写对应 B 编号用例），另有一个修复提交。以下是与正文不同、或正文没写到的决定：

- **页面状态统一的落点**：判定口径抽成 `lib/queryView`（有数据即可展示 / 首次失败 / 未启用 / 首次加载，404 与 403 文案），展示组件 `components/QueryState`（`QueryBlock`、`LoadingBlock`、`LoadErrorBlock`、`RefreshStatus`）。后台刷新失败的 Toast 由 `queries/background-errors` + `components/BackgroundErrorToasts` 接到 Plan 1 的注入点，另加「同文案 4 秒内去重」，断网时一批查询同时失败只弹一次。
- **退出登录**：放到 App 层 `SignOutProvider`（用 `useLogoutMutation`），TopBar 只调用并提示失败。守卫抽成 `Guard` 组件：会话过期跳登录页时记来处、重新登录回原页；主动退出不记来处（下一个账号从首页开始）。最初实现是退出后再 `navigate('/login')`，浏览器里与守卫的 `<Navigate>` 竞争导致来处残留，已改成只有守卫一次跳转（见修复提交）。
- **课堂页的守卫例外**（正文未写）：本机已有该班课堂时，身份读取中或读取失败（断网刷新）也直接进课堂，确认未登录才去登录页。旧实现断网刷新会被送去登录页，与 B14「刷新仍恢复」冲突。配套在 `queries/client` 的 MutationCache 加了一条：写成功且 me 读取失败无数据时，在写 resolve 前重读 me，联网后提交课堂跳详情页不会卡在「无法读取登录状态」。
- **最新读取**（正文 E 的「校验最新记录 / 明确等待最新名单」）：新增 `useLatestClassQuery`、`useLatestSessionQuery`（挂载时 `refetchOnMount: 'always'`，调用方等 `isFetchedAfterMount`）。用于编辑上课记录的底稿、URL 直接开课、课前配置的名单与分组。代价是课前配置每次进入都等一次班级详情请求，即便缓存新鲜。排班编辑器只要求详情未过期（`!isStale`），不强制重读。
- **课堂进入判定**抽成纯函数 `lib/classroomBoot`（`bootPlan` / `settleBoot`）；课堂按「班级 + 查询串」keyed 重挂载。建课堂所需读取失败时改为显示错误与重试（旧实现静默跳课前配置），edit_id 属于别班仍跳课前配置。
- **结束课堂冻结**：新增 `freezeCommit` + `loadCommitBackup`，以备份为冻结来源——同一份课堂重试（含刷新页面后）原样复用备份 payload；失败后老师继续上课（课堂内容变了）才按当前时刻重新冻结，幂等键始终不变。
- **cache-effects 改动**（先改用例再改实现）：删除批次时同时从已缓存的收银台列表拿掉该项。列表在删除时多半没挂载，返回首帧不能还显示已删批次；删除是确定结果，不属于「推算汇总」。其余 Plan 1 规则与 hook 签名未改。
- **收款单行**：确认 / 撤销每行各自一个 Mutation 观察者，pending 只锁本行；批次详情在删除进行中起停用查询，删除后不会对已删批次再发 GET。
- **默认分组草稿**：改为「服务端分组 + 草稿」，草稿为空时展示服务端分组；保存成功且其间无新修改才回到服务端分组，失败丢弃草稿恢复。`HomeworkTemplateDialog` 原来随 `template` 变化重置草稿，改为只在打开时填充。
- **批次顺序微调**：`SessionsTable` 与 `Sessions` 页在批次 C 一起迁（班级页与全局列表都依赖它去掉 reload），而不是 D。
- **验收方式**：「延迟读取时保留列表」由 B02 用例（受控延迟）覆盖；浏览器里 agent-browser 无法延迟响应，只验证了过期返回时先画缓存、后台刷新、刷新失败保留内容与重试。收银台往返的网络证据用生产构建（`vite preview`）录制，避开开发模式 StrictMode 的「挂载→中止→重挂载」重复请求。
- **结果**：web 513 个测试、tsc、build、server 292 个测试通过；`rg` 扫描无 `lib/api` 业务引用、组件不直接调用 `api/<domain>` 函数（只引用 `ApiError` / `NetworkError` 做错误分类）、`fetch(` 只在 `api/client.ts`。截图与 HAR 在 `tmp/2026-10-07-web-query-migration/`，过程见 `kb/sessions/2026-10-07-web-query-component-migration.md`。

