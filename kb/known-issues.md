# Known Issues

> 当前 app 已知、待后续处理的问题：缺陷、简化实现、未验收项、待建流程。只反映最新状态——解决了就删掉条目，经过记到 `kb/sessions/`。

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
