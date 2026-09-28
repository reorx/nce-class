---
created: 2026-09-28
tags:
  - billing
  - timezone
  - testing
  - flaky-tests
  - better-sqlite3
  - dependencies
---

# 逐个处理 known-issues：收费时区与显示、课程次数明细说明、测试随机失败、better-sqlite3 升级

## 概要

`kb/known-issues.md` 里有 5 条待处理，本次全部解决，每条单独提交。收费三条按事先定的方向修：①「今天」改为固定按东八区计算，不依赖容器 TZ；② 前端把库里的 UTC 时间戳解析后转成浏览器本地时间显示；③ 设了课程次数覆盖时，编辑弹窗注明未上节数的算法，接口不动。④ 测试随机失败查到了根因：supertest 每个请求 `listen(0)` 绑 `::`，macOS 分配端口时不避开别的进程独占的 `127.0.0.1:P`，请求被那个进程抢走。改成每个测试文件只起一个显式绑 `127.0.0.1` 的 server 后，失败率从 8 轮挂 5 轮降到 10 轮 0 挂。⑤ better-sqlite3 直接升到 13.0.3（N-API，预编译随包发布），node 22/24/26 用同一份 node_modules 都能跑通。改动只在本地提交，**尚未 push**。push master 会触发生产部署，要由用户决定。

## 修改的文件

- `server/src/util/time.ts`：`localToday(now?)` 改为 UTC+8 显式计算
- `server/src/util/time.test.ts`（新）：0–8 点跨日、跨月跨年、进程 TZ 不同
- `server/tests/billing.test.ts`：`day()` 改为基于 `localToday()` 推算
- `web/src/lib/utcTime.ts` / `utcTime.test.ts`（新）：`utcToLocalDate` / `utcToLocalMinute`
- `web/src/pages/Billing.tsx`：批次卡片「创建于」按本地日期显示
- `web/src/pages/BillingBatch.tsx`：「快照于」、已收款时间转本地时间；编辑弹窗在 `lessonCountOverride` 非空时加说明行
- `server/tests/helpers.ts`：新增 `listenLocal()`，`setupTestApp` 返回绑 127.0.0.1 的 `http.Server`，`wxLogin` 参数类型随之改
- `server/tests/{api,billing,wx-auth,wx-invite,wx-queue}.test.ts`：`app` 类型由 `Express` 改为 `Server`
- `server/tests/provision.test.ts`：两处 `request(createApp())` 改走 `listenLocal`
- `server/package.json`、`pnpm-lock.yaml`：better-sqlite3 `^11.8.1` → `^13.0.3`
- `kb/docs/business-rules.md`：「当天」按北京时间算、收款时间显示时区、弹窗明细在覆盖次数下的口径
- `AGENTS.md`：tests 目录说明加「勿直接 request(createApp())」；`pnpm install` 注释改为无需重编
- `kb/known-issues.md`：5 条全部删除，现为空
- `kb/next-up.md`（新）：push 部署后的线上核对项
- 本地脚本（`tmp/`，gitignored）：`flaky-loop.sh`（连跑测试统计失败）、`port-collision.mjs`（端口冲突复现）、`smoke-billing.sh`（收费写路径 curl 冒烟）

## 注意事项

- **macOS 上 `listen(0)` 不带 host 会绑 `::`，可能和别的进程的 `127.0.0.1:P` 共存**，而连 `127.0.0.1:P` 的请求会落到更具体的那个绑定上。本机有 49 个这样的监听时，撞上的概率约 0.13%/次。任何「起临时 server 再连 127.0.0.1」的测试都要显式绑 `127.0.0.1`。
- supertest 拿到**已经在监听**的 `http.Server` 时直接用它的端口、不会关闭它。所以一个文件复用一个 server（`unref()` 防止拖住 worker）既稳又快。
- 服务端「今天」与库里的 UTC 时间戳是两套口径：账务切日用东八区日期（`localToday`），`datetime('now')` 写入的时间戳保持 UTC，只在前端显示时转换。课堂 `started_at` / 事件 `createdAt` 是浏览器本地墙钟，**不要**套 `utcTime` 转换。
- better-sqlite3 13：包里自带各平台 `.node`，`lib/binding.js` 优先加载预编译。但 pnpm 11 不认 `gypfile: false`，装包时仍会跑一次 node-gyp，所以 Dockerfile 构建阶段的 python3/make/g++ 不能删。lockfile 仍是 9.0 格式，本地 pnpm 10 写出来的，pnpm 11 `--frozen-lockfile` 能过（已在 scratch 目录按 Dockerfile 步骤验证）。
- 12.11.1 也声明支持 node 26，但仍按 ABI 编译，换 node 版本要重编，所以选 13。`mise.toml` 继续钉 node 24。
- BillingBatch.tsx 里两个问题的改动混在同一个文件时，先临时去掉后一个的代码块再 `--amend`，保持一个问题一个提交。

## 遗留问题

- 以上 5 个提交未 push。生产要 push master 才生效（① 和 ⑤ 改了 server）。push 后的线上核对已记到 `kb/next-up.md`。

## 已解决的已知问题

- **收费：生产容器时区是 UTC，北京时间 0–8 点创建或重算批次时「今天」落在前一天**：`localToday()` 改为 UTC+8 显式计算。time.test.ts 覆盖跨日、跨年和不同进程 TZ；billing 测试在 `TZ=America/Los_Angeles` 下也通过。
- **收费：确认收款时间、快照时间按 UTC 显示，比北京时间慢 8 小时**：新增 `web/src/lib/utcTime.ts`，三处显示改用它。agent-browser 实测：库里 15:13（UTC），页面显示 09-28 23:13。
- **收费：设了课程次数覆盖时，编辑弹窗逐节明细的「未上」行数与计费节数对不上**：弹窗汇总下方加说明行，写明「未上节数 = N − 周期内已上节数，不按上表的排班日期行数计」。agent-browser 用排班 9 节、课程次数 12 的批次验证，截图 `tmp/2026-09-28-known-issues/invoice-modal-override-note.png`。
- **测试：server 集成测试套件随机挂 1–4 个用例，跨文件、每次不同**：根因是上面说的端口冲突，改用 `listenLocal()`。改前 8 轮挂 5 轮，改后 10 轮全过。
- **环境：node 26 编不了 better-sqlite3 11.10.0，仓库已用 mise 钉到 node 24**：升到 13.0.3。297 例在 node 22.23 / 24.18 / 26.9 下全过。另外用 db:reset、curl 冒烟收费写路径，并用 agent-browser 开课 → 结束课堂落库验证。

## 相关文档

- [业务口径](../docs/business-rules.md) — 本次更新收费小节（当天口径、时间显示、弹窗明细）
- [排班+收费开发计划](../plans/2026-07-20-nce-class-billing-schedule.md) — 参考，收费口径来源
- [验证指南](../docs/verification-guide.md) — 参考，agent-browser 流程与 curl 冒烟写法
