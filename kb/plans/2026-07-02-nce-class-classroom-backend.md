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

## 已定决策（本 plan 的前提）

1. **直连课堂 → 重定向到课前配置。** 直达 `/classes/:id/classroom` 时：若本地存有该班「进行中」的课堂 → 恢复（resume）；否则跳 `/classes/:id/setup`。不再 seed「进行中」session；直达不再等于 Lesson 3 截图（截图/回归改走 setup → 开始课堂，或保留纯前端 demo 作为独立演示）。
2. **累计个人总分计入所有已提交 session（§5）。** 因为不 seed 进行中 session，无需为 demo 调整历史 seed；真实上完并提交的课自然并入累计。
3. **写入策略 = 本地优先 + 结束课堂一次性提交。** 加减分/背书/作业/出勤/调组/撤销全部是**本地状态**的直接改动，持久化到浏览器（LocalStorage/IndexedDB），**全程可离线**；直到「结束课堂」才把本堂完整数据结构一次性 POST 给后端，由后端在**一个事务**里落库。
4. **鉴权不在本 plan。** 本 plan 排在老师登录鉴权工作之后，直接复用系统已有的「获取当前老师」代码/登录态；提交接口用当前老师写 `teacher_id`/`created_by`。
5. **M1 不做多端实时同步。** 单端操作（一台设备投屏）；本地优先模型天然契合（无需 WebSocket/轮询）。

## 背景与现状

课前配置（`Setup.tsx`）→ 课堂（`Classroom.tsx`）已用 `location.state` 串起来，但全程内存态、刷新即丢，后端零写入。本 plan 把课堂做成「本地优先 + 一次性提交」的真实闭环（PRD §5/§6/§7.2/§7.3）。

**与 [[2026-07-01-nce-class-m1-management-wiring]] 的边界**：管理页写操作（建班/学生增删合并/`PUT groups`/`GET recap` 路由）归那份 plan。本 plan 复用其 `GET /api/sessions/:id/recap`（结束后查看回顾）；**默认分组回写（§7.2）改由本 plan 的提交接口在事务内完成**（不必依赖 `PUT groups`）。

## 架构总览

```
课前配置 Setup ──build config──▶ 课堂 Classroom（本地状态 + 持久化）
                                     │  加减分/背书/作业/出勤/调组/撤销 = 纯本地
                                     │  每次改动落 LocalStorage（刷新/离线可恢复）
                                     ▼
                              结束课堂 ──一次性大 payload──▶ POST /api/classes/:id/sessions
                                                              后端单事务：
                                                              ①回写班级默认分组(§7.2)
                                                              ②建 ClassSession(ended)
                                                              ③建 SessionGroup 快照
                                                              ④建 SessionMembership
                                                              ⑤批量插 ScoreEvent
                                                              ⑥批量插 CheckRecord
                                                              ⑦派生并返回 recap
```

关键收益：后端只需**一个提交接口**（+ 复用 recap 读接口）；课堂交互零网络延迟、可离线；撤销/连点加分纯本地即时。

## 数据模型

**无需迁移**——`class_sessions / session_groups / session_memberships / score_events / check_records` 均已在 `schema.ts` + `ddl.ts`。仅新增一个提交路由 + 事务写入。

## 前端：本地状态 + 持久化

- **状态模型**：沿用 `lib/session.ts` 的 `SessionState`（groups/students/events），但需扩展成「一堂课的完整快照」：
  - `SStudent.id` 由 number 改 **string**（用真实学生 id，接后端提交必需）。
  - 增加 `attendance`（present/absent）到学生态（现在出勤是 `Classroom` 里单独的 `absent` map，合并进 session 状态便于整体持久化/提交）。
  - 增加会话元信息：`classId, lessonNumber?, lessonTitle?, plannedDurationMin, startedAt`（真实墙钟）、以及 `defaultGrouping`（**开课时**确认的分组，用于 §7.2 回写，区别于课中调组后的最终归属）。
- **持久化**：`lib/classroomStore.ts`（新增）——把整个 session 状态序列化存 `localStorage`，key 形如 `nce.classroom.<classId>`。每次 reducer 改动后写入；载入时读取恢复。
  - M1 数据量小（十几个学生 + 几十条事件），**LocalStorage 足够**（同步、JSON、实现简单）；若日后单堂数据变大再迁 IndexedDB。标注为可替换。
- **开始课堂**（`Setup.start`）：不再走 `sessionFromConfig` 重键数字 id；改为初始化一份完整本地 session（`startedAt=now`、`defaultGrouping=`课前确认分组、events=[]、全员 present 除课前缺席），写入 store，`nav('/classes/:id/classroom')`。**开始课堂不发任何后端请求。**
- **课堂交互**：加减分/背书/作业/出勤/调组/撤销 = 纯 reducer 改本地 + 落 store。派生分数继续用 `sScore/gScore`（保留单测）。计时器用 `startedAt` 本地倒数、归零转超时（§7.3）。
- **恢复 / 直连**：`Classroom` 载入先读 store：命中该班进行中课堂 → 恢复；否则（无 config、无本地态）→ 重定向 `/setup`。
- **结束课堂**：把本地 session 组装成提交 payload（下节）→ `POST` → 成功后**清除本地 store** + 用返回 recap 填结束弹窗 → 跳 `班级详情?tab=sessions`。失败则保留本地态 + toast（可重试，数据不丢）。
- **放弃本节课**（可选）：提供「不保存退出」清 store；标注为 nice-to-have。

## 后端：提交接口（新增，唯一写接口）

### `POST /api/classes/:id/sessions` — 结束课堂一次性提交

当前老师身份取自已有登录态（决策 4）。请求体（前端由本地 session 组装）：

```jsonc
{
  "lessonNumber": 4,                 // 可选
  "lessonTitle": "A private conversation", // 可选
  "plannedDurationMin": 120,
  "startedAt": "2026-07-02 19:00:00",
  "endedAt":   "2026-07-02 20:58:00",// 实际时长 = ended-started（§7.3）
  "defaultGrouping": {               // §7.2：开课时确认的分组，回写为班级默认
    "groups": [{ "clientId": "c1-g1", "name": "第1组", "emoji": "🦁", "orderIndex": 0 }],
    "memberships": [{ "studentId": "s-c1-1", "clientGroupId": "c1-g1" }]
  },
  "sessionGroups": [                 // 本堂快照的组（通常同 defaultGrouping.groups）
    { "clientId": "c1-g1", "name": "第1组", "emoji": "🦁", "orderIndex": 0 }
  ],
  "memberships": [                   // 本堂最终归属 + 出勤（课中调组后的终态）
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

**后端处理（单事务）**：

1. **回写默认分组（§7.2）**：据 `defaultGrouping` replace 该班 `class_groups` + `class_group_memberships`；`clientId` 为 `new-*` 的新组分配真实 id（沿用/对齐管理-wiring 的 replace 语义）。建立 `clientGroupId → classGroupId` 映射。
   - 注意：默认分组用 **defaultGrouping（开课态）**，不是 `memberships`（课中调组后的终态）——课中调组「只影响后续加分归属、不改写默认」（§7.3）。
2. 建 `class_sessions`：status=`ended`、`date`=today、`teacher_id`=当前老师、`started_at`/`ended_at`/`planned_duration_min` 照传。
3. 建 `session_groups`（据 `sessionGroups`），建立 `clientGroupId → sessionGroupId` 映射。
4. 建 `session_memberships`：`session_group_id` 用映射（缺席者 null + attendance=absent）。
5. 批量插 `score_events`：`session_group_id` 用 `clientGroupId` 映射；`created_by`=当前老师；`target_id` 学生用真实学生 id、组用 sessionGroupId（或组的映射）。
6. 批量插 `check_records`（每 session+student+type 一行）。
7. 派生并返回 recap（复用 `lastRecapPayload` 逻辑：组分排名、亮眼≥2、被提醒任一−1、出勤 present/total）+ 新 `sessionId`。

**校验/健壮性**：校验 class 归属当前 org；delta∈{±1}；student/group id 属于该班；空 events/checks 合法（可能一节课没加分）；幂等性——同一本地 session 重复提交（网络重试）需去重：前端在本地 session 生成一个 `clientSessionId`（nanoid）随 payload 上传，后端以其唯一约束或「已存在则返回既有」避免重复入库。→ **需加一列 `class_sessions.client_session_id`（唯一）**，属**唯一需要的 schema 变更**；或用 (classId+startedAt) 组合去重（无需改表）。**推荐**后者以维持「零迁移」，标为待决策。

### 复用：`GET /api/sessions/:id/recap`

结束弹窗与「上课记录」查看 recap 复用（见管理-wiring plan；若未落地则本 plan 顺带补上，泛化现有 `lastRecapPayload`）。

## 测试计划（BDD 先行）

- **服务端**（当前无 runner）：加 vitest + 临时 db（跑 DDL + 最小 seed）。**先写行为用例再实现**提交接口：
  1. 提交后：`class_sessions` 一条 ended、时长=ended−started；`session_groups`/`memberships` 数量与归属正确、缺席者 absent+null 组。
  2. 计分派生：某生个人分=其 student 事件 Σ；组分=组事件+该组学生事件（§5 嵌套）；组级事件不进任何个人分。
  3. 调组语义：事件带 `clientGroupId` 落到 `session_group_id`，同一生在不同组的历史事件各归各组，终态 membership 不回溯改写历史组分。
  4. §7.2 回写：默认分组按 `defaultGrouping`（非终态 memberships）更新；`new-*` 新组建出真实 id。
  5. recap：排名/亮眼/被提醒/出勤正确。
  6. 幂等：同 `clientSessionId`（或 class+startedAt）重复提交不重复入库。
- **前端**：
  - `session.ts` 改 string id，`session.test.ts` 转绿。
  - 新增 `classroomStore.ts` 的 reducer + 持久化单测（加分/撤销/调组/出勤/背书作业后状态正确、序列化往返一致、恢复正确）。
  - `buildCommitPayload`（本地 session → 提交结构）纯函数 + 单测（映射、缺席、events 带组、checks 过滤未检查）。
- **回归**：双包 `tsc --noEmit`；agent-browser 复跑 setup→开始课堂→课堂五视图→结束课堂截图，确认与 `tmp/goal-images/` 一致；结束后到「上课记录」看 recap。

## 任务拆解（可独立验证的顺序）

1. **前端 id 重构**：`session.ts` number→string；`Classroom`/`setup` 签名跟随；单测转绿（纯前端，先合入降风险）。
2. **本地状态合并 + 持久化**：把出勤并入 session 状态；新增 `classroomStore.ts`（reducer + localStorage）；`Setup.start` 初始化本地 session（不发后端）；`Classroom` 从 store 恢复/直连重定向。→ 手测：开课→操作→刷新仍在→撤销正确。
3. **提交 payload 组装**：`buildCommitPayload` 纯函数 + 单测。
4. **服务端脚手架**：vitest + 临时 db harness；事务封装；body 守卫。
5. **提交接口**：`POST /classes/:id/sessions`（单事务：回写默认分组 + session/快照/事件/检查 + recap；幂等）。先写测试。
6. **前端接线**：结束课堂 → `postCommit` → 清 store + recap 弹窗 → 跳上课记录；失败保留本地 + toast。
7. **回归 + 截图**。

## 待决策（需你拍板）

- **幂等去重方式**：给 `class_sessions` 加 `client_session_id` 唯一列（最稳，但一次小迁移）／用 (classId+startedAt) 组合去重（零迁移，推荐）？
- **本地存储介质**：LocalStorage（推荐，数据小、简单）／IndexedDB（更大更稳，M1 过度）？
- **未结束课堂的清理**：本地进行中 session 长期不提交是否需要过期/放弃入口？（建议 M1 仅提供「恢复」+ 可选「放弃退出」，不做自动过期。）
- **纯前端 Lesson 3 demo 去留**：直连改跳 setup 后，是否保留 `initialSession()` 的 demo 作为独立演示/截图基线（如 `?demo=1`），还是删除？

## 影响文件（预估）

- 后端：`server/src/server.ts`（+ 提交路由，或拆 `server/src/routes/sessions.ts` + `server/src/db/mutations.ts`）、（若选 client_session_id）`schema.ts`+`ddl.ts`、新增 `server` 测试 + vitest 配置 + 临时 db harness。
- 前端：`web/src/lib/{api,session,setup}.ts`、新增 `web/src/lib/classroomStore.ts`（+ `.test.ts`）、`web/src/pages/{Setup,Classroom}.tsx`、复用 Toast。

## 不在本 plan 内

管理页写操作（见 [[2026-07-01-nce-class-m1-management-wiring]]）、老师登录鉴权（前置，另做）、成长档案、学生端 H5、Minio/OSS 存储实现、投屏实时多端同步。
