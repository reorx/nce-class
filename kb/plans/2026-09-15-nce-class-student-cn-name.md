---
created: 2026-09-15
tags:
  - plan
  - nce-class
  - student
  - modal
---

# NCE Class · 学生中文名 + 全局学生信息弹窗

> 状态：✅ 已实现（2026-09-22）。迁移在生产库副本上验证过：86 行完好、`en_name` 已删、`cn_name` 空列、二次运行幂等。

## Context

### 起因与现状核对

需求：为学生增加中文名属性；做一个全局弹窗组件，在学生名称出现的页面（`/classes/:id`、`/billing/:batchId`）名字旁加 ✎ icon，点开可改中英文名；并在这两个页面显示英文名的地方，下方小字显示中文名。

探索后发现一个**历史错位**，是本次设计的关键前提：

- `students` 表已有两列名字：`name`（NOT NULL，主名）与 `en_name`（可空）。原始设计意图是 `name`=中文名、`en_name`=英文名——小程序 join 表单收的就是 `cnName` 必填 + `enName` 可选，`mutations.linkJoinRequest` 也只回填 `en_name`。
- 但生产库（只读核对 2026-09-15）：**74 个学生的 `name` 全是英文名**（Lucy / Leaf / Rita / Martin / Tom …），`en_name` 有值的 **0 行**。即实际用法把模型用反了，`en_name` 是一列从未承载过数据的死列。

所以「加中文名」= 承认 `name` 已是英文名，补一列中文名，并清掉死列。

### 已定决策

1. **字段模型**：`students.name` 保持原样 = 英文名（NOT NULL，主显示名）；新增 `students.cn_name TEXT` 可空 = 中文名；**删除 `students.en_name`**（生产 0 行有值，无数据可保）。`join_requests` 表自己的 `cn_name`/`en_name` 两列**不动**（那是家长注册时的时点快照，另一回事）。
2. **关联回填**：`linkJoinRequest` 的回填目标从 `en_name` 改为 `cn_name`（源 `join_requests.cn_name`）。家长填的中文名正好落到学生中文名，链路自洽。
3. **wx payload**：学生对象里的 `enName` 改为 `cnName`（两处：老师端关联花名册、家长端自视图）。
4. **弹窗字段**：只有 英文名（必填）+ 中文名（选填）。不含手机号 / 状态 / 照片——状态已在卡片「⋯」菜单，照片只走小程序上传。
5. **✎ 触发点**：`/classes/:id` 学生卡片、`/billing/:batchId` 收款单行、StudentProfile 头部（**替换**现有的内联 `EditNameModal`）。分组卡片（拖拽源）、考勤页、课堂页不加。
6. **中文名小字**：班级学生卡片、收款单行、班级页分组 tab 成员卡片、StudentProfile 头部。考勤 / 课堂不加（座位卡空间紧凑 + 投屏 zoom）。
7. **顺带范围**：「添加学生」弹窗加中文名输入；班级页学生搜索框同时匹配中文名。

### 两个必须记住的技术点

- **`PUT /api/students/:id` 的兼容判定必须用 `'cnName' in req.body`**，不能用 `req.body?.cnName`。因为 `str()` 会把「没传这个 key」和「传了空串」都归一成 `null`，用后者的话，一个缓存着旧页面的标签页发一次 `{name}` PUT 就会把中文名静默清空。这是整个改动唯一的隐蔽正确性点。
- **学生名字全程没有任何快照**。审计过所有读路径：`session_tags.tag_name` 与 `session_groups.name` 是刻意的时点快照，但 recap（`sessionStudentDeltas`/`tagsOfSession`/`sessionRoster`）、编辑上课记录的 `ledger`、收款单的 `studentName` 全是**读时 JOIN students**。所以改名后刷新即对，不需要任何缓存失效逻辑；也意味着改名会改变历史 recap 的显示（这是既有行为，非本次引入）。

## 数据层

**`server/src/db/schema.ts`**（students，L81-98）
- 删 `enName: text('en_name')`，加 `cnName: text('cn_name')`（放在 `name` 之后）。
- `name` 注释改为「英文名，主显示名」。`joinRequests` 表不动。

**`server/src/db/ddl.ts`**（students CREATE TABLE，L36-43）
- `en_name TEXT,` → `cn_name TEXT,`。`join_requests` DDL（L50-56）不动。

**`server/src/db/provision.ts`** `migrate()` — 接在已有的 `studentCols` / status 判断之后，复用同一份 PRAGMA 快照：

```ts
// 中文名：name 事实上已是英文名（生产 74 行全英文），补一列 cn_name。
// en_name 从未写入过真实数据（生产 0 行非空），直接 DROP，不回填。
if (!studentCols.some((c) => c.name === 'cn_name')) {
  sqlite.exec(`ALTER TABLE students ADD COLUMN cn_name TEXT`);
}
if (studentCols.some((c) => c.name === 'en_name')) {
  sqlite.exec(`ALTER TABLE students DROP COLUMN en_name`);
}
```

两条都是 PRAGMA 守卫的幂等 ALTER，与该函数里其余迁移同构。`DROP COLUMN` 在本仓已有先例（`classes.level`，provision.ts L24-26），不是新招；不需要 `convertColumnToText` 那套 ADD→CAST→DROP→RENAME，因为没有值要保。

**`server/src/db/mutations.ts`**
- `renameStudent`（L130-132）改名为 `updateStudentInfo(sqlite, studentId, p: { name: string; cnName?: string | null })`，用动态 `sets`/`vals`（照抄 `updateSessionInfo` L380-415 的写法）：`cnName` 这个 key 缺席 = 不碰该列。
- `linkJoinRequest`（L207-234）回填 UPDATE：`en_name=COALESCE(en_name, ?)` → `cn_name=COALESCE(cn_name, ?)`，实参 `req.en_name` → `req.cn_name`；同步改 L211 的 docstring。

## 服务端 `server/src/app.ts`

**新增两个 payload helper**（放在 `classListPayload` 之前，与既有 `teacherItem`/`invoicePayload`/`sessionSummary`/`joinRequestItem` 同一批 mapper 并列）：

```ts
/** 学生身份三件套——任何提到学生的 payload 的最小集。以后再加名字类字段
 *  （拼音/昵称）只改这一处。入参行必须带 cn_name。 */
function studentIdentity(s: any) {
  return { id: s.id, name: s.name, cnName: s.cn_name ?? null };
}

/** 身份 + 写接口响应与班级花名册共用的三个侧面（对应 teacherItem 之于老师）。
 *  需要 resolved photoUrl（成长档案 / wx 自视图）或不要 source/status
 *  （wx 关联花名册）的站点直接 spread studentIdentity，不硬塞进这里。 */
function studentItem(s: any) {
  return { ...studentIdentity(s), source: s.source, status: s.status, hasPhoto: s.photo_url != null };
}
```

抽的理由：`{id,name,source,status,hasPhoto}` 这个形状现在在 app.ts 里手写了 5 遍（L394-402 / 1463-1465 / 1477-1483 / 1497-1503 / 1561-1567），本次 5 处都要动，抽的边际成本为零。

**SQL 改动（4 条）**
- `q.studentsOfClass`（L102-104）：列表加 `cn_name`。
- `q.attendanceStudentsOfClass`（L195-197）：加 `cn_name`（顺手，payload 带上但本次不做 UI）。
- `q.studentsWithLinkFlag`（L260-264）：`s.en_name` → `s.cn_name`。
- `q.invoicesOfBatch` / `q.invoiceWithStudent`（L277-285）：两条都加 `st.cn_name student_cn_name`。

**payload 改动**
| 站点 | 改法 |
|---|---|
| `classDetailPayload` students map（L394-402） | `{ ...studentItem(s), score, groupId }` |
| `invoicePayload`（L677-695） | 加 `studentCnName: r.student_cn_name ?? null`（4 个调用点自动生效） |
| wx 关联花名册（L1194-1207） | `{ ...studentIdentity(s), hasPhoto, linked }` |
| wx 家长自视图（L1307-1313） | `{ ...studentIdentity(st), photoUrl }` |
| `POST /classes/:id/students`（L1456-1466） | 收 `cnName`，响应 `{ ...studentItem(s), score: 0 }` |
| `PUT /students/:id`（L1469-1484） | 见下方契约，响应 `studentItem(...)` |
| `PUT /students/:id/status`（L1487-1504） | 响应 `studentItem(...)` |
| `GET /students/:id/profile`（L1561-1567） | `{ ...studentIdentity(st), source, status, photoUrl }` |
| 考勤 students[]（L1789-1799） | `{ ...studentIdentity(s), status }` |
| `classListPayload` roster（L328-361） | **不动**——它是 `string[]` 名字预览，从来就不是学生对象 |
| `buildRecap` / `buildOverview` / `sessionLedger` | **不动**——按名字 key 的战报结构，本次无需求 |

**`PUT /api/students/:id` 契约**

```ts
const name = str(req.body?.name);
if (!name) return res.status(400).json({ error: '学生姓名必填' });
const patch: { name: string; cnName?: string | null } = { name };
if ('cnName' in (req.body ?? {})) patch.cnName = str(req.body.cnName);
updateStudentInfo(sqlite, s.id, patch);
res.json(studentItem(q.studentById.get(s.id) as any));
```

- body 无 `cnName` key → `cn_name` 列纹丝不动（老页面安全网）
- `cnName` 为字符串 → `str()` 已 trim，空串/纯空白 → `null`（即清空）
- `cnName: null` → 清空
- 400 空 name / 404 未知 id / 跨 org——均不变

## web

**新建 `web/src/lib/studentName.ts` + 同名 `.test.ts`**（遵循「lib/ 均为纯派生并配测试」约定；否则本功能 web 侧零测试覆盖）

```ts
export interface StudentNameDraft { name: string; cnName: string }
export interface StudentNameLike { name: string; cnName?: string | null }

/** 校验并归一化弹窗草稿：英文名 trim 后为空 → error；中文名空白 → null。
 *  编辑弹窗与「添加学生」弹窗共用。 */
export function validateStudentNameForm(d: StudentNameDraft): { name: string; cnName: string | null } | { error: string };

/** 卡片/头部渲染用的主名 + 副名。副名在缺失、空白、或与主名相同时返回 null
 *  （避免 "Tom · Tom"）。头像首字母仍归 lib/theme.ts 的 initial()，不搬过来。 */
export function studentNamePair(s: StudentNameLike): { primary: string; secondary: string | null };
```

**新建 `web/src/components/StudentEditModal.tsx`** —— 全局 Provider + hook（对标已有的 `ToastProvider`/`useToast`）

```ts
export interface StudentEditTarget { studentId: string; name: string; cnName: string | null }
export function StudentModalProvider({ children }: { children: ReactNode }): JSX.Element;
export function useStudentModal(): (target: StudentEditTarget, onSaved?: () => void) => void;
```

- Provider 内部只挂**一个** `Modal` 实例，`open={!!target}`；两个输入框（英文名 autoFocus 必填 / 中文名「（选填）」）。
- 保存：`validateStudentNameForm` → `api.updateStudent(studentId, {name, cnName})` → `toast` → 关闭 → 调用打开时传入的 `onSaved`。
- **不自己 fetch**：三个触发点的页面 payload 里都已有 `id + name + cnName`。
- **不管刷新策略**：`onSaved` 由各页面传自己的 `reload()`，与该仓所有写操作「`await api.x(); await reload();`」的既有惯例一致。Provider 对三个页面零耦合。
- **只做编辑，不做新建**：「添加学生」仍用 ClassDetail 里原有的本地 Modal，只是多一个中文名输入框，两者共用 lib 的校验函数。这样 Provider 保持单一职责，不必为 create 引入 onSubmit 注入。

选 Provider 而非「每页各挂一个组件」的理由：三个触发点里有两个（`StudentCard` / `InvoiceRow`）在 `.map()` 循环内部，页面级组件方案要每页 hoist 一份 `editing` state 再把回调穿过循环；Provider 把这套 plumbing 全省了，与 ToastProvider 存在的理由同构。

**`web/src/App.tsx`**：`<ToastProvider>` 内层包一层 `<StudentModalProvider>`（L40/72 附近）。

**`web/src/lib/api.ts`**
- `Student`（L61-69）加 `cnName: string | null`。
- 新增 `export type StudentBasic = Pick<Student, 'id'|'name'|'cnName'|'source'|'status'|'hasPhoto'>`（对应服务端 `studentItem`）。
- `InvoiceItem`（L399-415）加 `studentCnName: string | null`。
- `StudentProfile.student`（L270-277）加 `cnName: string | null`。
- `AttendanceStudent`（L479-483）加 `cnName: string | null`（类型跟随，暂无 UI 消费）。
- `updateStudent`：`(id, p: { name: string; cnName?: string | null }) => req<StudentBasic>('PUT', ...)`。
- `addStudent`：收 `{ name, cnName }`，返回 `StudentBasic & { score: number }`。

**`web/src/pages/ClassDetail.tsx`**
- `StudentsTab`：`const editStudent = useStudentModal()`；搜索过滤（L376）改为同时匹配 `s.cnName`；「添加学生」内联 Modal（L612-635）加中文名输入框。
- `StudentCard`（L678-826）：加 `onEdit` prop，在既有 `⋯` 按钮（`top:9,right:8`）旁加一个同尺寸 ✎ 按钮（`right:38`）；名字 div（L795）下方渲染 `studentNamePair(s).secondary`。
- `GroupsTab`：分组内成员卡（L1056-1069）与未分组池（L1174-1177）——名字 `<span>` 包成纵向 stack，下方加副名。**不加 ✎**（拖拽源，且决策 5 未列入）。

**`web/src/pages/BillingBatch.tsx`**
- `InvoiceRow`（L235-337）加 `onEditStudent` prop（**与既有 `onEdit` 区分**——那个开的是「编辑费用」弹窗，两个入口视觉上必须能分辨，否则是真 UX bug）；姓名 td（L258-275）加 ✎ 按钮 + 下方副名。
- `onSaved` 传 `reload`（全量 `billingBatchDetail` 重拉）。不做乐观更新：`invoicesOfBatch` 是 live join，重拉天然正确且零合并逻辑，改名是低频操作，不值得引入客户端反范式化。

**`web/src/pages/StudentProfile.tsx`**
- 删掉 `EditNameModal`（L111-169）、`editOpen` state（L20）及其 JSX（L60-68），以及随之无用的 `fieldStyle`/`primaryBtn`/`ghostBtn`（L78-109）。
- 把 fetch `useEffect`（L22-28）抽成具名 `reload()`，供 useEffect 与 `onSaved` 共用。
- `Header`（L183-236）：`<h1>{s.name}</h1>`（L202）下方加副名。

**`web/src/lib/theme.ts`**（可选）：把 `StudentCard` 与 `InvoiceRow` 共用的 26×26 ✎ 图标按钮样式抽成 `editIconBtnStyle()`，避免两份复制。StudentProfile 头部那个是带文字的大按钮，保留本地。

## miniapp

- `miniapp/src/lib/api.ts`：`LinkableStudent.enName`（L122）与 `StudentHome.student.enName`（L137）→ `cnName`。两者目前都**没有任何 JSX 渲染**，是纯类型契约跟随，零 UI 风险。
- `miniapp/src/pages/teacher/class/index.tsx` 关联花名册（L175-179）：候选学生顺带显示中文名（`{s.name}{s.cnName ? ` · ${s.cnName}` : ''}`）。老师要把家长填的 `r.cnName` 匹配到花名册，显示中文名是实打实的改进。
- `JoinRequestItem`（L109-117）**不动**——那是 `join_requests` 自己的 cnName/enName。

## TDD 用例（先写红，再实现）

**`server/tests/provision.test.ts`** — 新 `describe('migrate: students.cn_name replaces en_name')`，对照既有「教材 columns are TEXT」块（L88-172）的写法：
1. 新库：`PRAGMA table_info(students)` 含 `cn_name`，不含 `en_name`。
2. 老库（手工建带 `en_name` 的旧 students 表 + 一行有值）：`migrate()` 跑两次 → `en_name` 消失、`cn_name` 存在且为 NULL（不回填）、`name`/`parent_phone`/`source` 原值保留、最终列集与新库一致。

**`server/tests/api.test.ts`** `describe('students')`（L200-258）：
3. 扩现有 rename 用例：同时发 `cnName`，断言 DB 行与 `GET /api/classes/c1` 都反映。
4. **兼容用例**：已有 `cn_name` 的学生，PUT 只发 `{name}`（无 cnName key）→ `cn_name` 原值不变（裸 SQL 断言）。
5. PUT 发 `{name, cnName: ''}` → 清成 `null`。
6. `POST /classes/:id/students` 响应含 `cnName: null`；带 `cnName` 创建则落库。

`describe('student growth profile')`（L907+）：
7. `GET /api/students/:id/profile` 的 `student.cnName` 反映已设的值。

**`server/tests/wx-queue.test.ts`**：
8. 「单事务：建 binding…」（L109-137）断言 `en_name: 'Harry'` → `cn_name: '浩浩'`（即 join body 的 cnName）。
9. 「回填不覆盖已有值」（L139-151）预置与断言由 `en_name='Kept'` 改 `cn_name='Kept'`。
10. `GET /api/wx/teacher/classes/:id/students` 返回 `cnName`（不再是 `enName`）。

**`server/tests/billing.test.ts`** `describe('invoices API')`（L383+）：
11. 预置某学生 `cn_name` → 收款单 `studentCnName` 正确、其余为 null；且 `PUT /api/students/:id` 改名后**不跑 recalculate**、直接重拉 `GET /api/billing/batches/:id` 即见新值（顺带把「live join 无快照」这个结论钉进测试）。

**`web/src/lib/studentName.test.ts`**（约 8 例）：
- `validateStudentNameForm`：两字段 trim / name 空白报错 / cnName 空白 → null / 正常透传。
- `studentNamePair`：无 cnName → null / cnName 为 null → null / 有值且不同 → 原样 / 空白 → null / 与 name 相同 → null。

## 构建顺序

1. `provision.test.ts` 两例（红）→ `schema.ts`/`ddl.ts`/`provision.ts`（绿）
2. `mutations.ts`：`updateStudentInfo` + `linkJoinRequest` 回填
3. server 测试 3-11（红）→ `app.ts` 两个 helper + 4 条 SQL + 9 处 payload（绿）→ `pnpm --filter server test` + `tsc --noEmit`
4. `pnpm db:reset` 重建 dev 库，重启 dev server
5. `studentName.test.ts`（红）→ `studentName.ts`（绿）
6. `lib/api.ts` 类型 → `StudentEditModal.tsx` → `App.tsx` 挂载
7. 接入 StudentProfile（最简单，1:1 替换旧弹窗）→ ClassDetail → BillingBatch
8. `pnpm --filter web test` + `tsc --noEmit`
9. miniapp 类型 + 关联花名册显示 → `tsc --noEmit`
10. 真实老库迁移验证：拷一份现有 `server/data/app.db`，跑 `db:migrate`，`PRAGMA table_info(students)` 断言 `cn_name` 在、`en_name` 没了、行数与 name 值不变
11. agent-browser 三入口全流程（班级卡片 ✎ / 成长档案头部 ✎ / 收款单行 ✎，验证副名出现在 4 处、搜索能搜中文名、分组 tab 有副名、考勤与课堂**没有**副名），截图归档 `tmp/2026-09-15-student-cn-name/`
12. 更新 AGENTS.md「须知/约定」补一条学生姓名口径，然后 commit

## 实施后需同步 AGENTS.md

- 须知加一条：**学生姓名** —— `students.name` = 英文名（必填、主显示、头像首字母取它），`students.cn_name` = 中文名（可空，卡片/收款单/分组/成长档案下方小字显示）。`en_name` 已于 2026-09-15 删除，`join_requests` 的 cn_name/en_name 是另一张表的注册快照，勿混。`PUT /api/students/:id` 用 `'cnName' in body` 判定，缺 key 不动列。
- web 结构段 `lib/` 补 `studentName`；`components/` 提一句全局 `StudentModalProvider`。
