---
created: 2026-10-06
tags:
  - billing
  - schedule
  - archive
---

# 限制归档班级新建收款项和课程周期

## 概要

收银台创建收款项仅允许选择未归档班级；弹窗重开时校验上次选择，失效后回退到首个可用班级。没有可用班级时显示空状态并禁止提交。归档班级排班页禁用新建课程周期并提示先取消归档，服务端也拒绝这两种创建请求。

## 修改的文件

- `web/src/components/BillingBatchModal.tsx`、`web/src/lib/billingForm.ts` 及测试：过滤归档班级、处理失效选择、加载与空状态，忽略过期异步响应。
- `web/src/components/ScheduleTab.tsx`、`web/src/pages/ClassDetail.tsx`：传递归档状态，禁用新建入口与提交，调整空状态提示。
- `server/src/app.ts`、`server/tests/billing.test.ts`：创建接口返回 409，验证取消归档恢复创建、历史读取与重算、跨组织隔离。
- `AGENTS.md`、`kb/docs/business-rules.md`、API 类型及测试注释：更新归档口径。

## 注意事项

- 限制具体针对新建课程周期和新建收款项，历史排班与收款项可继续维护。归档不影响上课提交兼容性。
- 先新增测试并确认失败，再实现；web 269 项、server 292 项全部通过，两端 `tsc --noEmit` 通过。
- agent-browser 验证了选择班级归档后的回退、全部归档后的空状态、排班新建禁用、取消归档恢复编辑器。验证使用本地数据，归档状态已全部恢复。
- 截图与验证脚本：`tmp/2026-10-06-archived-class/`。浏览器会话已关闭，执行了 `mac-dev-cleanup --only browser --min-age 2`，本次启动的开发服务已停止。

## 遗留问题

无。本次仅本地提交，未推送或部署。

## 相关文档

- [业务口径](../docs/business-rules.md) — 更新班级归档规则。
- [排班收费设计](../plans/2026-07-20-nce-class-billing-schedule.md) — 参考原有排班与收款流程。
- [验证手册](../docs/verification-guide.md) — 依据浏览器表单验证与资源清理规范。
