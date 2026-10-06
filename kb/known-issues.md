# Known Issues

> 当前 app 已知、待后续处理的问题：缺陷、简化实现、未验收项、待建流程。只反映最新状态——解决了就删掉条目，经过记到 `kb/sessions/`。

## Web 页面往返重复加载、内容短暂空白

- 老师从收银台列表进入收款项详情再返回时，内容需要重新等待请求；用户已反馈明显延迟。代码确认 `Billing`、`BillingBatch` 将响应保存在组件本地 state，重新挂载后从空值开始请求，没有跨页面共享的服务端数据缓存；其他管理页面也有同类写法。
- 待处理：规划 TanStack Query 请求层与组件迁移，统一缓存、写操作后的关联失效，以及首次加载 / 后台刷新 / 错误状态。课堂 localStorage 草稿须保持本地优先，不能被后台刷新覆盖。
- 已确认只迁移 Web、保留 fetch。[Plan 1：请求与缓存基础层](plans/2026-10-06-web-query-foundation.md) 已在分支 `web-query-foundation` 实施（api/queries 层与兼容桥，页面尚未接入，症状仍在）；[Plan 2：组件全量迁移](plans/2026-10-06-web-query-component-migration.md) 待实施，验收通过后删除本条。
