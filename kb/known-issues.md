# Known Issues

> 当前 app 已知、待后续处理的问题：缺陷、简化实现、未验收项、待建流程。只反映最新状态——解决了就删掉条目，经过记到 `kb/sessions/`。

## 收费：确认收款时间、快照时间按 UTC 显示，比北京时间慢 8 小时

- 记录：2026-09-28（同上；本地已确认 `datetime('now')` 返回 UTC）
- `invoices.paid_at`、`billing_batches.snapshot_at` / `created_at` 由 SQLite `datetime('now')` 写入，是 UTC。`web/src/pages/BillingBatch.tsx` 和 `Billing.tsx` 直接截取字符串显示，没有换算时区。
- 影响：老师下午 3 点确认收款，页面显示 07:xx。北京时间 0–8 点的操作，「创建于」日期还会显示成前一天。只影响显示，不影响金额。
- 本地开发环境同样能复现。
- 处理方向：前端显示时把这几个字段按 UTC 解析再转本地时间。不建议改成写入本地时间，库里保持 UTC 更不容易出错。

## 收费：设了课程次数覆盖时，编辑弹窗逐节明细的「未上」行数与计费节数对不上

- 记录：2026-09-28（同上）
- `GET /api/invoices/:id/lessons` 生成「未上」行时只看排班日期，没有读批次的 `lesson_count_override`。而收款单的未上节数在有覆盖时是「覆盖次数 − 已上节数」。
- 影响：例如排班 9 节、课程次数填 12、已上 3 节，收款单未上节数是 9，明细表只列出 6 行未上。明细表下方的汇总文字取自收款单，数字是对的，所以是表格行数与汇总不一致。金额不受影响。
- 没有测试覆盖这个组合。
- 处理方向：有覆盖时明细接口按覆盖口径补齐或截断「未上」行，或者在弹窗里注明「课程次数已手动设为 N，未上节数按此计算」。后者改动小。

## 测试：server 集成测试套件随机挂 1–4 个用例，跨文件、每次不同

- 记录：2026-09-28（做学生中文名时发现；stash 掉全部改动在干净基线上同样复现，不是某次改动引入的）
- 症状：`pnpm --filter server test` 每跑 3 次约 1–2 次会挂，挂的用例每次不同且互不相关，断言形如 `expected 401 to be 400`、`expected 200 to be 401`（logout 后仍 200）、`expected 404 to be 200`，偶尔是 supertest 的 `Parse Error: Expected HTTP/, RTSP/ or ICE/`。单独重跑挂掉的那个文件/用例必过。
- 排查到的：每个测试文件自己 `setupTestApp()` 建临时库（`mkdtempSync`），vitest 默认按文件隔离，理论上不共享；症状更像并发/连接层串扰而非数据污染，机器负载高时更容易出现。本地 node 从 25 升到 26（再钉回 24）前后都有，只是表现的用例不同。
- 影响：只影响本地与 CI 的可信度，不影响运行时。危险在于真 bug 会被当成 flake 忽略。
- 处理方向：先试 `poolOptions.threads.singleThread` 或 `fileParallelism: false` 看是否消失以定位是并发问题；若确认是 supertest 的短连接问题，改成 `beforeAll` 里 `app.listen(0)` 复用一个 server 而不是每请求起一个。

## 环境：node 26 编不了 better-sqlite3 11.10.0，仓库已用 mise 钉到 node 24

- 记录：2026-09-28（本机 brew 把 node 升到 26 后 `pnpm db:reset` 直接 `ERR_DLOPEN_FAILED`）
- `better-sqlite3@11.10.0` 的 C++ 源码用了 node 26 的 V8 已删除的 API（`v8::Object::GetPrototype`、`v8::Context::GetIsolate`、`PropertyCallbackInfo::This`），`node-gyp rebuild` 直接编译报错，没有 prebuilt 可用。node 25 编出来的 .node 在 node 24/26 下都 `NODE_MODULE_VERSION` 不匹配。
- 现状：仓库根加了 `mise.toml`（`node = "24"`），进目录自动切版本；node_modules 里的原生模块已按 node 24 重编过。换过 node 版本后要 `pnpm rebuild better-sqlite3`（pnpm 10 会跳过构建脚本，必要时进 `node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3` 直接 `npx node-gyp rebuild --release`）。
- 影响：钉住之后本地正常；生产镜像自带 node 22 不受影响。隐患是以后想升 node 就得先升 better-sqlite3。
- 处理方向：升到支持新 V8 的 better-sqlite3（12.x）再放开 node 版本，升级时重点回归 DDL/事务与 `PRAGMA` 相关代码。
