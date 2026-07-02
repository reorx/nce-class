---
created: 2026-07-01
tags:
  - plan
  - milestone-1
  - nce-class
  - backend
  - wiring
---

# NCE Class · M1 班级管理页面「写操作」补齐 Plan

## 背景与目标

M1 阶段 1–2 已落地：班级列表 + 班级详情四页面，**读路径**全部对接真实后端（Express + SQLite，分数由 `score_events` 派生）。但所有**写操作**目前只有静态占位，没有后端接口、也没对接。

本 plan 覆盖：把这些管理页面的增删改做成真接口并对接，使班级管理成为一个可用的闭环（PRD §7.1）。本轮**一并做最小登录态**（PRD §4 自建认证，username+密码），因为写操作需要真实老师身份。**不含**课堂引擎写事件、成长档案、学生端 H5（属后续阶段）。

## 当前缺口清单

| 交互 | 位置 | 现状 |
|------|------|------|
| 新建班级 | `ClassList` | 按钮无 handler |
| 手动添加学生 | `StudentsTab` | 按钮无 handler、无 modal |
| 学生 ⋯ 菜单（查看档案 / 删除） | `StudentCard` | 按钮无菜单 |
| 疑似重复提示 banner | `StudentsTab` | 合并功能已砍 → banner 降级为纯提示，重复靠删除解决 |
| 拖拽调组 / 改组名 / 增删小组 / 未分组 | `GroupsTab` | 仅渲染 `draggable` 外观，无 drop、无持久化 |
| 查看 recap | `SessionsTab` | 按钮 no-op（后端已有 `lastRecapPayload` 派生逻辑，未开路由） |
| 复制邀请链接 | `InviteTab` | 已用前端 clipboard（无需后端） |
| 搜索 / 来源筛选 | `StudentsTab` | 已是前端内存过滤（可保留） |

## 后端接口设计（新增，全部带 orgId 校验）

统一约定：所有写接口成功返回受影响后的最新实体或 `{ok:true}`；前端写成功后重新 `GET /api/classes/:id` 刷新（分数/人数/分组均自动重算，无需前端手算）。多组织 M1 单校，但查询/写入都按 `orgId` 过滤，保持模式。**所有接口（除 `/api/auth/login`、`/api/health`）经认证中间件，写入用 `req.teacher`（见上「认证设计」）。**

### 班级
- `POST /api/classes` `{name, level?}` → 在当前 org 下建班，`teacherId` = 当前老师；返回新班级。

### 学生
- `POST /api/classes/:id/students` `{name}` → 建 `source=teacher` 学生，`photoUrl=null`，生成 `recapToken`（nanoid）；返回新学生。
- `DELETE /api/students/:id` → **硬删**（已定）：事务内连带删除该生的 `class_group_memberships`、`session_memberships`、`score_events`、`check_records`，再删 `students` 行。账本会失去该生历史（已接受）。
- ~~`POST /api/students/merge`~~ → **合并学生功能已砍**（已定）。疑似重复只保留提示 banner + `疑似重复` 角标，由老师用 ⋯ → 删除 解决重复。

### 默认分组（整套 replace 语义，匹配 PRD「保存即更新默认分组」）
- `PUT /api/classes/:id/groups` `{groups:[{id?, name, emoji, orderIndex, memberIds[]}]}` → 事务内重建该班默认分组：upsert `class_groups`、删除已移除的组、重写 `class_group_memberships`；未出现在任何组的学生即「未分组」。前端每次拖拽/改名/增删组后调用（幂等替换），无需单独「保存」按钮（还原 mockup 的即时保存交互）。

### Recap（读，补路由）
- `GET /api/sessions/:id/recap` → 把 `lastRecapPayload` 泛化到任意 session：各组组分排名（`score_events` 嵌套派生，§5）、🌟表现亮眼（本节净加分 ≥ 2）、⚠️被提醒（本节任一 −1），出勤 present/total。用于 `SessionsTab` 的「查看 recap」浮窗。

## 前端对接

`web/src/lib/api.ts` 增加：`login`、`logout`、`createClass`、`addStudent`、`deleteStudent`、`saveGrouping`、`getSessionRecap`（`post/put/del` 小工具 + 复用现有 `get`；`me()` 现在可能 401）。

- **认证（新）**：`/login` 页 + 顶层 auth guard（未登录重定向）+ TopBar 登出，详见上「认证设计」。

- **ClassList**：`新建班级` → modal（name + level）→ `createClass` → 刷新列表 + toast。
- **StudentsTab**：
  - `手动添加学生` → modal → `addStudent` → 刷新详情。
  - `StudentCard` ⋯ → 下拉菜单（查看成长档案先占位/跳转、删除 → 二次确认 modal → `deleteStudent`）。
  - 疑似重复 banner 改为纯提示（移除「查看并合并」按钮）；重复项经上面的删除解决。
- **GroupsTab**：本地可编辑 state（组 + 归属），实现 HTML5 DnD（`onDragStart/onDragOver/onDrop`）在组间/未分组移动、组名 `input` 改名、`+ 新增小组`、`×` 删组；每次变更乐观更新本地 + 后台 `saveGrouping`（失败回滚 + toast）。
- **SessionsTab**：`查看 recap` → `getSessionRecap` → recap 浮窗（组分条形 + 亮眼/被提醒 badge，还原 `班级详情.dc.html` 的 recap modal）。
- 复用/新增 **Toast** 组件（mockup 已有样式）做统一反馈。

## 任务拆解（按可独立验证的顺序）

1. **认证（后端+前端）**：`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/me` 改造；cookie 签名/解析 + 认证中间件 gate `/api/*`；前端 `/login` 页 + 顶层 auth guard（401→重定向）+ TopBar 登出。→ BDD：先写集成测试（登录成功 / 密码错 401 / 未登录访问 401 / 登出后 401）+ 前端 guard 重定向行为测试。
2. **后端脚手架**：`db` 写工具 + 事务封装；`api` 层 `post/put/delete` body 校验（轻量手写守卫，不引框架）。
3. **学生增删**：`POST classes/:id/students` / `DELETE students/:id`（硬删，事务连带清理 memberships/events/checks）。→ 测试：建/删后 `GET :id` 断言人数、累计分变化。
4. **默认分组保存**：`PUT classes/:id/groups`（事务 replace）。→ 测试：调组后 `GET :id` 断言 `memberIds`、未分组。
5. **班级创建**：`POST classes`。→ 测试：建后出现在 `GET /api/classes`。
6. **Recap 路由**：`GET sessions/:id/recap`（泛化 `lastRecapPayload`）。→ 测试：断言组分排名、亮眼/被提醒派生。
7. **前端 api 客户端**：补方法 + 类型。
8. **前端对接**：ClassList 建班 modal → StudentsTab 增/删 + 疑似重复提示降级 → GroupsTab DnD + 保存 → SessionsTab recap 浮窗 → Toast。→ 每块 vitest 行为测试（先写用例再实现）。
9. **回归**：双包 `tsc --noEmit`；agent-browser 先登录 `wangli/demo1234` 再复跑四页面截图，确认与 `tmp/goal-images/` 仍一致；对新交互补操作后截图。

## 决策记录

- **删除学生**：✅ 硬删。事务内连带清理 `class_group_memberships` / `session_memberships` / `score_events` / `check_records` 再删行；接受账本丢该生历史。
- **合并学生**：✅ 砍掉。不做 merge 接口/弹窗；疑似重复仅提示，靠删除解决。
- **分组保存**：✅ 整套 `PUT` replace（幂等重写该班分组 + 归属）。
- **写操作鉴权**：✅ B —— 本轮就做最小登录态（username+密码 → httpOnly 签名 cookie → 中间件 `req.teacher` → 登录页 + 未登录重定向 + 登出）。

### 认证设计（选 B：最小登录态）

沿用 PRD §4 自建认证 scaffold：`auth/password.ts` 已有 `hashPassword/verifyPassword`，seed 已给每个老师建 `credentials(provider=password)`，密码统一 `demo1234`。

- **会话机制**：登录成功签发 httpOnly 签名 cookie `nce_session = teacherId.exp.hmac`（HMAC-SHA256，密钥取 `AUTH_SECRET`，dev 有 fallback），有效期 7 天。无状态、免额外表；cookie 手写解析（读 `req.headers.cookie`，不引依赖）。
- **后端接口**：
  - `POST /api/auth/login` `{username, password}` → 查 teacher + credential，`verifyPassword` 过则 set-cookie 返回 teacher；否则 401。
  - `POST /api/auth/logout` → 清 cookie。
  - `GET /api/me` → 改为从 cookie 解析登录老师；无有效会话返回 401（不再写死王莉）。
- **中间件**：解析 cookie → `req.teacher`；gate 全部 `/api/*`（除 `/api/auth/login`、`/api/health`），未登录 401。写接口用 `req.teacher.id` 填 `teacherId`/`createdBy`，`orgId` 取自该老师。
- **前端**：新增 `/login` 页（username+密码，绿色 IBM Plex 居中卡片——**设计集无登录稿，属新设计**，从简）；顶层 auth guard（挂载先 `GET /api/me`，401→跳 `/login`）；TopBar「退出登录」→ `POST /api/auth/logout`→跳 `/login`。
- **demo/截图影响**：会有登录墙。验证/截图前先登录 `wangli / demo1234`（agent-browser `fill` 登录后再截四页面）。

## 影响文件（预估）

- 后端：`server/src/server.ts`（+ auth 路由 + mutation 路由 + 认证中间件，或拆 `api/` 目录）、新增 `server/src/auth/session.ts`（cookie 签名 + `requireAuth` 中间件）、可能新增 `server/src/db/mutations.ts`。schema/ddl 不用改（硬删无需加列）。
- 前端：`web/src/lib/api.ts`、`web/src/App.tsx`（auth guard）、新增 `web/src/pages/Login.tsx`、`web/src/pages/ClassList.tsx`、`web/src/pages/ClassDetail.tsx`、`web/src/components/TopBar.tsx`（登出）、新增 `web/src/components/{Modal,Toast}.tsx`、`web/src/**/*.test.tsx`。
- 测试：`server` 侧集成测试（给 server 加测试 runner：vitest 或 node:test + 独立临时 db）。

## 不在本 plan 内

课堂引擎的写事件持久化（计分/背书/作业/出勤/调组入库、开始课堂回写默认分组 + 建 session 快照）、成长档案、学生端 H5、Minio/OSS 存储实现、老师管理页（占位）。**登录本轮已纳入，但只做单一 username+密码登录**——找回密码、微信登录、细粒度权限/角色仍不在内。
