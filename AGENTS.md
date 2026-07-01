# AGENTS.md

新概念英语课堂教学辅助系统。当前进度：**M1 · 基础框架 + 老师端班级管理页面**。
需求/设计以 `kb/plans/2026-06-30-nce-class-m1-prd.md` 为准。设计还原参考 `nce-class-v1-design/*.dc.html`（gitignored）。

## 结构

pnpm workspace，前后端分离：

```
server/   Express + TS · Drizzle ORM + SQLite (better-sqlite3)
  src/db/{schema,ddl,seed,client}.ts   模型全程带 orgId；计分用 score_events 事件流派生
  src/auth/password.ts                 自建密码认证 scaffold（预留微信）
  src/storage/                         StorageClient 抽象层（local 实现，Minio/OSS 待接）
  src/server.ts                        REST API
web/      React + Vite + TS · 老师端桌面 Web（IBM Plex 字体）
  src/pages/{ClassList,ClassDetail,Teachers}.tsx
```

## 开发命令

```bash
pnpm install     # 首次会编译 better-sqlite3 原生模块
pnpm db:reset    # 重建并填充 SQLite mock 数据 → server/data/app.db
pnpm dev         # server :5177 + web :5173（vite 代理 /api、/uploads）
```

单独启动 `pnpm dev:server` / `pnpm dev:web`。类型检查 `pnpm --filter <pkg> exec tsc --noEmit`。

已实现页面：班级列表 `/`；班级详情 `/classes/c1?tab=students|groups|invite|sessions`。
API：`/api/me`、`/api/classes`、`/api/classes/:id`。

## 须知 / 约定

- **计分是事件流**：学生累计个人分、组分都由 `score_events`(±1) 派生，不落地存储。
- seed 自带 DDL（`ddl.ts`），`db:reset` 无需 drizzle-kit；生产迁移用 `pnpm db:generate`。
- 相对时间以 `server/src/util/time.ts` 的 `REFERENCE_TODAY=2026-07-01` 为基准（保证 demo 稳定）。
- 三年级A班刻意保留重复学生「浩浩」演示疑似重复 → 该班 13 人、全校 86。
- **端口 5173 也被邻近项目 tenderbuddy 占用**，清理进程时勿误杀。
- 遵循用户全局约定：pnpm 装依赖（`pnpm add`，勿手改 package.json）；勿用 try/catch 除非要求；改完代码不跑 formatter/linter。

## 待做（后续阶段）

课前配置 → 课堂四视图引擎 → 成长档案 → 学生端 H5；老师管理页当前仅占位；Minio/OSS 存储实现。
