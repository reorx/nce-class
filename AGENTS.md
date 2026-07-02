# AGENTS.md

新概念英语课堂教学辅助系统。当前进度：**M1 · 基础框架 + 老师端班级管理页面（读+写闭环，含登录鉴权）+ 课前配置页 + 课堂主界面（前端）**。
需求/设计以 `kb/plans/2026-06-30-nce-class-m1-prd.md` 为准；班级管理写操作+登录见 `kb/plans/2026-07-01-nce-class-m1-management-wiring.md`。设计还原参考 `nce-class-v1-design/*.dc.html`（gitignored）。

## 结构

pnpm workspace，前后端分离：

```
server/   Express + TS · Drizzle ORM + SQLite (better-sqlite3)
  src/db/{schema,ddl,seed,client}.ts   模型全程带 orgId；计分用 score_events 事件流派生（client 的 DB 路径可用 NCE_DB_PATH 覆盖，供测试）
  src/db/mutations.ts                  写操作（createClass/addStudent/deleteStudent 硬删/saveGrouping replace），事务封装
  src/auth/{password,session}.ts       自建密码认证 + 无状态签名 cookie（HMAC，AUTH_SECRET）+ parseCookies（session.test.ts）
  src/storage/                         StorageClient 抽象层（local 实现，Minio/OSS 待接）
  src/app.ts                           createApp()：读+写 REST + 认证中间件（gate /api/*）；server.ts 仅 listen
  tests/                               vitest + supertest 集成测试（临时 DB harness，覆盖登录/增删/分组/建班/recap/跨组织隔离）
web/      React + Vite + TS · 老师端桌面 Web（管理页 IBM Plex；课堂界面 Nunito/Baloo 2）
  src/App.tsx                          顶层 auth guard（GET /api/me → 401 跳 /login）+ ToastProvider
  src/pages/{ClassList,ClassDetail,Teachers,Login}.tsx  ClassList 建班 modal；ClassDetail 学生增删/分组 DnD/recap 浮窗
  src/components/{TopBar,Modal,Toast}.tsx  TopBar 退出登录；通用 Modal + Toast
  src/pages/Setup.tsx                  课前配置：本节课信息 + 上节课回顾 + 默认分组微调（拖拽/增组/缺席暂存）→ 开始课堂
  src/pages/Classroom.tsx              课堂主界面：看板/背书/作业/出勤/调组 五视图 + 学生/小组浮窗 + recap
  src/lib/api.ts                       fetch 客户端（get/post/put/del + ApiError 401；login/logout/createClass/addStudent/deleteStudent/saveGrouping/getSessionRecap）
  src/lib/grouping.ts (+ .test.ts)     分组方案可编辑模型（toModel/moveStudent/addGroup/removeGroup/renameGroup/toPayload）
  src/lib/session.ts (+ .test.ts)      课堂事件流计分派生（sScore/gScore/recap）+ Lesson 3 demo scenario
  src/lib/setup.ts (+ .test.ts)        课前配置分组模型（buildSetup/moveStudent/addGroup/sums）+ 开始课堂 config 快照
```

## 开发命令

```bash
pnpm install     # 首次会编译 better-sqlite3 原生模块
pnpm db:reset    # 重建并填充 SQLite mock 数据 → server/data/app.db
pnpm dev         # server :5177 + web :5173（vite 代理 /api、/uploads）
```

单独启动 `pnpm dev:server` / `pnpm dev:web`。类型检查 `pnpm --filter <pkg> exec tsc --noEmit`；单测 `pnpm --filter web test` / `pnpm --filter server test`（均 vitest）。

**登录墙**：管理页均需登录，先访问 `/login` 用 seed 老师登录（如 `wangli` / `demo1234`，全体老师同密码）。会话是 httpOnly 签名 cookie `nce_session`（7 天）。

已实现页面：登录 `/login`；班级列表 `/`；班级详情 `/classes/c1?tab=students|groups|invite|sessions`（学生增删、分组 DnD 保存、上课记录 recap 浮窗）；课前配置 `/classes/c1/setup`；课堂主界面 `/classes/c1/classroom`。
API（除 `/api/health`、`/api/auth/login` 外全部经认证中间件，写入用 `req` 上的当前老师 + orgId 过滤）：
- 认证：`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/me`（无会话 401）。
- 读：`GET /api/classes`、`GET /api/classes/:id`（含 `lastRecap`）、`GET /api/sessions/:id/recap`（组分排名 + 🌟亮眼(净≥2)/⚠️被提醒(任一−1) + 出勤）。
- 写：`POST /api/classes`、`POST /api/classes/:id/students`、`DELETE /api/students/:id`（硬删连带清账本）、`PUT /api/classes/:id/groups`（整套 replace 默认分组，前端拖拽/改名/增删即时保存）。

## 须知 / 约定

- **计分是事件流**：学生累计个人分、组分都由 `score_events`(±1) 派生，不落地存储。
- **鉴权**：无状态签名 cookie（`auth/session.ts`，HMAC/`AUTH_SECRET`，dev 有 fallback），`app.ts` 中间件 gate `/api/*`；写接口的 `teacherId`/`orgId` 取自当前登录老师。**疑似重复学生只提示不合并**（merge 已砍），靠删除解决。
- seed 自带 DDL（`ddl.ts`），`db:reset` 无需 drizzle-kit；生产迁移用 `pnpm db:generate`。
- 相对时间以 `server/src/util/time.ts` 的 `REFERENCE_TODAY=2026-07-01` 为基准（保证 demo 稳定）。
- 三年级A班刻意保留重复学生「浩浩」演示疑似重复 → 该班默认 13 人、全校 86（写操作会改变计数）。
- **端口 5173 也被邻近项目 tenderbuddy 占用**，清理进程时勿误杀。
- 遵循用户全局约定：pnpm 装依赖（`pnpm add`，勿手改 package.json）；勿用 try/catch 除非要求；改完代码不跑 formatter/linter。

## 待做（后续阶段）

- **课堂运行时持久化**（本地优先 + 结束课堂一次性提交）：见 `kb/plans/2026-07-02-nce-class-classroom-backend.md`。开始课堂回写默认分组 + 建 ClassSession/SessionGroup/SessionMembership 快照 + 批量 ScoreEvent/CheckRecord，均在结束课堂时一次性 POST。
- **课前配置页已完成前端**（还原 `课前配置.dc.html`，与 `tmp/goal-images/课前配置.png` 大体一致）：真实 `classDetail` 数据驱动（未分组学生落入缺席暂存区），字段可编辑、拖拽/增组/缺席交互，「开始课堂」把微调后的分组冻结成 `SessionConfig` 经 router state 交给课堂主界面 boot 出**新鲜 session**（空 ledger、按配置分组/时长/课次）。**仍缺持久化**：开始课堂尚未回写默认分组、也未在后端建 ClassSession/SessionGroup/SessionMembership 快照（PRD §7.2 的回写 + 快照仍待做）。
- **课堂主界面已完成前端**（还原 `课堂主界面.dc.html`，与 `tmp/goal-images/课堂主界面/` 截图一致）：直接访问走 `lib/session.ts` 的 Lesson 3 demo；经课前配置进入则 boot 自 `SessionConfig`。下一步：计分/背书/作业/出勤/调组写入 REST API（真正持久化事件流）。
- 成长档案 → 学生端 H5；老师管理页当前仅占位；Minio/OSS 存储实现。
