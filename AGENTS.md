# AGENTS.md

新概念英语课堂教学辅助系统。当前进度：**M1 · 基础框架 + 老师端班级管理页面 + 课前配置页 + 课堂主界面（前端）**。
需求/设计以 `kb/plans/2026-06-30-nce-class-m1-prd.md` 为准。设计还原参考 `nce-class-v1-design/*.dc.html`（gitignored）。

## 结构

pnpm workspace，前后端分离：

```
server/   Express + TS · Drizzle ORM + SQLite (better-sqlite3)
  src/db/{schema,ddl,seed,client}.ts   模型全程带 orgId；计分用 score_events 事件流派生
  src/auth/password.ts                 自建密码认证 scaffold（预留微信）
  src/storage/                         StorageClient 抽象层（local 实现，Minio/OSS 待接）
  src/server.ts                        REST API
web/      React + Vite + TS · 老师端桌面 Web（管理页 IBM Plex；课堂界面 Nunito/Baloo 2）
  src/pages/{ClassList,ClassDetail,Teachers}.tsx
  src/pages/Setup.tsx                  课前配置：本节课信息 + 上节课回顾 + 默认分组微调（拖拽/增组/缺席暂存）→ 开始课堂
  src/pages/Classroom.tsx              课堂主界面：看板/背书/作业/出勤/调组 五视图 + 学生/小组浮窗 + recap
  src/lib/session.ts (+ .test.ts)      课堂事件流计分派生（sScore/gScore/recap）+ Lesson 3 demo scenario
  src/lib/setup.ts (+ .test.ts)        课前配置分组模型（buildSetup/moveStudent/addGroup/sums）+ 开始课堂 config 快照
```

## 开发命令

```bash
pnpm install     # 首次会编译 better-sqlite3 原生模块
pnpm db:reset    # 重建并填充 SQLite mock 数据 → server/data/app.db
pnpm dev         # server :5177 + web :5173（vite 代理 /api、/uploads）
```

单独启动 `pnpm dev:server` / `pnpm dev:web`。类型检查 `pnpm --filter <pkg> exec tsc --noEmit`；前端单测 `pnpm --filter web test`（vitest，覆盖计分派生）。

已实现页面：班级列表 `/`；班级详情 `/classes/c1?tab=students|groups|invite|sessions`；课前配置 `/classes/c1/setup`（「开始上课」入口）；课堂主界面 `/classes/c1/classroom`（课前配置「开始课堂」进入，或直接访问走 Lesson 3 demo）。
API：`/api/me`、`/api/classes`、`/api/classes/:id`（含 `lastRecap`：最近一节课的派生组分/出勤，供课前配置「上节课回顾」）。

## 须知 / 约定

- **计分是事件流**：学生累计个人分、组分都由 `score_events`(±1) 派生，不落地存储。
- seed 自带 DDL（`ddl.ts`），`db:reset` 无需 drizzle-kit；生产迁移用 `pnpm db:generate`。
- 相对时间以 `server/src/util/time.ts` 的 `REFERENCE_TODAY=2026-07-01` 为基准（保证 demo 稳定）。
- 三年级A班刻意保留重复学生「浩浩」演示疑似重复 → 该班 13 人、全校 86。
- **端口 5173 也被邻近项目 tenderbuddy 占用**，清理进程时勿误杀。
- 遵循用户全局约定：pnpm 装依赖（`pnpm add`，勿手改 package.json）；勿用 try/catch 除非要求；改完代码不跑 formatter/linter。

## 待做（后续阶段）

- **课前配置页已完成前端**（还原 `课前配置.dc.html`，与 `tmp/goal-images/课前配置.png` 大体一致）：真实 `classDetail` 数据驱动（未分组学生落入缺席暂存区），字段可编辑、拖拽/增组/缺席交互，「开始课堂」把微调后的分组冻结成 `SessionConfig` 经 router state 交给课堂主界面 boot 出**新鲜 session**（空 ledger、按配置分组/时长/课次）。**仍缺持久化**：开始课堂尚未回写默认分组、也未在后端建 ClassSession/SessionGroup/SessionMembership 快照（PRD §7.2 的回写 + 快照仍待做）。
- **课堂主界面已完成前端**（还原 `课堂主界面.dc.html`，与 `tmp/goal-images/课堂主界面/` 截图一致）：直接访问走 `lib/session.ts` 的 Lesson 3 demo；经课前配置进入则 boot 自 `SessionConfig`。下一步：计分/背书/作业/出勤/调组写入 REST API（真正持久化事件流）。
- 成长档案 → 学生端 H5；老师管理页当前仅占位；Minio/OSS 存储实现。
