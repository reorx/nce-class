---
created: 2026-09-15
tags:
  - plan
  - nce-class
  - admin
  - permissions
---

# NCE Class · 添加老师挪到 /admin，接口只允许管理员调用

> 状态：已实现（2026-09-15）。前置：`2026-09-12-nce-class-admin-page.md`（/admin 管理页、`is_admin`、改密收口）。

## Context

- 现状：`POST /api/teachers` **任何登录老师都能调**，/teachers 页也有「添加老师」按钮和弹窗。新建出来的账号能看到全校班级和学生，这其实是授权操作，却没有任何权限分层。
- 上一轮 /admin 已把「改密」收给了管理员，这次把「添加老师」也收过去。
- 已定：**不复核管理员密码**（用户确认），只靠 `/api/admin` gate（`is_admin` 每次请求随 teacher 行重读，CLI 撤销下一次请求即生效）。新账号固定 `role='teacher'`、`is_admin=0`，页面仍然无法提权。

## 服务端 `server/src/app.ts`

1. **删除** `POST /api/teachers`，不留 403 兼容桩。旧的缓存页面再调会拿到 express 默认 404（没有 SPA/static 兜底），web `req()` 抛 `ApiError` 并 toast。它不会出现静默成功或静默丢数据，所以用不着像 PUT 改密那样专门留一个 403 桩。
2. 新增 **`POST /api/admin/teachers`**（admin gate 之后），body `{name, username, password}`，按顺序校验：
   - name/username trim 后为空 → 400
   - password 少于 `MIN_PASSWORD_LENGTH` 位 → 400（原来的字面量 6 已换成常量）
   - 用户名跨 org 已存在 → 409 `用户名已被使用`
   - 通过后调 `mutations.createTeacher`（未改），返回 201 `teacherItem`
3. 更新注释：teachers 区块改为「列表 + 改名」；admin 区块写明删除/改密要复核密码、添加只过 gate。

## Web

- `lib/api.ts`：`createTeacher` 改为 `adminCreateTeacher({name, username, password})`，归入 admin* 分组。
- `lib/admin.ts`：新增 `addTeacherFormValid({name, username, password})`，配有测试。
- `pages/Admin.tsx`：
  - 页面副标题改为「仅管理员可见 · 删除班级、修改密码需再输入一次你的登录密码」。
  - 「修改成员密码」区块改名为「成员账号」。`SectionHead` 加可选 `action`，右侧放绿色「+ 添加老师」按钮。
  - 新增 `AddTeacherModal`：姓名；用户名（mono，`autoComplete="off"`）；初始密码（明文 mono，方便转告）。弹窗里没有 `type=password` 框，浏览器就不会把管理员自己的账号自动填进来。
  - 400/409/403 都用服务端文案 toast，弹窗保持打开、已填内容保留。成功后 toast，关闭弹窗并 `reloadTeachers()`。
- `pages/Teachers.tsx`：删掉添加按钮、弹窗和相关 state。副标题管理员看到「添加老师、修改密码请到**管理页**」（`Link` 到 /admin），非管理员看到「…请联系管理员」。改名不变。

## 测试（TDD，先红后绿）

- `server/tests/api.test.ts`：
  - 新增 helper `addTeacher(agent, p?)` 调 `POST /api/admin/teachers`，原先用 `POST /api/teachers` 建 lifang 的 fixture 全部改用它。
  - `teachers`：旧 `POST /api/teachers` 对管理员、非管理员都是 404，不建行；未登录只再断言 GET 401。
  - `admin`：
    - 未登录 401，非管理员 403 `需要管理员权限` 且不建行
    - SQL 撤销 `is_admin` 后添加 403
    - 创建成功：201，落在管理员所在 org，`role=teacher`、`is_admin=0`，立即可登录；**body 不带 adminPassword 也 201**
    - 409（同 org / 跨 org）、400（空姓名 / 空用户名 / 短密码）都不建行
  - 实现前 12 个用例红，实现后全绿。
- `web/src/lib/admin.test.ts`：`addTeacherFormValid`（实现前红）。

## 验证结果

- server 280/280、web 252/252 全绿；server/web `tsc --noEmit` 通过。
- curl（dev 库）：wangli `POST /api/teachers` → 404；chenxiao `POST /api/admin/teachers` → 403 `需要管理员权限`；两者都没写库。
- agent-browser（截图 `tmp/2026-09-15-admin-add-teacher/`）：
  - wangli 的 /teachers 没有添加按钮，副标题带管理页链接
  - /admin「成员账号」→ 添加老师，填 `chenxiao` 弹 409 toast、弹窗保留；换成 `ceshijia` → 成功 toast、列表出现
  - sqlite 断言新行 `org-chenguang / teacher / is_admin=0`，并有 password credential
  - 退出后用 ceshijia 登录：顶导没有「管理」，/teachers 没有添加按钮、副标题是「请联系管理员」，/admin 显示无权限

## 实施偏差（相对原 plan）

- 截图目录和本存档的日期按实际执行日用 2026-09-15（原 plan 写的是 09-12）。
- 409/400 用例额外断言了服务端文案（`用户名已被使用`、`密码至少 6 位`）。
- 上线影响：部署后非管理员老师不能再添加老师。生产目前只有 reorx 一个管理员，需要加人时走 /admin 或 `create-teacher` CLI。
