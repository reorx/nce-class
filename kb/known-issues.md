# Known Issues

> 当前 app 已知、待后续处理的问题：缺陷、简化实现、未验收项、待建流程。只反映最新状态——解决了就删掉条目，经过记到 `kb/sessions/`。

## 环境：node 26 编不了 better-sqlite3 11.10.0，仓库已用 mise 钉到 node 24

- 记录：2026-09-28（本机 brew 把 node 升到 26 后 `pnpm db:reset` 直接 `ERR_DLOPEN_FAILED`）
- `better-sqlite3@11.10.0` 的 C++ 源码用了 node 26 的 V8 已删除的 API（`v8::Object::GetPrototype`、`v8::Context::GetIsolate`、`PropertyCallbackInfo::This`），`node-gyp rebuild` 直接编译报错，没有 prebuilt 可用。node 25 编出来的 .node 在 node 24/26 下都 `NODE_MODULE_VERSION` 不匹配。
- 现状：仓库根加了 `mise.toml`（`node = "24"`），进目录自动切版本；node_modules 里的原生模块已按 node 24 重编过。换过 node 版本后要 `pnpm rebuild better-sqlite3`（pnpm 10 会跳过构建脚本，必要时进 `node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3` 直接 `npx node-gyp rebuild --release`）。
- 影响：钉住之后本地正常；生产镜像自带 node 22 不受影响。隐患是以后想升 node 就得先升 better-sqlite3。
- 处理方向：升到支持新 V8 的 better-sqlite3（12.x）再放开 node 版本，升级时重点回归 DDL/事务与 `PRAGMA` 相关代码。
