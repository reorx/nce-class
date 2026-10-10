# Known Issues

> 当前 app 已知、待后续处理的问题：缺陷、简化实现、未验收项、待建流程。只反映最新状态——解决了就删掉条目，经过记到 `kb/sessions/`。

## 离线发起的写操作会暂停等待联网，与原定“不自动恢复写入”不符

- 2026-10-08 复盘确认：`queries/client.ts` 仅配置 Mutation `retry: false`，未指定 networkMode，沿用默认 online。使用本机已安装 TanStack Query 的最小复现：离线 mutate 时函数调用数为 0、isPaused 为 true；恢复在线后，无需再次点击即调用 1 次。脚本在 `tmp/2026-10-08-spa-data-guide/check-offline-mutation.mjs`。
- 老师断网时发起收款、考勤或提交等动作可能持续等待，联网后延迟执行，而非立即失败供手动重试。当前页面没有完整表达该暂停语义；清缓存和会话代次也不等于取消暂停中的服务器写入。尚未复现线上业务损失或跨账号写入。
- 待处理：明确离线写入采用拒绝/快速失败还是可见暂停恢复；补 offline → online、等待期间退出/换账号的实际 hooks 和浏览器用例，再调整网络模式、提交与会话保护。本次仅记录，未改应用代码。原则与现状见 [开发指南](docs/web-data-layer.md#11-必须单独定义离线写入语义)。
