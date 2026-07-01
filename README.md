# NCE Class

新概念英语课堂教学辅助系统。当前进度：**M1 · 基础框架 + 老师端班级管理页面**。

设计与需求见 [`kb/plans/2026-06-30-nce-class-m1-prd.md`](kb/plans/2026-06-30-nce-class-m1-prd.md)。

## 技术栈

前后端分离的 pnpm workspace：

- `server/` — Express + TypeScript，SQLite + Drizzle ORM，事件流计分（ledger），自建认证（用户名+密码，预留微信登录），存储抽象层（`StorageClient` 接口 + 本地实现，预留 Minio/OSS）。数据模型全程带 `orgId`（多组织隔离）。
- `web/` — React + Vite + TypeScript（老师端桌面 Web），IBM Plex 字体，设计还原自 `nce-class-v1-design` 的 mockup。

## 快速开始

```bash
pnpm install                 # 安装依赖（首次会编译 better-sqlite3 原生模块）
pnpm db:reset                # 初始化并填充 SQLite mock 数据（server/data/app.db）
pnpm dev                     # 同时启动后端(:5177) 与前端(:5173)
```

打开 http://localhost:5173 。

- 单独启动：`pnpm dev:server` / `pnpm dev:web`
- 重新生成 mock 数据：`pnpm db:reset`

## 已实现页面（M1 阶段 1–2）

| 页面 | 路由 |
|------|------|
| 班级列表（首页） | `/` |
| 班级详情 · 学生 | `/classes/c1` |
| 班级详情 · 分组方案 | `/classes/c1?tab=groups` |
| 班级详情 · 邀请家长 | `/classes/c1?tab=invite` |
| 班级详情 · 上课记录 | `/classes/c1?tab=sessions` |

## API

- `GET /api/me` — 当前老师（M1 管理页不设登录墙，返回组织负责人）
- `GET /api/classes` — 班级列表（含派生的学生数 / 上次上课 / 负责老师）
- `GET /api/classes/:id` — 班级详情（学生累计个人分由 `score_events` 事件流派生；分组、上课记录、时长均实时计算）

## 数据模型

见 `server/src/db/schema.ts`（Drizzle）。计分以 `score_events`（±1 事件流）为单一事实来源，
所有派生分数（学生累计个人分、组分）由事件计算得出。DDL 由 `server/src/db/ddl.ts` 在
seed 时执行，生产迁移使用 `pnpm db:generate`（drizzle-kit）。

## 说明 / 已知取舍

- 三年级A班保留了一条家长自助重复学生「浩浩」，用于演示学生页的「疑似重复」检测与合并入口；
  因此该班计 13 名学生（比早期 mockup 的 12 多 1），全校合计 86。
- 相对时间（「昨天 / N 天前」）以 `REFERENCE_TODAY = 2026-07-01` 为基准，保证 demo 稳定。
- 存储层默认使用本地文件实现；Minio/OSS 待接入官方 SDK（见 `server/src/storage/`）。
