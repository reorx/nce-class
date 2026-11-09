---
created: 2026-11-09
tags:
  - attendance
  - makeup
  - web
  - server
---

# 补课记录：登记每次补课的日期、时长，并抵扣学生缺的课

## PRD

### 背景

学生请假或缺课后，老师会另找时间给他补课。现在考勤页只能在某一格里打开「已补课」开关，这样记不下补课在哪天、补了多久，也看不出一次补课覆盖了哪几节课。

插班生的问题更突出：中途入班的学生可能错过了学期初的五六节课，老师通常一两次就补完。这些课在考勤表上显示为「未在班」，现在没有任何办法把它们标成已补，更没法逐节去开开关。

老师需要一份真正的补课台账：每次补课单独记一条，写清日期、时长，以及抵扣了学生缺的哪几节课。考勤表上要能直接看出哪些缺的课已经补上了。

### 目标

老师可以登记一次补课：哪天、给哪个学生、补了多长时间、抵扣了班上哪几节他没到堂的课。之后能查看、修改和删除这些记录。考勤表上被抵扣的课显示为打勾，出勤统计和收费参考也按「已补」计算。

### 功能与交互

#### 1. 考勤页的两个视图

考勤页顶部（班级名与「考勤」标题那一行）增加「出勤表 / 补课记录」切换，默认是出勤表。出勤表就是现在的考勤网格。切换视图后刷新页面，仍停在当前视图。

#### 2. 补课记录视图

- 列表按补课日期从新到旧排，同一天的按登记时间从新到旧。每条显示这些信息：
  - 补课日期（月/日 + 周几）
  - 学生英文名
  - 时长，例如「60 分钟」；时长为空时显示「未记录时长」
  - 抵扣的课：逐节列出上课日期和第几课，例如「9/2 L12 · 9/5 L13」，共几节
  - 备注，没写就不显示
  - 登记老师
- 列表上方有学生筛选下拉，选项是「全部学生」加上班里的学生，以及有补课记录的已归档学生（这类学生名字后注「已归档」）。
- 右上角有「+ 登记补课」按钮。
- 点某一条打开编辑表单，表单里可以删除这条记录。
- 空状态：「还没有补课记录」，下面放「登记补课」按钮。筛选某个学生后没有记录时，显示「该学生还没有补课记录」。
- 某条记录抵扣的课全部被解除后（见第 6 点），在「抵扣的课」一栏显示醒目提示「未抵扣任何课」。
- 加载失败时和考勤页一样显示错误和重试按钮。

#### 3. 登记 / 编辑补课表单（弹窗）

表单字段从上到下：

| 字段 | 规则 |
|---|---|
| 学生 | 必选，可选的是本班未归档的学生（在读、停课），只显示英文名。编辑已有记录时不能换学生 |
| 补课日期 | 必填，默认今天，可以改成任意日期 |
| 时长（分钟） | 必填，正整数，上限 600。有 30 / 45 / 60 / 90 / 120 快捷按钮，也可以手填。从旧数据迁移来的记录时长为空，编辑时可以补填；补填之后就不能再清空 |
| 抵扣的课 | 至少勾选一节，列表见下文 |
| 备注 | 可选，多行文本，比如补了哪些内容 |

「抵扣的课」列表：选好学生后，列出本班已经上完的课里，这个学生没到堂、也还没被别的补课记录抵扣的那些节，按上课日期从早到晚排。每行显示：

- 上课日期（月/日 + 周几）
- 第几课和课题
- 该生当时的状态标签：缺勤、请假，或者「未在班」（插班前、停课期间）

列表顶部有「全选」。没有可抵扣的课时显示「该学生没有可抵扣的缺课」，此时保存按钮不可用。编辑已有记录时，这条记录当前抵扣的课也在列表里，处于勾选状态，可以取消勾选。

保存时任何一项不满足要求，就在对应字段下方提示，表单不关闭。保存成功后弹窗关闭，列表和出勤表马上更新。保存失败时用 Toast 提示，表单内容保留。

如果保存时某节课已经被另一条记录抵扣了（例如另一个页面刚刚登记过），提示「有课程已被其他补课记录抵扣，请重新选择」，同时刷新可选列表。

#### 4. 从出勤表的格子发起登记

点开出勤表里的格子会弹出弹窗。弹窗里原来的「登记补课」开关去掉，改为下面的行为：

- **缺勤、请假格子，还没被抵扣**：补课区域显示「登记补课」按钮。点击后打开第 3 点的表单，预选这个学生，并勾选这节课。
- **未在班格子**：以前点不开，现在也能点开，但只有补课区域，不能改出勤状态，说明文字是「该生当天未在班」。没被抵扣时显示「登记补课」按钮，行为同上。
- **已被抵扣的格子**：补课区域显示「已通过 11/3 补课抵扣 · 60 分钟」，有「查看补课记录」按钮，点击打开那条记录的编辑表单。
- **到勤格子**：照旧显示「已到勤，无需补课」。

#### 5. 出勤表里的显示

- 被抵扣的格子显示 ✓，右上角加一个蓝色小角标「补」，底色用现在补课格子的浅蓝，和真正到勤的绿色 ✓ 区分开。
- 鼠标悬停时，提示里显示原来的状态和补课信息，例如「9/2 · 缺勤（已补课 · 11/3 补 60 分钟）」或「9/2 · 未在班（已补课 · 11/3 补 60 分钟）」。
- 图例里「补」那一项改成「补课抵扣（计入出勤）」，图标用带角标的 ✓。
- 提示栏文案改为「点击任意格子可更正出勤记录或登记补课」。
- 「插班」标签照旧按该生第一次在班的日期判断，不受补课影响。

#### 6. 改成到勤时自动解除抵扣

- 在出勤表里把一个已被抵扣的格子改成到勤，会先弹出二次确认：「这节已通过 11/3 补课抵扣，改为到勤将解除抵扣，确定吗？」确认后，格子变为到勤，这节课从那条补课记录里移除。
- 缺勤和请假之间互相切换，不影响抵扣。
- 编辑上课记录时，如果把某个已被抵扣的学生改成到堂，这节的抵扣自动解除，不再另外确认。
- 补课记录里的课全部被解除后，这条记录仍然保留，显示「未抵扣任何课」，由老师自己去编辑或删除。
- 出勤表的「撤销」只撤销出勤状态的修改，不会把解除的抵扣恢复回来。

#### 7. 删除

在编辑表单里点「删除这条补课记录」，二次确认：「删除后，它抵扣的 N 节课将恢复为原状态，确定吗？」删除后，这些格子恢复成原来的缺勤、请假或未在班。

#### 8. 统计、收费与导出口径

- **出勤率**：缺勤、请假的课被抵扣后算作实到，和以前的「已补课」一样。未在班的课被抵扣后，应上和实到都加 1；没被抵扣的未在班课照旧不计入，不会拉低出勤率。每行悬停的统计里「补课 N」是该生被抵扣的节数。
- **收费**：收款项里的「已上到堂」把被抵扣的课算作到堂，包括插班前被抵扣的课。它和以前一样是快照，只在生成或重置收款项时刷新。收款单编辑弹窗的逐节出勤里，被抵扣的课显示为「已补课」。应收金额不受影响。
- **导出 CSV**：被抵扣的格子写成「缺勤（已补课）」「请假（已补课）」「未在班（已补课）」。
- 战报、成长档案、小程序里的出勤都只看上课当天，不受补课影响。

#### 9. 旧数据迁移

线上现有的「已补课」标记（目前 11 个格子）在升级时自动转换：每个格子生成一条补课记录。补课日期取那节课的上课日期，时长为空（显示「未记录时长」），备注写「由旧版「已补课」标记转换」，登记老师取那节课的上课老师。转换后，这些格子在出勤表、统计和收费里的表现与转换前一致。

#### 10. 删除学生、删除班级

删除学生时，他的补课记录一并删除；删除班级时，全班的补课记录一并删除。

### 不做的事

- 战报、成长档案、小程序里不显示补课
- 补课不另外计费，也不算课时费
- 一条记录不能登记多个学生（几个学生一起补课时，每人各登记一条）
- 一节缺的课不能分给几次补课分摊抵扣
- 不按补课时长自动推算能抵扣几节课
- 不能抵扣还没上（未结束）的课
- 补课记录不进出勤表的撤销历史
- 不单独导出补课记录

### 验收标准

1. 考勤页能在「出勤表」和「补课记录」之间切换，刷新后仍停在当前视图。
2. 能登记一条补课记录（学生、日期、时长、勾选一节或多节缺的课、备注），保存后马上出现在列表里，日期、学生、时长、抵扣的课、备注、登记老师都显示正确。
3. 可抵扣的课只包括本班已上完、该生没到堂（缺勤、请假、未在班）、并且还没被其他记录抵扣的课。到勤的课和已被抵扣的课都不出现。
4. 没选学生、没勾课、时长为空或不是正整数时，表单不能保存，并且有提示。
5. 插班生开学前未在班的几节课，能在一条记录里一起抵扣。抵扣后出勤表里这些格子显示带「补」角标的 ✓，该生出勤率的应上和实到都相应增加。
6. 缺勤、请假的格子被抵扣后显示带「补」角标的 ✓，并计入实到。
7. 点开没被抵扣的缺勤、请假、未在班格子，能看到「登记补课」按钮。点击后打开表单，已经预选了这个学生和这节课。
8. 点开已被抵扣的格子，能看到补课日期和时长，并能打开那条记录。
9. 能编辑记录的日期、时长、备注和抵扣的课。取消勾选的课在出勤表里恢复原来的状态。
10. 删除记录要二次确认，删除后被抵扣的格子恢复原状态。
11. 把已被抵扣的格子改成到勤时会先确认，确认后这节课从记录里移除。记录本身还在，课全部移除后显示「未抵扣任何课」。
12. 编辑上课记录、把被抵扣的学生改成到堂之后，这节课的抵扣自动解除。
13. 一节课不能同时被两条记录抵扣，并发登记时后保存的那条会收到提示。
14. 升级后，线上原来的 11 个「已补课」格子仍显示为已补，补课记录列表里出现对应的 11 条「未记录时长」记录。
15. 收款项重置后，「已上到堂」把被抵扣的课算在内；收款单编辑弹窗里，这些课标为「已补课」。
16. 导出的 CSV 里，被抵扣的格子带「（已补课）」。
17. 删除学生或班级后，相关的补课记录一并删除。

## Tech Design

### 现状

- **补课标记**：`session_memberships.made_up`（0/1，`server/src/db/schema.ts` 的 `sessionMemberships.madeUp`；`provision.migrate()` 里有补列的 ALTER 块），只对缺勤、请假有意义。写入入口只有 `PUT /api/sessions/:id/attendance/:studentId`（`server/src/app.ts`，body `{status, madeUp}`，改回 present 时清零）→ `mutations.setAttendance`。
- **没有快照行的格子**：插班前、停课期间的课，该生在 `session_memberships` 里没有行。考勤网格显示为「未在班」(`·`)，不能点开，也不计入出勤率（`web/src/lib/attendance.ts` 的 `rowStats` 遇到 `status == null` 直接跳过）。
- **读取方**：
  - 考勤：`GET /api/classes/:id/attendance`（`q.attendanceSessionsOfClass` / `attendanceStudentsOfClass` / `attendanceRecordsOfClass`），返回 `records[].madeUp`。
  - 计费：`billingInputsOfClass()` → `server/src/lib/billing.ts` 的 `computeAttendedCount`（present ‖ madeUp=1），批次快照和重算都用它。
  - 收款单逐节明细：`GET /api/invoices/:id/lessons` 的 `rows[].madeUp`，`web/src/pages/BillingBatch.tsx` 显示「已补课」。
  - 编辑上课记录：`mutations.overwriteSession` 先把 leave / made_up=1 的行收集成 `corrections`，再交给 `writeSessionLedger` 恢复，前提是新 payload 里该生仍未到堂。
  - 删除上课记录：`mutations.deleteSession`。删除学生：`deleteStudent`。删除班级：`deleteClass`。
- **Web**：
  - `web/src/api/attendance.ts`：DTO 与请求函数。
  - `web/src/queries/attendance.ts`：查询、按格 pending overlay、按格防重；`AttendanceCellBusyError`。
  - `web/src/queries/cache-effects.ts`：`attendanceUpdated` 精确回写一格；如果整表 GET 正在途中就重启它。
  - `web/src/pages/ClassAttendance.tsx`（978 行）：网格、格子弹窗（「登记补课」开关）、撤销、导出。
  - `web/src/lib/attendance.ts`：`rowCells` / `rowStats` / `rowTag` / `buildAttendanceCsv`。
- **线上数据**（2026-11-09 只读查询）：`made_up=1` 共 11 行（启航班 8、六年级 3），请假 0 行，未到堂 115 行。

### 方案

新增两张表：`makeup_records`（一条补课）和 `makeup_record_sessions`（这条补课抵扣了哪几节课）。抵扣按 (session_id, student_id) 记录，不挂在快照行上，所以「未在班」（没有快照行）的课也能抵扣。

一个格子算「已补」的条件是：该 (session, student) 有抵扣记录，并且该生在这节课不是 present。
- 由服务端保证：任何把该生变成 present 的写入（考勤更正、编辑上课记录），都在同一事务里删掉这条抵扣。
- 读侧也按这个条件判断，不依赖上面的保证。

考勤页的补课数据放进现有考勤接口：`GET /attendance` 的响应增加 `makeups`。出勤表和补课记录视图共用这一份缓存，写后只维护一个 key。可抵扣列表、覆盖关系、统计都在 `web/src/lib/makeup.ts` 里由纯函数派生。

旧 `made_up` 在迁移里转成补课记录，然后清零，代码不再读写这一列。

关键决策：

- **抵扣以 (session, student) 为键，不用 membership id**：编辑上课记录会删掉全部快照行再重插，membership id 会变；而且「未在班」的课根本没有快照行。
  - 否决：在 `session_memberships` 上加 `makeup_id`。原因同上，未在班的课无处挂。
- **数据库约束保证一节课只被抵扣一次**：`makeup_record_sessions` 上建 `UNIQUE(session_id, student_id)`，表里冗余存一列 student_id。
  - 业务检查在 `app.ts` 里先做，冲突返回 409。better-sqlite3 是同步调用，同一个请求处理函数里的「检查 + 写入」不会被别的请求插进来，唯一索引作为兜底。
- **补课数据并入考勤接口，不另开 `/makeups` 读取接口**：
  - 两个视图本来就要同时用到场次、名单、出勤和补课；一个 key 就不会出现两个缓存互相不一致。
  - 补课数据量很小，每个班几十条。
  - 否决：独立的 `makeupKeys`。这样每次写后要同时维护两份缓存，考勤格自动解除抵扣时还要跨 key 同步。
- **旧列清零但不 DROP**：转换和清零放在同一个事务里，以「存在 made_up=1 的行」作为是否执行的条件，所以可以重复运行。
  - 保留这一列，是为了回滚到上一版镜像时，旧代码的 SQL 不会因为列不存在而报错。
  - 新库的 DDL 不再包含这一列。drizzle schema 去掉 `madeUp` 字段，代码里不能再出现 `made_up`（迁移代码除外）。
  - 否决：保留开关和补课记录两套并存。用户已经决定只保留一套。
- **改到勤自动解除抵扣，放在服务端同一事务里**：
  - `PUT attendance` 改成 present 时删掉对应的抵扣行，响应里带 `unlinkedMakeupId`，前端据此精确更新缓存。
  - `overwriteSession` 写完新账本后，删掉本节所有 present 学生的抵扣行。
  - `deleteSession` 删掉本节的全部抵扣行。
  - 抵扣全部解除后，补课记录本身保留（PRD 第 6 点）。

### 数据变动

`server/src/db/ddl.ts` 新增表；`server/src/db/schema.ts` 加对应的 drizzle 定义，带中文注释：

```sql
CREATE TABLE IF NOT EXISTS makeup_records (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  date TEXT NOT NULL,              -- 补课日期 YYYY-MM-DD
  duration_minutes INTEGER,        -- 1..600；NULL 仅限旧「已补课」标记迁移来的记录
  note TEXT,
  created_by TEXT,                 -- teacher id；迁移记录取原课 teacher_id
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_makeup_records_class ON makeup_records(class_id);
CREATE TABLE IF NOT EXISTS makeup_record_sessions (
  makeup_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  student_id TEXT NOT NULL,        -- 冗余 = makeup_records.student_id，供唯一约束
  PRIMARY KEY (makeup_id, session_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_makeup_session_student
  ON makeup_record_sessions(session_id, student_id);
```

- `session_memberships` 的 DDL 去掉 `made_up` 列；`schema.ts` 去掉 `madeUp` 字段，`invoices.attendedCount` 的注释改为「present ‖ 已补课抵扣」。
- **迁移**（`provision.migrate()`）：删掉现有补 `made_up` 列的 ALTER 块，换成下面的转换块。
  - 只有在 `PRAGMA table_info(session_memberships)` 里有 `made_up`，并且存在 `made_up=1` 的行时才执行。整个转换在一个事务里完成：
    1. 对每一行 `made_up=1 AND attendance!='present'` 的 membership，JOIN `class_sessions` 取 class_id、date、teacher_id。
    2. 插入一条 `makeup_records`：id `mk-${nanoid(10)}`，date 取课日期，duration 为 NULL，note 为 `由旧版「已补课」标记转换`，created_by 取 teacher_id。
    3. 插入对应的 `makeup_record_sessions`。
    4. 最后执行 `UPDATE session_memberships SET made_up=0 WHERE made_up=1`。
  - 表 DDL 由 `sqlite.exec(DDL)` 先建好。
- **API 契约**：
  - `records[].madeUp` 删除。旧页面读不到这个字段时当作 false，不会报错。
  - `PUT attendance` 的 body 里如果带 `madeUp`，静默忽略。
  - 结束课堂的 commit payload 完全不动（遵守 AGENTS.md 的向后兼容纪律）。

### 逻辑变动

**server/src/db/mutations.ts**
- `setAttendance(sqlite, {sessionId, studentId, status})`：去掉 madeUp 参数，改为在一个事务里执行。
  - UPDATE attendance。
  - 如果 status 是 present，查出并删除该 (session, student) 的抵扣行。
  - 返回 `{ unlinkedMakeupId: string | null }`。
- 新增 `createMakeup(sqlite, {classId, studentId, date, durationMinutes, note, sessionIds, createdBy})`，返回 id。
- 新增 `updateMakeup(sqlite, id, {date, durationMinutes, note, sessionIds})`：改标量字段并更新 `updated_at`，抵扣行先删后插。
- 新增 `deleteMakeup(sqlite, id)`。
- 以上新增函数都包在事务里。
- `writeSessionLedger`：
  - `corrections` 类型去掉 madeUp，只恢复 leave 和座位；INSERT 不再写 `made_up`。
  - 更新函数头注释。
- `overwriteSession`：
  - 收集 corrections 的条件改为 `attendance='leave'`。
  - 在 `writeSessionLedger` 之后执行：`DELETE FROM makeup_record_sessions WHERE session_id=? AND student_id IN (SELECT student_id FROM session_memberships WHERE session_id=? AND attendance='present')`。
- `deleteSession`：同一事务里删除该节的 `makeup_record_sessions`。
- `deleteStudent`：先删 `makeup_record_sessions WHERE student_id=?`，再删 `makeup_records WHERE student_id=?`。
- `deleteClass`：在 statements 里按「先叶子后根」的顺序加两条：
  - 删 `makeup_record_sessions`：makeup_id 属于本班记录，或 session_id 属于本班，或 student_id 属于本班。
  - 删 `makeup_records`：`class_id=@classId`，或 student_id 属于本班。
  - `api.test.ts` 的 admin 残留扫描会覆盖这两张新表。

**server/src/app.ts**
- 新增预编译查询：
  - `makeupsOfClass`：JOIN students 取 name / status，LEFT JOIN teachers 取 name；排序 `date DESC, created_at DESC, rowid DESC`。
  - `makeupSessionsOfClass`：按场次 date / started_at 排序。
  - `makeupById`、`coverageOf(session_id, student_id)`。
- 新增 `makeupPayload()`，输出：
  ```ts
  { id, studentId, studentName, studentStatus, date, durationMinutes: number | null,
    note: string | null, createdByName: string | null, createdAt, sessionIds: string[] }
  ```
  其中 `sessionIds` 按上课日期从早到晚排。
- `GET /api/classes/:id/attendance`：records 去掉 madeUp，响应增加 `makeups`（包含已归档学生的记录）。`attendanceRecordsOfClass` 的 SELECT 去掉 `made_up`。
- `PUT /api/sessions/:id/attendance/:studentId`：
  - 忽略 body 里的 madeUp。
  - 响应改为 `{ sessionId, studentId, status, unlinkedMakeupId }`。
  - 按 AGENTS.md「新增写接口先加测试用例再实现」，先改测试。
- 新增 `POST /api/classes/:id/makeups`、`PUT /api/makeups/:id`、`DELETE /api/makeups/:id`：
  - 都要经过 `classInOrg`，跨组织返回 404。
  - POST 返回 201 + payload；PUT 返回 payload；DELETE 按 `DELETE /api/sessions/:id` 的写法返回 `{ ok: true }`。
- 三个写接口共用一个校验函数，失败返回 400 和中文 error：
  - `studentId`（只在 POST 时看）：必须是本班学生，并且 `status != 'archived'`。PUT 不允许换学生，body 里带了也忽略。
  - `date`：用 `DATE_RE` 校验。
  - `durationMinutes`：整数，范围 1..600。只有在 PUT、并且记录当前时长就是 NULL 时，才允许传 null。
  - `note`：用 `contentOrNull`，必须是字符串或 null。
  - `sessionIds`：非空数组，元素是字符串，不能重复。每一节都要满足：
    - 是本班 `status='ended'` 的课；
    - 该生这节课不是 present（没有快照行也算不是）。
- 冲突检查：如果任一 sessionId 已被其他记录抵扣（PUT 时排除本条），返回 409 `有课程已被其他补课记录抵扣，请重新选择`。
- 计费：
  - `billingInputsOfClass` 增加 `makeups: { sessionId, studentId }[]`，来自本班 `makeup_record_sessions`。
  - `GET /api/invoices/:id/lessons` 里每行的 `madeUp` 改为「有抵扣并且 attendance != present」，包括 attendance 为 null（未入班）的行。字段名保留 `madeUp`，前端少改。
- `q.billingMembershipsOfClass` 去掉 `made_up`。

**server/src/lib/billing.ts**
- `MembershipRecord` 去掉 `madeUp`。
- `computeAttendedCount`、`computeStudentCounts`、`buildBatchSnapshot` 增加参数 `makeups: { sessionId: string; studentId: string }[]`。
- 到堂 = present，或者 (session, student) 在 makeups 里。没有快照行但被抵扣的课也计 1。
- 同步更新注释和 `kb/docs/business-rules.md`。

**web/src/api/attendance.ts**
- `AttendanceRecord` 去掉 madeUp；`AttendanceInput` 只保留 `status`。
- 新增 `MakeupRecord`（字段同服务端 payload），`ClassAttendance` 增加 `makeups: MakeupRecord[]`。
- 新增 `AttendanceUpdateResult`，即 `AttendanceRecord & { unlinkedMakeupId: string | null }`。
- 新增 `MakeupInput { studentId?; date; durationMinutes: number | null; note: string | null; sessionIds: string[] }`。
- 新增 `createMakeup(classId, input)`、`updateMakeup(id, input)`、`deleteMakeup(id)`。
- `web/src/api/billing.ts` 里逐节明细的 `madeUp` 类型不变。

**web/src/lib/makeup.ts**（新增，配 `makeup.test.ts`；纯派生，UI 不放逻辑）
- `coverageMap(makeups)`：返回 `Map<recordKey, MakeupRecord>`。
- `makeupCandidates(data, studentId, editingId?)`：可抵扣的课，按日期从早到晚，每项是 `{ session, reason: 'absent' | 'leave' | 'off', checked }`。
  - 条件：该生这节课不是 present，并且没被抵扣，或者是被 editingId 这条抵扣的。
- `validateMakeupForm(draft, { durationRequired })`：返回字段级错误。
- `formatMakeupSessions(record, sessions)`：生成「9/2 L12 · 9/5 L13」这样的文案。
- `makeupListRows(data, studentFilter)`：列表行和学生筛选选项。筛选项 = 班级名单，加上有补课记录的已归档学生。
- 「未抵扣任何课」的判断：`sessionIds` 为空。

**web/src/lib/attendance.ts**
- `CellState` 改为 `{ status: AttendanceStatus | null; makeup: MakeupRecord | null }`。只有在 status !== 'present' 时，makeup 才可能非空。
- `rowCells` 增加 coverage 参数。
- `rowStats`：
  - `sched` 计入 `status != null || makeup`；
  - `pres` 计入 `present || makeup`；
  - `madeUp` 是被抵扣的节数；
  - absent / leave 照旧按 status 计。
- `rowTag` 照旧只看 status。
- `buildAttendanceCsv`：被抵扣的格子输出 `缺勤（已补课）`、`请假（已补课）`、`未在班（已补课）`。
- 同步更新 `attendance.test.ts`。

**web/src/queries/**
- `keys.ts`：`attendanceKeys` 增加 mutation key `makeup: () => ['attendance', 'makeup']`。
- `attendance.ts`：
  - `pendingRecordOf` 去掉 madeUp。
  - 新增 `useCreateMakeupMutation`、`useUpdateMakeupMutation`、`useDeleteMakeupMutation`：
    - 变量里带 classId；
    - onSuccess 调用 cache-effects；
    - onError 遇到 `ApiError.status === 409` 时，让该班考勤表失效。
  - 这三个 hook 加进 `inventory.test.ts` 的清单。
- `cache-effects.ts`：
  - `attendanceUpdated` 增加处理：`unlinkedMakeupId` 非空时，从缓存里那条 makeup 的 sessionIds 中移除本节。
  - 新增 `upsertMakeup(data, record)` / `removeMakeup(data, id)` 两个纯函数。
  - 新增 `makeupSaved(client, classId, record)` 和 `makeupDeleted(client, classId, makeupId, studentId)`。做法和 `attendanceUpdated` 一样：先重启在途的整表 GET，再精确回写 attendance 缓存；然后让 `billingKeys.invoiceLessonsAll()`（该生）和 `billingKeys.details()`（本班批次）失效。
  - 不触发收费重算。
  - `cache-effects.test.tsx` 的写后矩阵加 makeup 增、改、删三条，并验证 c2 不受影响。
- `web/src/api/contract.test.ts`：增加三条契约，并改掉 updateAttendance 里的 `madeUp`。
- `web/src/test-utils/fixtures.ts` 和 `cacheUniverse.ts`：fixture 去掉 madeUp，加上 `makeups: []`。

**web/src/pages/ClassAttendance.tsx 与新组件**
- 视图切换：读 `?view=makeups`（默认是出勤表），用 `useSearchParams`。在标题行「考勤」后面放分段切换。
- 新增 `web/src/components/MakeupList.tsx`：补课记录视图，包括筛选、列表、空状态、「+ 登记补课」。
- 新增 `web/src/components/MakeupFormModal.tsx`：复用 `components/Modal.tsx`。
  - 草稿在打开时建立，后台刷新不覆盖草稿。
  - 可抵扣列表用 `makeupCandidates` 实时派生；草稿里勾选、但已不在候选里的课，视为失效，自动去掉并提示。
  - 支持 `initial`（预选学生和场次）、`editing`（已有记录）两种入口。
  - 「删除这条补课记录」走二次确认。
  - 补课日期默认取浏览器当天的本地日期，先找 web/src/lib 里现成的 helper。
- 格子弹窗：
  - 去掉「登记补课」开关，按 PRD 第 4 点分四种情况渲染。
  - 「未在班」格子也能点开：没有状态按钮，只有补课区域。
  - 已被抵扣的格子点「到勤」时，先用确认弹窗（文案见 PRD 第 6 点），确认后再 `applyRec`。
  - 撤销历史照旧，只记录 status。
- 网格单元：被抵扣时显示 `✓` 加右上角「补」角标（蓝 `#2a75be`），底色 `#eef5fc`。title 按 PRD 第 5 点。
- 图例、提示栏文案按 PRD 第 5 点改。
- 删除 `toggleMakeup`，以及所有 madeUp 的读写。
- `BillingBatch.tsx` 逐节明细：`attendance == null && r.madeUp` 时显示「未入班」加「已补课」。

**文档**（和代码同一个提交）
- `kb/docs/business-rules.md`：重写「出勤与作业」里补课那一条：补课记录、抵扣规则、插班抵扣计入、改到勤解除。同时改「排班与收费」里「已上到堂」的口径；更新 `updated` 日期。
- `AGENTS.md`：
  - 页面与 API 的 query 参数里加一条 `/classes/:id/attendance?view=makeups`。
  - 「出勤」须知改写成：commit 只有 present / absent；leave 由更正产生；补课 = `makeup_records` 抵扣，以 (session, student) 为键，任何改成 present 的写入都在同一事务里解除抵扣；读侧用 `!== 'present'` 判断。
- `kb/docs/classroom-session-lifecycle.md`：编辑上课记录保留「请假」更正，不再提补课标记；抵扣的解除写进去。

### 实施步骤

- [ ] 1. **服务端测试先行**：在 `server/tests/api.test.ts` 和 `provision.test.ts` 里写下文「测试与验证」里服务端的全部用例，确认它们失败。`billing.test.ts` 的 madeUp 用例改成 makeups 参数。
- [ ] 2. **DDL / schema / 迁移**：新表；去掉 made_up；转换块。`pnpm --filter server test` 里的 provision 用例通过。
- [ ] 3. **mutations、billing.ts、app.ts**：按「逻辑变动」实现，服务端测试全部通过，`pnpm --filter server exec tsc --noEmit` 通过。
- [ ] 4. **Web 数据层**：api / lib(makeup、attendance) / queries / cache-effects，以及对应测试（先写 lib 和矩阵用例）。`pnpm --filter web test` 和 tsc 通过。
- [ ] 5. **Web UI**：视图切换、MakeupList、MakeupFormModal、格子弹窗、网格显示、BillingBatch 明细；页面级测试见下文。
- [ ] 6. **端到端验收**：`pnpm db:reset && pnpm dev`，用 agent-browser 走完下文的人工流程，截图存到 `tmp/2026-11-09-makeup-lesson-records/`。弹窗表单要用 `eval` 写法，见 `kb/docs/verification-guide.md`。
- [ ] 7. **文档**：business-rules、classroom-session-lifecycle、AGENTS.md。在 `kb/next-up.md` 加一条部署后核对（见「风险与待定」），写 session 总结。
- [ ] 8. **提交**：一个提交包含代码和文档，commit message 按 AGENTS.md 的格式写。**不要 push**，push master 即上线，要先问用户。

### 测试与验证

服务端（`server/tests/`），对应 PRD 验收标准的编号：

| # | 用例 |
|---|---|
| 2,3 | POST 成功：返回 201，payload 字段齐全；`GET attendance.makeups` 里出现这条记录，sessionIds 按日期排序，createdByName 是当前老师 |
| 3 | POST 拒绝以下情况：present 的课；未结束或别的班的 session；已归档学生；别的班的学生；跨组织（404）；sessionIds 为空或有重复 |
| 4 | POST 拒绝：缺 durationMinutes、0、601、小数、null；缺 date，或 date 格式非法 |
| 5 | 该生没有快照行的课（模拟插班）可以抵扣；`GET attendance` 里该格没有 record，但 makeups 覆盖了它 |
| 9 | PUT 改日期、时长、备注、sessionIds：去掉的那节不再被覆盖，新加的那节被覆盖；body 里的 studentId 被忽略 |
| 9 | 迁移来的 NULL 时长记录：PUT 传 null 可以；补填之后再传 null 返回 400 |
| 10 | DELETE 之后，记录和抵扣行都被删除 |
| 11 | 把已被抵扣的格子 `PUT attendance` 成 present：响应里 `unlinkedMakeupId` 是该记录；记录还在，sessionIds 变成 []。absent → leave 不解除抵扣 |
| 12 | `overwriteSession` 把被抵扣的学生改成 present：抵扣被解除；仍然缺席的学生，抵扣保留；请假更正照旧保留 |
| 13 | 第二条记录抵扣同一节课 → 409；PUT 本条、保留自己原有的课 → 200 |
| 14 | provision：构造一个旧库（带 made_up 列，有 made_up=1 的行），migrate 之后生成对应的记录（date 等于课日期、duration 为 NULL、note、created_by 都正确），made_up 全部为 0；再跑一次 migrate 不重复生成；新库没有 made_up 列，migrate 也不报错 |
| 15 | billing：插班前被抵扣的课和缺勤被抵扣的课都计入 attendedCount；`GET invoices/:id/lessons` 里被抵扣行的 madeUp 为 true |
| 17 | 删除学生、删除班级之后，两张新表里没有残留（admin 用例的全表扫描会覆盖）；deleteSession 之后，该节的抵扣行被删除 |
| — | 「向后/向前兼容」用例原样通过；旧格式的 `PUT attendance {status:'leave', madeUp:true}` 返回 200，并且不产生补课记录 |

Web：
- `lib/makeup.test.ts`：候选集（三种 reason；排除 present 和已被抵扣的；编辑时包含本条的课）、表单校验、文案、筛选项（含已归档学生）。
- `lib/attendance.test.ts`：rowStats 的口径（插班前被抵扣的课计入 sched 和 pres；没被抵扣的未在班课不计入）、rowTag 不受抵扣影响、CSV 输出。
- `queries/cache-effects.test.tsx` 矩阵：makeup 增、改、删回写 attendance 缓存，并让该生的逐节明细失效，c2 不受影响；`attendanceUpdated` 带 `unlinkedMakeupId` 时，从缓存里移除本节。
- 页面级测试（`renderApp` + 假 fetch，放在新建的 `ClassAttendance.test.tsx`）：
  - 切换到 `?view=makeups` 后显示列表和空状态；
  - 从缺勤格子点「登记补课」，表单预选了学生和这节课，保存后格子显示 ✓ 和「补」；
  - 已被抵扣的格子点「到勤」会弹确认；
  - 收到 409 时显示提示，并重新拉取。

人工 / agent-browser 验收（seed 里所有课都是到堂，测试数据现造）：
1. 登录 wangli，进三年级A班的考勤页。在某节课把学生 X 改成缺勤，另一节改成请假。
2. 在班级详情里新增一个学生 Y，回到考勤页：Y 整行都是「未在班」。
3. 切到「补课记录」：显示空状态。登记补课，学生选 Y，勾选最早的 3 节，时长点 60，填备注，保存。回到出勤表：这 3 格显示 ✓ 和「补」，Y 的出勤率是 3/3。
4. 点 X 的缺勤格 →「登记补课」→ 表单已预选，保存。格子变成 ✓ 和「补」，悬停提示正确。
5. 在补课记录列表里编辑 Y 的记录，取消勾选 1 节：这一格恢复成「未在班」。
6. 把 X 那一格改成到勤：弹出确认 → 确认 → 列表里 X 的记录显示「未抵扣任何课」。删除这条记录，二次确认。
7. 导出 CSV，检查里面的「（已补课）」。
8. 有排班和收款项的班级：重置收款项，打开收款单编辑弹窗，被抵扣的课显示「已补课」。
9. 跑完执行 `mac-dev-cleanup --only browser`。

### 风险与待定

- **迁移在线上执行一次**：部署后核对以下几点：
  - `SELECT COUNT(*) FROM makeup_records` 应为 11；
  - `SELECT COUNT(*) FROM session_memberships WHERE made_up=1` 应为 0；
  - 启航班、六年级的考勤页里，这 11 格仍然显示已补。
  
  这几项在实施步骤 7 里写进 `kb/next-up.md`。如果部署前老师又打开过开关，数量会多于 11，转换照样会覆盖到。
- **回滚**：回滚到上一版镜像不会报错，因为 made_up 列还在，只是被清零了。但旧版本看不到补课，11 格会显示成未补。重新部署后，迁移只会转换回滚期间新打开的开关。`made_up` 列的 DROP 留给以后单独迁移，这次不做。
- **部署时正开着的旧考勤页**：旧页面的开关请求会被服务端静默忽略，看起来没有生效。刷新页面后显示新界面。影响很小，接受。
- **`ClassAttendance.tsx` 已经接近 1000 行**：补课列表和表单必须拆成独立组件，页面只负责视图切换和格子弹窗的分支，避免继续膨胀。
- **date 不限制早于上课日**：PRD 允许任意日期。如果以后要禁止「补课日期早于所抵扣的课」，在 `validateMakeupForm` 和服务端校验里同时加。
