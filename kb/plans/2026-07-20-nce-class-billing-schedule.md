---
created: 2026-07-20
tags:
  - plan
  - nce-class
  - billing
  - schedule
  - cashier
---

# NCE Class · 学生收费（排班表 + 收银台）Plan

> 背景：M1 没有排班概念，也没有任何收费/台账能力。本 plan 一次引入两个互相依赖的子系统：**课程周期（排班表）**——班级维度的计划层，日历自由点选排课；**收费**——收银台按「班级 + 课程周期」批量生成收款，逐学生结算与确认到账。设计经 2026-07-20 brainstorm 逐项确认（mockup 存 `.brainstorming/`，gitignored）。

## 已定决策（brainstorm 拍板，不再讨论）

1. **计费口径 = 过去按事实、未来按计划**：应收节数 N = 周期内「已上课程中实际到堂节数」+「尚未上的计划节数」（假定未来全勤）。例：周期排 9 节，已上 5 节该生到 3 节，剩 4 节未上 → N = 3 + 4 = 7。
2. **出勤计费判定**：`present` 或 `madeUp=1` 计费（当堂到或事后补都收）；缺席/请假且未补不收。
3. **计划 vs 实际按日期范围匹配**：不做排班日 ↔ session 一一关联。周期起止 = 所选日期 min/max；范围内该班**所有实际 session** 都计入已上部分（临时加课/调课自然覆盖）；已过去但没开课的排班日自然不计费（临时取消不收钱）。
4. **创建时快照**：建收款批次时逐学生算死节数与金额落库，之后不自动变；变化靠详情页「重新计算」或手动编辑。
5. **排班表 ↔ 收款批次 1:1**：一个课程周期只能生成一个批次（防重复收费）；删除批次后可重新生成。
6. **日历交互**：时间刷（先选时间段再点日子上色）；同一天允许多节（不同时间段各一节）；已生成批次的周期仍可编辑日期（快照不自动变，靠重算刷新）。
7. **收银台只放 org 级入口**（顶部导航「收银台」→ `/billing`）；班级详情只新增「排班」tab 管理课程周期。
8. **确认收款一键化**：只记确认时间 + 操作老师，不填渠道/备注；可撤销。
9. **编辑弹窗的逐节「计费」列只读**：由出勤自动决定，不存逐节覆盖；特殊情况用「最终收款金额」整体覆盖。
10. **命名**：班级维度的表叫 `billing_batches`（收款批次），面向个人的才叫 `invoices`（收款单）。批次带**附加费**（如书本费，按人头加到应收）。

## 数据模型（4 张新表，`provision.migrate()` 幂等 DDL）

```
class_schedules    课程周期（排班表）
  id TEXT PK, class_id → classes, name TEXT NOT NULL, created_at
  -- 起止日期不落库，派生自 lessons 的 min/max

schedule_lessons   排班节次
  id TEXT PK, schedule_id → class_schedules
  date TEXT (YYYY-MM-DD), start_time TEXT (HH:MM), end_time TEXT (HH:MM)
  UNIQUE(schedule_id, date, start_time)   -- 同天多节，时间不同即可

billing_batches    收款批次（班级+周期维度的一次收费动作）
  id TEXT PK, class_id → classes, schedule_id → class_schedules UNIQUE  -- 1:1
  unit_price_cents INTEGER NOT NULL        -- 默认单价；金额一律整数分
  addon_cents INTEGER NOT NULL DEFAULT 0   -- 附加费/人（书本费等）
  addon_note TEXT                          -- 附加费说明
  snapshot_at TEXT, created_by → teachers, created_at

invoices           收款单（每学生一张，真正的收款状态载体）
  id TEXT PK, batch_id → billing_batches, student_id → students
  UNIQUE(batch_id, student_id)
  attended_count INTEGER   -- 快照：已上到堂（present||madeUp）
  planned_count INTEGER    -- 快照：未上计划节数
  billable_count INTEGER   -- = attended + planned
  unit_price_cents INTEGER -- 默认继承批次，可按学生覆盖
  computed_amount_cents    -- 应收 = unit_price × billable_count + batch.addon_cents（billable=0 时为 0）
  final_amount_cents       -- 默认 = computed，可手动覆盖
  adjusted INTEGER DEFAULT 0  -- 显式「手动改过」标记（重算据此保留 final/note）
  note TEXT
  status TEXT DEFAULT 'pending'  -- pending | paid
  paid_at TEXT, paid_by → teachers
```

## 计费派生规则（纯函数，快照与重算共用同一实现）

对学生 s、周期 lessons、基准日 today：

- ⚠️ **today 是 `billing.ts` 纯函数的显式参数**：生产路径传真实当天日期（`new Date()` 派生的 YYYY-MM-DD），测试传固定值。**不要用 `REFERENCE_TODAY`**——那个常量只服务展示层相对日期文案（seed demo 稳定），billing 是真实账务逻辑，硬编码会导致生产上 attended/planned 永远按 2026-07-01 切分。
- 周期范围 `[minDate, maxDate]` = lessons 日期的 min/max。
- **attended_count**：范围内该班全部实际 `class_sessions`（限 `status='ended'`），逐节查 `session_memberships`——`present` 或 `madeUp=1` 计 1；学生不在该节快照里（中途入班前的课）计 0。
- **planned_count**：lessons 中 `date > today`，或 `date == today` 且该班当日尚无 session 的节次数（避免当天已上课重复计）。边界：当天排 2 节但只上了 1 节时，当天剩余那节计 0——规则的自然推论，接受（当天课不确定性本来就该由重算兜底）。**停课(suspended)/归档(archived) 学生 planned_count 强制 0**，只结已上部分。
- **computed_amount = unit_price × billable_count + addon_cents，但 billable_count == 0 时 computed = 0（附加费也不收）**——完全没参与周期的学生不该收书本费；billable > 0 的（含只上过几节的停课学生）附加费照加，个别不收的用最终金额覆盖。
- **建单学生范围**：当前 active 学生全量（billable=0 也建，未来要上课）∪ 周期内 attended>0 的非 active 学生。
- **重新计算**（`POST .../recalculate`）：只动 `pending` 收款单——刷新三个 count 与 computed（computed 用**该收款单自身的 unit_price**，即被覆盖过就按覆盖值算）；`adjusted=1` 的保留 final_amount/note（UI 标黄提醒）；给漏掉的学生（新入班等）补建收款单；`paid` 的一律不动；billable 变 0 的行保留不自动删（按上条规则 computed 归 0）。
- **确认收款**：置 `paid` + `paid_at`/`paid_by`；可 unconfirm 撤回 pending。
- **删除批次**：连带删收款单（有 paid 记录时前端二次确认）；周期解除占用可重新生成。删除课程周期要求先删其批次（409）。

## API（全部走现有 cookie 认证中间件，orgId 取自登录者，跨组织 404）

```
排班
  POST   /api/classes/:id/schedules      { name, lessons: [{date, startTime, endTime}] }
  GET    /api/classes/:id/schedules      列表（含节数、起止日期、是否已生成批次）
  PUT    /api/schedules/:id              { name?, lessons? } lessons 整套 replace（同分组 replace 风格）
  DELETE /api/schedules/:id              有批次 → 409

收费
  GET    /api/billing/batches            org 级列表（含汇总：人数/已收/待收金额，供收银台卡片）
  POST   /api/billing/batches            { scheduleId, unitPriceCents, addonCents?, addonNote? } → 单事务快照建全部收款单
  GET    /api/billing/batches/:id        批次详情 + 全部收款单行
  POST   /api/billing/batches/:id/recalculate
  DELETE /api/billing/batches/:id        连带删收款单
  PUT    /api/invoices/:id               { unitPriceCents?, finalAmountCents?, note? }（仅 pending；改了即 adjusted=1）
  POST   /api/invoices/:id/confirm       → paid + paid_at/paid_by
  POST   /api/invoices/:id/unconfirm     → pending
  GET    /api/invoices/:id/lessons       编辑弹窗逐节出勤明细（日期/时间/课堂标题/出勤态/是否计费），按需拉取
```

写操作进 `server/src/db/mutations.ts`（事务封装），与现有约定一致。

## Web 页面（mockup 已确认，见 `.brainstorming/`）

- **班级详情「排班」tab**（`/classes/:id?tab=schedule`）：周期列表（名称/起止/节数/批次状态）；新建/编辑进入**日历编辑器**：
  - 顶部时间刷：时间段 chips（如 08:00–10:00 蓝、15:00–17:00 橙，可加新段），当前刷高亮；
  - 月历翻页 + 点日 toggle（标当前刷时间；再点同时间取消；换刷点已选天=同天加第二节，重复时间则替换）；
  - 右侧已选节次清单（可逐条 ✕）+ 周期命名 + 创建/保存。
  - 编辑器状态抽 `web/src/lib/scheduleEditor.ts`（reducer + 派生，配 `.test.ts`）。
- **`/billing` 收银台**（顶部导航新增「收银台」）：批次卡片列表（班级+周期名、节数单价、收款进度条 n/m 与金额、筛选 全部/有待收款/已收齐）+「创建收款项」弹窗：选班级 → 选周期（已有批次的置灰注明；无排班给「去创建课程周期」链接）→ 单价 + 附加费（可选）→ 实时预售金额（全勤口径 × 人数）→ 生成后跳详情页。
- **`/billing/:batchId` 批次详情**：
  - 头部：班级+周期名、计划 n 节（已上 x / 未上 y）、单价、附加费、快照时间；汇总条（已收 n 人 ¥x / 待收 m 人 ¥y / 应收合计）；「重新计算」「删除收款项」。
  - 学生行：姓名（停课打标）| 已上到堂 x/y（含补 n）| 未上计划 | 计费节数 | 应收（调整过的原价划线 + 「改」标记）| 备注 | 状态（paid 显示确认时间）| 操作（编辑 · 确认收款 / 撤销）。
  - **编辑弹窗**：上半只读逐节出勤明细表（含排班外临时加课行、未上行标「按计划」计费）；下半：该生单价 × 计费节数 = 应收（自动）→ 最终收款金额（覆盖即高亮）→ 备注。
- 金额格式化 helper `web/src/lib/money.ts`（分 ↔ 元展示）。
- 计费派生纯函数放 **server** 侧 `server/src/lib/billing.ts`（快照/重算都在服务端算，web 不重复实现口径）。

## 实现顺序（TDD：每步先写测试）

1. **schema + migrate**：4 表 DDL 进 `ddl.ts` + `provision.migrate()` 幂等 ALTER/CREATE；seed 给三年级A班加一个示例周期（可选）。
2. **`server/src/lib/billing.ts`** 纯函数 + 单测：madeUp 计费、请假未补不计、停课 planned=0、中途入班、当天课去重、过去无 session 的排班日不计、范围内临时加课计入。
3. **排班 API**（先写 supertest 用例）：CRUD + replace + 删除守卫 + org 隔离 404。
4. **收费 API**（先写用例）：批次创建快照正确性（覆盖 2 中全部口径）、schedule_id 唯一约束（重复创建 409）、重算规则（pending-only / adjusted 保留 / 补建新学生 / billable 变 0 行保留且 computed 归 0）、invoice PUT 守卫（paid 不可改）、confirm/unconfirm、删除连带、org 隔离。
5. **web 排班 tab + 日历编辑器**（`scheduleEditor.ts` 先测后写 UI）。
6. **web 收银台 + 批次详情 + 编辑弹窗**。
7. **agent-browser 端到端**：登录 → 班级详情建周期（时间刷 + 点选多天）→ 收银台创建批次（单价+附加费）→ 详情页编辑一名学生（改最终金额+备注）→ 确认另一名学生收款 → 撤销再确认 → 重新计算 → sqlite3 断言 4 张表数据。

## 边界与不做（本期）

- 不做重复排课规则（每周六直到某天）——日历编辑器交互为其留了位（未来加「按规则批量生成节次」再手动微调），本期纯自由点选。
- 不做部分付款/分期，不做退款；收款渠道在系统外，系统只做台账。
- 不做收款单打印/导出、不做家长端（小程序）展示账单；`invoices` 面向老师端 web only。
- 权限沿用现状：org 内老师平权，无出纳角色。
- 金额一律整数分存储；**API 层也一律传分**（字段名带 `Cents` 后缀），元 ↔ 分换算只发生在 web 表单（`money.ts`），UI 输入以元为单位（可两位小数）。
