---
created: 2026-11-09
tags:
  - session
  - makeup
---

# 补课记录允许不抵扣任何课：执行总结

## 做了什么

- server：`parseMakeup` 放开空 `sessionIds`；缺字段、非数组、重复、非字符串仍 400，错误信息改为「抵扣的课必须是不重复的课程 ID 列表」。
- web：`validateMakeupForm` 不再校验空选；`MakeupFormModal` 去掉保存按钮的禁用条件和 `errors.sessionIds` 行，无候选提示改为新文案，0 节记录的删除确认为「确定删除这条补课记录吗？」。
- 文档：`business-rules.md` 补一条；原补课 plan 里「至少勾选」「保存按钮不可用」「非空数组」「sessionIds 为空」四处改掉并链接本 plan。

## 偏离 plan 的地方及原因

无。唯一小差异：server 的「释放后可复用」用例用同一学生 s4 顺序完成（没有 s5 这个种子学生）；web 页面级用例里列表行按钮名是 `11/9`（日期不补零）。

## 测试结果

- `pnpm --filter server test` 335 通过；`pnpm --filter web test` 540 通过；两包 `tsc --noEmit` 通过。
- 测试先行：server 新用例、web 的 `makeup.test.ts` 和 `ClassAttendance.test.tsx` 新用例在改实现前均失败，改后通过。
- agent-browser 流程 1–5 通过（Tom 全勤 → 看到新提示并保存 0 节记录 → 改缺勤后编辑勾选，格子变「✓补」→ 取消勾选格子恢复缺勤 → 删除确认文案正确）。截图在 `tmp/2026-11-09-makeup-without-coverage/`（tmp 被 gitignore，不入库）。

## 遗留问题

- 409 后勾选被清空可直接存成 0 节记录（plan 已定不拦截），真实使用中若出现误存再考虑加确认。
- 没有发现范围外的新问题。

## 相关文档

- [plan](../plans/2026-11-09-makeup-without-coverage.md)、[执行简报](../plans/2026-11-09-makeup-without-coverage-brief.md)、[原补课 plan](../plans/2026-11-09-makeup-lesson-records.md)、`kb/docs/business-rules.md`
