---
created: 2026-09-12
tags:
  - plan
  - nce-class
  - admin
  - permissions
---

# NCE Class · /admin 管理页：删除班级 · 修改成员密码

> 状态：已实现（2026-09-12）。顺带修复见 commit「修复 GET /api/classes 未按 org 过滤」，主体见 commit「/admin 管理页：删除班级 · 修改成员密码」。

## Context

- 现状：老师间无权限分层，`teachers.role`（owner|teacher）仅做展示。`PUT /api/teachers/:id`（/teachers 编辑弹窗）允许**任何同校老师改任何人的密码**；班级没有删除能力。
- 目标：新增 `teachers.is_admin`，仅管理员可进 `/admin` 做高危操作（删除班级、修改成员密码）。**服务端强制鉴权**，前端门禁只是展示层。
- 已定决策：①管理员**只用 CLI 授予**（迁移不回填，页面不能提权）②/teachers **彻底去掉改密**（改密只在 /admin 或 CLI）③删除班级 = **硬删除级联**（同 deleteStudent/deleteSession 口径）④二次确认 = **影响面 + 管理员密码**（服务端同请求复核，不输班级名）。

## 数据层

- `server/src/db/schema.ts` teachers 加 `isAdmin: integer('is_admin').notNull().default(0)`；`ddl.ts` 同步 `is_admin INTEGER NOT NULL DEFAULT 0`。
- `provision.migrate()`：列缺失时 `ALTER TABLE teachers ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`，**不回填**。
- `provision.setAdmin(sqlite, {username, isAdmin})`：未知用户名 throw，返回 `{teacherId}`。
- 新 CLI `server/src/db/set-admin.ts` + package.json script：`pnpm --filter server set-admin -- --username <登录名> [--revoke]`；不带/带错 username 时列出全部用户名及管理员标记（照抄 `reset-password.ts` 结构，先跑 `migrate`）。
- `create-teacher` 加 `--admin` 开关（`provision.createTeacher` 可选 `isAdmin`，默认 false），干净库开第一个账号一步到位。
- seed：`seed.ts` 与 `tests/helpers.ts` 的 `t-wangli` 设 is_admin=1（dev/测试用，非生产），其余 0。

## 服务端 `server/src/app.ts`

1. `mePayload()`（login 响应同源）加 `isAdmin: boolean`。抽 `teacherItem(t)` → `{id,name,username,role,isAdmin}`，GET/POST/PUT `/api/teachers` 三处共用。
2. **/teachers 改密收口**：`PUT /api/teachers/:id` body 带非空 `password` → 403 `修改密码请联系管理员`，整单不写（防缓存旧页面静默丢改密）；空/缺省照常改名。`mutations.updateTeacher` 收窄为 `renameTeacher(sqlite, teacherId, name)`（对齐 `renameStudent`）。
3. **admin gate**：全局 auth gate 之后 `app.use('/api/admin', …)`，`!res.locals.teacher.is_admin` → 403 `需要管理员权限`。`teacherById` 每请求查库 → CLI 撤销即时生效，不依赖无状态 cookie。
4. **管理员密码复核** helper：`q.credByTeacher` + `verifyPassword`（同 `/api/auth/verify-password` 口径），不符 403 `管理员密码错误`。
5. `GET /api/admin/classes`：本 org 班级 + 影响面计数（负责老师、学生[全部状态]、上课记录、排班周期、收款批次、已确认收款单数与金额），单条 SQL 相关子查询。
6. `DELETE /api/admin/classes/:id`（JSON body `{adminPassword}`）：跨 org/不存在 404 → 密码 403 → `deleteClass` → `{ok:true}`。
7. `PUT /api/admin/teachers/:id/password`（`{password, adminPassword}`）：跨 org 404 → `<6` 400 → 密码 403 → 复用 `provision.resetPassword`（缺 password credential 行会补建）。

## `mutations.deleteClass(sqlite, classId)` — 单事务硬删

以 `class_id` 及该班 students / class_sessions / billing_batches / class_schedules / class_groups 的 id 子查询为范围，叶→根删除：
`score_events`（session ∈ 班级课，或 target_type='student' 且 target ∈ 班级学生）· `session_memberships` · `check_records` · `session_tags` · `session_groups` · `class_sessions` · `invoices`（batch ∈ 班级批次，或 student ∈ 班级学生）· `billing_batches` · `schedule_lessons` · `class_schedules` · `class_group_memberships` · `class_groups` · `student_wechat_bindings` · `join_requests` · `class_invites` · `students` · `classes`。
不删：`org_tags`（org 级）、`wechat_accounts`（家长身份）、存储里的照片文件（与 `deleteStudent` 一致）。

## Web

- `web/src/lib/api.ts`：`Me.isAdmin`、`TeacherItem.isAdmin`、`AdminClassItem`；`api.adminClasses / adminDeleteClass(id, adminPassword) / adminResetPassword(id, password, adminPassword)`；`updateTeacher` 参数收窄为 `{name}`。
- `web/src/lib/admin.ts` + `.test.ts`：`deleteImpactLines(item)`（计数文案，金额复用 `lib/money.ts`）、`paidWarning(item)`（有已确认收款时的 ⚠️ 文案，否则 null）、`resetFormValid(password, adminPassword)`（≥6 且管理员密码非空）。
- `web/src/pages/Admin.tsx`（新）：`TopBar active="admin"`；`!me.isAdmin` 渲染「无权限」空态。两块：
  - **删除班级**：列表 + 计数 + 红色「删除」→ `Modal`：影响面清单 + paidWarning 高亮（沿用 `BillingBatch.tsx` 删除弹窗风格）+ 管理员密码框；403 就地提示「管理员密码错误」。成功 toast + 重载 + `clearSession(classId)` 清本机残留课堂。
  - **修改成员密码**：老师列表 → `Modal`：新密码（明文显示便于转告）+ 管理员密码。
- `web/src/pages/Teachers.tsx`：编辑弹窗删掉「新密码」输入与提示；列表加「管理员」小徽标；副标题「权限暂不细分」改为「修改密码请联系管理员」。
- `web/src/App.tsx` 加 `/admin` 路由；`TopBar` 的 `active` 联合类型加 `'admin'`，`me?.isAdmin` 时显示「管理」入口。

## TDD 顺序（先写测试再实现）

1. `server/tests/provision.test.ts`：migrate 加列、默认 0、复跑幂等；`setAdmin` 授予/撤销/未知用户名；`createTeacher` isAdmin；`set-admin` CLI 子进程用例（授予、`--revoke`、缺/错 username 列出用户名）。
2. `server/tests/api.test.ts`：
   - `auth`：login/me 带 `isAdmin`（wangli true，现建 lifang false）。
   - `teachers`：改写「改密」用例 → 带非空密码 403 且名字与密码都未变；删去 400 用例里的短密码行；响应 `toEqual` 补 `isAdmin`。
   - 新 `describe('admin')`（非管理员用 `POST /api/teachers` 现建 lifang，避免改 helper seed 破坏既有计数）：非管理员 403 / 未登录 401 / SQL 撤销后即时 403；`GET /api/admin/classes` 只含本 org 且计数正确；删除班级——c1 先经 API/SQL 补齐排班、批次、已确认收款单、邀请、join_request，删除后**泛化残留断言**：逐表用 `PRAGMA table_info` 找 `class_id/student_id/session_id/batch_id/schedule_id/class_group_id/session_group_id/linked_student_id/target_id/invite_id` 列，断言不引用任何被删 id（未来新表漏删会自动挂）；c-out 完好；跨 org 404；密码错 403 且数据不动。改密：新密码可登录、旧失效、他人不受影响；<6 400；跨 org 404；密码错 403。
3. `web/src/lib/admin.test.ts`。
4. 实现 → `pnpm --filter server test`、`pnpm --filter web test`、server/web `tsc --noEmit`。

## 顺带修复（单独 commit）

`GET /api/classes` 未按 org 过滤：`q.classes` 改为 `WHERE org_id=?`，`classListPayload(orgId)`。先加用例：waiguo（org-2）列表不含 c1、只含 c-out。

## 验证

- `pnpm db:reset && pnpm dev`；agent-browser：wangli 登录 → 顶导见「管理」→ /admin 删除一个班（先输错管理员密码看提示，再正确删除）→ 班级列表消失，sqlite3 断言该班残留为 0；改 chenxiao 密码 → 退出用新密码登录成功；chenxiao 顶导无「管理」、直访 /admin 显示无权限、curl `/api/admin/classes` 403；/teachers 编辑弹窗无密码框。
- CLI 冒烟：`pnpm --filter server set-admin -- --username chenxiao` 后刷新即见「管理」，`--revoke` 后消失。
- 截图归档 `tmp/2026-09-12-admin-page/`；用完 `agent-browser close` + `mac-dev-cleanup --only browser`。

## 收尾

- 更新 AGENTS.md（web 路由/页面、API 速览加 `/api/admin/*`、须知加管理员口径与「/teachers 不再改密」、部署节加 `set-admin` / `create-teacher --admin` 用法）；plan 存档本文件；更新 memory `nce-class-deploy.md` 的容器内 CLI 命令；commit。
- ⚠️ 上线提醒：迁移不回填，**部署后生产没有任何管理员**，需在容器内 `docker compose exec app pnpm --filter server set-admin -- --username <登录名>`。指定谁、何时执行由用户确认后再操作。

## 实施偏差（相对原 plan）

- 残留断言遍历 `sqlite_master` 的全部表，而非导出 helpers 的 `TABLES`：新表即使没加进 reseed 列表也会被扫到，更贴合「未来新表漏删会自动挂」的目标。
- 引用列扫描额外包含各表自身的 `id` 列（班级/学生/课堂等行本身也算残留）。
- `AdminClassItem` 比 plan 多一个 `invoiceCount`（影响面文案「N 个收款批次（M 张收款单）」用）。
- `/api/auth/verify-password` 与管理员复核共用 `passwordMatches(teacherId, password)`，口径一处定义。
