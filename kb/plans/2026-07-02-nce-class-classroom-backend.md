---
created: 2026-07-02
tags:
  - plan
  - milestone-1
  - nce-class
  - backend
  - classroom
---

# NCE Class · M1 课堂运行时持久化 Plan（本地优先 + 结束课堂一次性提交）

> 本版依据 2026-07-02 的决策定稿，**取代**早期「每个操作一个 REST 写接口」的草案。核心改为**本地优先（offline-first）**：整节课在前端本地状态跑，仅「结束课堂」时把整堂数据一次性提交后端入库。
>
> **2026-07-02 更新**：[[2026-07-01-nce-class-m1-management-wiring]]（登录鉴权 + 班级管理写操作）已合入（commit d71a061），本 plan 多处前提已就绪，相应任务已瘦身/改为复用现成代码——见文中「已就位」「复用」标注。
>
> **2026-07-02 复审**：对照 d71a061 后的实际代码逐条核对，并拍板全部待决策——新增决策 6–13（缺席回写语义、确认后提交、课中缺席置 null、date 派生、client_session_id 幂等列、LocalStorage、放弃入口必做、URL 参数 boot），原「待决策」一节清空。

## 已定决策（本 plan 的前提）

1. **直连课堂 → 重定向到课前配置。** 直达 `/classes/:id/classroom` 时：若本地存有该班「进行中」的课堂 → 恢复（resume）；否则跳 `/classes/:id/setup`。不再 seed「进行中」session；直达不再等于 Lesson 3 截图（截图/回归改走 setup → 开始课堂，或 URL 参数 boot——见决策 13）。落地时记得把 AGENTS.md 里「直接访问走 Lesson 3 demo」同步改掉。
2. **累计个人总分计入所有已提交 session（§5）。** 因为不 seed 进行中 session，无需为 demo 调整历史 seed；真实上完并提交的课自然并入累计。
3. **写入策略 = 本地优先 + 结束课堂一次性提交。** 加减分/背书/作业/出勤/调组/撤销全部是**本地状态**的直接改动，持久化到浏览器（LocalStorage/IndexedDB），**全程可离线**；直到「结束课堂」才把本堂完整数据结构一次性 POST 给后端，由后端在**一个事务**里落库。
4. **鉴权已就位（前置已完成，commit d71a061）。** 登录鉴权在 [[2026-07-01-nce-class-m1-management-wiring]] 已落地：`app.ts` 的认证中间件把当前老师放在 `res.locals.teacher`，并有 `classInOrg(classId, orgId)` 校验班级归属。提交接口直接用它俩，写 `teacher_id`/`created_by` = `res.locals.teacher.id`。
5. **M1 不做多端实时同步。** 单端操作（一台设备投屏）；本地优先模型天然契合（无需 WebSocket/轮询）。
6. **缺席学生不被踢出默认分组（2026-07-02 复审）。** 回写 §7.2 时，课前被拖进缺席暂存区的学生**保留其在 `classDetail` 中的原 groupId**（若原组在本次 setup 中被删除则回落为未分组）；只有被主动拖进别的组才算改默认分组。本节课照样不计分。暂存区文案只承诺「本节不计分」，不能顺手把请假学生永久踢出默认组（`saveGrouping` 是 replace 语义，照 setup 状态直接写会踢）。因此 `SessionConfig`/本地 session 需携带缺席名单（含 `originalGroupId`）。
7. **确认后才提交。** 点「结束课堂」先弹**本地派生**的预览（现有 EndRecap，「返回课堂」可反悔）；点「确认结束」才 POST。成功后清 store + 跳 `班级详情?tab=sessions`（服务端 recap 在上课记录浮窗查看，不再二次弹窗）；失败保留本地态 + toast 重试。
8. **课中缺席 membership 一律置 null。** 所有 attendance=absent 的学生 `session_group_id=null`（与课前缺席形状统一、少一个分支）；其已发生的分数事件各自带组，组分派生不受影响。
9. **`date` 由 `startedAt` 派生**（`startedAt.slice(0, 10)`），不用服务器时钟——确定性、可测试、跨午夜的课归属开课日，且不与 `REFERENCE_TODAY=2026-07-01` 漂移。
10. **幂等用 `client_session_id` 唯一列**（本项目首次 schema 变更）：`class_sessions` 加 nullable UNIQUE 列，`schema.ts`+`ddl.ts`+seed 同步（历史 seed session 置 null）。前端本地 session 生成 nanoid 随 payload 上传、重试不变；后端「已存在则返回既有 sessionId+recap」。
11. **本地存储用 LocalStorage**（key `nce.classroom.<classId>`），在 `classroomStore.ts` 标注可替换（日后数据大了再迁 IndexedDB）。
12. **「放弃本节课（不保存退出）」为必做**（二次确认后清 store 跳班级详情）——直连只会「恢复」，没有它，坏掉的本地 session 会把该班课堂入口卡死，只能手动清 localStorage。
13. **直连 classroom 支持 URL 参数 boot 新 session（真数据）。** 判定顺序：①store 命中该班进行中课堂 → 恢复；②URL 带课次参数（如 `?lesson=4&title=A+private+conversation&duration=120`）→ 用该班**真实默认分组** boot 全新空 session（跳过 setup 的快捷方式；未分组学生按缺席处理，同 setup 落暂存区的语义）；③否则重定向 `/setup`。Lesson 3 固定演示数据不再有页面入口，`initialSession()` 仅保留给 `session.test.ts` 当夹具。

## 背景与现状

课前配置（`Setup.tsx`）→ 课堂（`Classroom.tsx`）已用 `location.state` 串起来，但全程内存态、刷新即丢，后端零写入。本 plan 把课堂做成「本地优先 + 一次性提交」的真实闭环（PRD §5/§6/§7.2/§7.3）。

**与 [[2026-07-01-nce-class-m1-management-wiring]] 的边界**：管理页写操作（建班/学生增删/`PUT groups`/`GET recap` 路由 + 登录鉴权）已在那份 plan 落地（commit d71a061）。本 plan **复用其成果**：

- `GET /api/sessions/:id/recap` 已上线（`app.ts` 的 `buildRecap()`），结束弹窗与「上课记录」直接用。
- **默认分组回写（§7.2）复用 `db/mutations.ts` 的 `saveGrouping()`**（整套 replace + `new-*`→真实 id + 过滤非本班成员），不再自己实现。**无需抽 `saveGroupingCore`**：better-sqlite3 的 `transaction()` 嵌套调用自动降级为 savepoint，`commitSession` 的事务里直接调现成的 `saveGrouping` 即可（复审已确认）。
- body 守卫复用 `app.ts` 的 `str()`；跨组织校验复用 `classInOrg()`。

## 架构总览

```
课前配置 Setup ──build config──▶ 课堂 Classroom（本地状态 + 持久化）
                                     │  加减分/背书/作业/出勤/调组/撤销 = 纯本地
                                     │  每次改动落 LocalStorage（刷新/离线可恢复）
                                     ▼
                              结束课堂 ──一次性大 payload──▶ POST /api/classes/:id/sessions
                                                              后端单事务：
                                                              ①回写班级默认分组(§7.2) = saveGrouping
                                                              ②建 ClassSession(ended)
                                                              ③建 SessionGroup 快照
                                                              ④建 SessionMembership
                                                              ⑤批量插 ScoreEvent
                                                              ⑥批量插 CheckRecord
                                                              ⑦buildRecap 派生并返回
```

关键收益：后端只需**一个提交接口**（+ 复用已上线的 recap 读接口）；课堂交互零网络延迟、可离线；撤销/连点加分纯本地即时。

## 数据模型

五张表 `class_sessions / session_groups / session_memberships / score_events / check_records` 均已在 `schema.ts` + `ddl.ts`（复审已核对）。**唯一 schema 变更**：`class_sessions` 加 `client_session_id` 幂等列（nullable + UNIQUE，决策 10），`schema.ts`/`ddl.ts`/seed 同步。其余仅在 `app.ts` 加提交路由 + 往 `db/mutations.ts` 加 `commitSession()` 事务函数（§7.2 段直接复用 `saveGrouping`，嵌套事务自动 savepoint）。

## 前端：本地状态 + 持久化

- **状态模型**：沿用 `lib/session.ts` 的 `SessionState`（groups/students/events），但需扩展成「一堂课的完整快照」：
  - `SStudent.id` 由 number 改 **string**（用真实学生 id，接后端提交必需）。
  - `SEvent` 增加 `createdAt`（提交 payload 需要）。
  - 增加 `attendance`（present/absent）到学生态（现在出勤是 `Classroom` 里单独的 `absent` map，合并进 session 状态便于整体持久化/提交）。
  - **课前缺席学生也要入册**：现在 `buildSessionConfig` 只输出参与者，缺席学生被整个丢掉——`SessionConfig` 契约需扩为携带缺席名单 `{id, name, originalGroupId?}`。memberships 提交、recap 的出勤 total（按 membership 行数计）、§7.2「缺席保留原组」（决策 6）都依赖它。
  - 增加会话元信息：`classId, lessonNumber?, lessonTitle?, plannedDurationMin, startedAt`（真实墙钟）、以及 `defaultGrouping`（**开课时**确认的分组 + 缺席学生的原组归属（决策 6），用于 §7.2 回写，区别于课中调组后的最终归属）。
- **持久化**：`lib/classroomStore.ts`（新增）——把整个 session 状态序列化存 `localStorage`，key 形如 `nce.classroom.<classId>`。每次 reducer 改动后写入；载入时读取恢复。
  - M1 数据量小（十几个学生 + 几十条事件），**LocalStorage 足够**（同步、JSON、实现简单）；若日后单堂数据变大再迁 IndexedDB。标注为可替换。
- **开始课堂**（`Setup.start`）：不再走 `sessionFromConfig` 重键数字 id；改为初始化一份完整本地 session（`startedAt=now`、`defaultGrouping=`课前确认分组+缺席原组、events=[]、全员 present 除课前缺席——缺席者也入册：attendance=absent），写入 store，`nav('/classes/:id/classroom')`。**开始课堂不发任何后端请求。**
- **课堂交互**：加减分/背书/作业/出勤/调组/撤销 = 纯 reducer 改本地 + 落 store。派生分数继续用 `sScore/gScore`（保留单测）。计时器用 `startedAt` 本地倒数、归零转超时（§7.3；注意「转超时」是新行为，现实现停在 0）。
- **恢复 / 直连**（决策 13）：`Classroom` 载入判定顺序：①store 命中该班进行中课堂 → 恢复；②URL 带课次参数 → 用真实默认分组 boot 全新空 session；③否则重定向 `/setup`。Lesson 3 demo 的页面回退删除（`initialSession()` 留给单测）。
- **结束课堂**（决策 7，确认后才提交）：点「结束课堂」→ 本地派生预览弹窗（现有 EndRecap，「返回课堂」可反悔）→ 点「确认结束」→ 组装提交 payload（下节）`POST`（用 `api.req('POST', …)`）→ 成功后**清除本地 store** + toast → 跳 `班级详情?tab=sessions`（服务端 recap 在上课记录浮窗查看，不再二次弹窗）。失败则保留本地态 + toast（可重试，数据不丢）。
- **放弃本节课**（必做，决策 12）：课堂内提供「不保存退出」，二次确认后清 store 跳班级详情——坏本地数据的唯一自救出口。

## 后端：提交接口（新增，唯一写接口）

### `POST /api/classes/:id/sessions` — 结束课堂一次性提交

当前老师身份取自 `res.locals.teacher`（决策 4）。请求体（前端由本地 session 组装）：

```jsonc
{
  "clientSessionId": "nano...",      // 幂等键（nanoid，随重试不变；对应 class_sessions.client_session_id 唯一列，决策 10）
  "lessonNumber": 4,                 // 可选
  "lessonTitle": "A private conversation", // 可选
  "plannedDurationMin": 120,
  "startedAt": "2026-07-02 19:00:00",// ⚠️ 格式必须是 'YYYY-MM-DD HH:mm:ss'（naive，无 T/Z）——
  "endedAt":   "2026-07-02 20:58:00",//   app.ts 的 actualMin 按 replace(' ','T')+'Z' 解析，ISO 串会算出 NaN。
                                     //   实际时长 = ended-started（§7.3）；date 由 startedAt 前 10 位派生（决策 9）
  "defaultGrouping": {               // §7.2：开课时确认的分组，回写为班级默认。
                                     //   groups 内嵌 memberIds（形状对齐 PUT /groups 的 GroupSave），可直接喂 saveGrouping。
                                     //   ⚠️ 缺席学生保留原组（决策 6）：memberIds 里含课前缺席但原本在该组的学生
    "groups": [
      { "clientId": "c1-g1", "name": "第1组", "emoji": "🦁", "orderIndex": 0, "memberIds": ["s-c1-1"] }
    ]
  },
  "sessionGroups": [                 // 本堂快照的组（通常同 defaultGrouping.groups）
    { "clientId": "c1-g1", "name": "第1组", "emoji": "🦁", "orderIndex": 0 }
  ],
  "memberships": [                   // 本堂最终归属 + 出勤；absent 一律 clientGroupId=null（决策 8），
                                     //   含课前缺席和课中标记缺席
    { "studentId": "s-c1-1", "clientGroupId": "c1-g1", "attendance": "present" },
    { "studentId": "s-c1-13", "clientGroupId": null, "attendance": "absent" }
  ],
  "events": [                        // 完整事件流；每条带当时所在组（§5 历史不回溯）
    { "targetType": "student", "targetId": "s-c1-1", "clientGroupId": "c1-g1", "delta": 1, "createdAt": "..." },
    { "targetType": "group",   "targetId": "c1-g1",  "clientGroupId": "c1-g1", "delta": 1, "createdAt": "..." }
  ],
  "checks": [                        // 每生背书/作业终态（未检查/未批改=不出现）
    { "studentId": "s-c1-1", "type": "recitation", "status": "已背完" },
    { "studentId": "s-c1-1", "type": "homework",   "status": "完成" }
  ]
}
```

**后端处理（单事务，建议 `commitSession()` in `db/mutations.ts`）**：

1. **回写默认分组（§7.2）**：把 `defaultGrouping.groups` 映射成 `GroupInput[]`（`clientId`→`id`，`new-*` 交给 `saveGrouping` 分配真实 id）后**直接调用 `saveGrouping`**（嵌套事务自动 savepoint，无需抽 core 版）。无需建 `clientGroupId → classGroupId` 映射——session 侧数据只用第③步的 `clientGroupId → sessionGroupId` 映射，`session_groups` 与 `class_groups` 无外键关联。
   - 注意：默认分组用 **defaultGrouping（开课态 + 缺席原组，决策 6）**，不是 `memberships`（课中调组后的终态）——课中调组「只影响后续加分归属、不改写默认」（§7.3）。
2. 建 `class_sessions`：status=`ended`、`date`=**`startedAt.slice(0, 10)`**（决策 9）、`client_session_id` 照传、`teacher_id`=`res.locals.teacher.id`、`started_at`/`ended_at`/`planned_duration_min` 照传。
3. 建 `session_groups`（据 `sessionGroups`），建立 `clientGroupId → sessionGroupId` 映射。
4. 建 `session_memberships`：`session_group_id` 用映射（absent 一律 null + attendance=absent，决策 8）。
5. 批量插 `score_events`：`session_group_id` 用 `clientGroupId → sessionGroupId` 映射；`created_by`=`res.locals.teacher.id`；student 事件 `target_id`=真实学生 id，group 事件 `target_id`=**sessionGroupId**（同样经映射）。这正是 `buildRecap` 嵌套查询依赖的形状——写对了 recap 才对得上。
6. 批量插 `check_records`（每 session+student+type 一行）。
7. 返回 recap：`commitSession` 事务提交后，路由内调 `buildRecap(newSessionRow)`（`app.ts` 现有私有函数，同一连接，无需搬家）+ 新 `sessionId`。

**校验/健壮性**：用 `classInOrg(classId, org)` 校验 class 归属当前 org；delta∈{±1}；student/group id 属于该班；`startedAt`/`endedAt` 校验为 `YYYY-MM-DD HH:mm:ss` 格式（防 ISO 串把 `actualMin` 算成 NaN）；空 events/checks 合法（可能一节课没加分）；幂等——查 `client_session_id` 已存在则跳过写入、直接返回既有 sessionId+recap（决策 10；同一班同一秒开两次课也能区分）。

### 复用：`GET /api/sessions/:id/recap`（已上线）

「上课记录」查看 recap 走此接口（management-wiring 已落地，`app.ts` 的 `buildRecap()`，返回组分排名 + 🌟净≥2 + ⚠️任一−1 + 出勤 present/total，shape 对应前端 `Recap` 类型）。前端 `api.getSessionRecap(id)` 也已就绪。结束弹窗按决策 7 是**本地派生预览**（提交前），不调此接口——本地派生与服务端派生的一致性由单测保证（同一套 §5 规则）。

## 测试计划（BDD 先行）

- **服务端**：复用现有 `server/tests/helpers.ts` 的 `setupTestApp()`（`NCE_DB_PATH` 临时库 + DDL + 最小两组织 seed）+ supertest（vitest 已配好）。**先写行为用例再实现**提交接口：
  1. 提交后：`class_sessions` 一条 ended、时长=ended−started；`session_groups`/`memberships` 数量与归属正确、缺席者 absent+null 组。
  2. 计分派生：某生个人分=其 student 事件 Σ；组分=组事件+该组学生事件（§5 嵌套）；组级事件不进任何个人分。
  3. 调组语义：事件带 `clientGroupId` 落到 `session_group_id`，同一生在不同组的历史事件各归各组，终态 membership 不回溯改写历史组分。
  4. §7.2 回写：默认分组按 `defaultGrouping`（非终态 memberships）更新；**课前缺席学生保留原组不被踢出**（决策 6）；`new-*` 新组建出真实 id（`saveGrouping` 已有此行为，可复用其单测思路）。
  5. recap：排名/亮眼/被提醒/出勤正确（可直接断言 `buildRecap` 输出）；`date` = startedAt 派生（决策 9）。
  6. 幂等：同 `clientSessionId` 重复提交不重复入库、返回同一 sessionId。
- **前端**：
  - `session.ts` 改 string id（`SEvent` 加 `createdAt`），`session.test.ts` 转绿。
  - 新增 `classroomStore.ts` 的 reducer + 持久化单测（加分/撤销/调组/出勤/背书作业后状态正确、序列化往返一致、恢复正确）。
  - `buildCommitPayload`（本地 session → 提交结构）纯函数 + 单测（映射、缺席一律 null 组、defaultGrouping 含缺席原组、events 带组、checks 过滤未检查、**时间串锁定 'YYYY-MM-DD HH:mm:ss' 格式**）。
- **回归**：双包 `tsc --noEmit`；agent-browser 复跑（**Setup/Classroom 现在都在 auth guard 后，先登录 `wangli/demo1234`**）setup→开始课堂→课堂五视图→结束课堂截图，确认与 `tmp/goal-images/` 一致；结束后到「上课记录」看 recap。⚠️ **课中调组 DnD 不能用 agent-browser 的 `drag`**（鼠标手势，HTML5 DnD 收不到）——用 `eval` 分两次 dispatch `dragstart` / `drop`、中间 `wait` 让 React 提交 `dragId`（具体命令见 AGENTS.md「测试与验证」）。

## 任务拆解（可独立验证的顺序）

1. **前端 id 重构**：`session.ts` number→string（`SEvent` 顺带加 `createdAt`）；`Classroom`/`setup` 签名跟随（`absent` map/`openId`/`dragId`/demo 夹具都要跟）；单测转绿（纯前端，先合入降风险）。
2. **本地状态合并 + 持久化**：把出勤并入 session 状态；`SessionConfig` 扩为携带缺席名单（含原组，决策 6）；新增 `classroomStore.ts`（reducer + localStorage）；`Setup.start` 初始化本地 session（不发后端）；`Classroom` 按决策 13 顺序恢复 / URL boot / 重定向；「放弃本节课」入口（决策 12）。→ 手测：开课→操作→刷新仍在→撤销正确→放弃后入口不卡死。
3. **提交 payload 组装**：`buildCommitPayload` 纯函数 + 单测（含时间格式锁定）。
4. **服务端脚手架（大部分已存在）**：`class_sessions` 加 `client_session_id` 列（`schema.ts`+`ddl.ts`+seed 置 null，决策 10）；复用 `server/tests/` harness；往 `db/mutations.ts` 加 `commitSession`（事务内直接调 `saveGrouping`，嵌套自动 savepoint）；body 守卫复用 `app.ts` 的 `str()`。
5. **提交接口**：`app.ts` 加 `POST /classes/:id/sessions`（单事务：`saveGrouping` 回写默认分组 + session/快照/事件/检查；事务后 `buildRecap`；幂等）。先写测试。
6. **前端接线**：结束课堂预览 → 确认 → `postCommit` → 清 store + toast → 跳上课记录（决策 7）；失败保留本地 + toast。
7. **回归 + 截图 + 更新 AGENTS.md**（「直接访问走 Lesson 3 demo」改为决策 13 的判定顺序；「待做」一节同步）。

## 待决策

（无。原 4 项已于 2026-07-02 复审全部拍板，连同复审新增语义决策一并收进上文「已定决策」6–13：幂等=client_session_id 列、存储=LocalStorage、放弃入口=必做、demo=真数据 URL 参数 boot。）

## 影响文件（预估）

- 后端：`server/src/app.ts`（createApp 内加提交路由）、`server/src/db/mutations.ts`（**已存在**，加 `commitSession`，事务内直接调 `saveGrouping`）、`server/src/db/{schema,ddl,seed}.ts`（`client_session_id` 列）、`server/tests/`（**harness 已存在**，加提交接口用例）。
- 前端：`web/src/lib/{api,session,setup}.ts`（`api` 已有 `req/post/ApiError`）、新增 `web/src/lib/classroomStore.ts`（+ `.test.ts`）、`web/src/pages/{Setup,Classroom}.tsx`、复用 `components/{Modal,Toast}`（**已存在**）。

## 不在本 plan 内

管理页写操作（见 [[2026-07-01-nce-class-m1-management-wiring]]，已完成）、老师登录鉴权（前置，已完成）、成长档案、学生端 H5、Minio/OSS 存储实现、投屏实时多端同步。
