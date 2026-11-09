---
created: 2026-11-09
tags:
  - makeup
  - attendance
  - billing
  - migration
---

# 实施补课记录、考勤抵扣与收费参考统计

## 概要

按执行简报和 plan，将原考勤格的「已补课」开关替换为独立补课台账。老师可以登记、编辑、删除日期、时长、备注与抵扣课程，支持插班前没有课堂快照的课程；考勤表显示蓝色 ✓「补」，应上和实到均计入抵扣。收费的已上到堂在生成或重置时计入抵扣，逐节明细实时显示已补课，应收金额不变。原课出勤、战报、成长档案、小程序及课堂提交契约保持原口径。

服务端和 Web 数据层均先写失败测试再实现，页面补充真实 App 路由测试；本地 seed 上完成 agent-browser 人工流程 1–9。全部工作位于原 master 分支，一个本地提交，不 push、不连接生产。

## 修改的文件

### 服务端

- `server/src/db/ddl.ts`：补课记录、抵扣关联表及索引；新库移除旧列。
- `server/src/db/schema.ts`：对应 Drizzle 表定义、索引及中文注释。
- `server/src/db/provision.ts`：旧标记事务迁移、清零和重复抵扣防护，保留已有旧列。
- `server/src/db/mutations.ts`：补课 CRUD 事务、到勤解除抵扣、覆盖课堂与级联删除。
- `server/src/app.ts`：组织隔离和参数校验，补课写接口，attendance 合并读取，收费明细抵扣派生。
- `server/src/lib/billing.ts`、`server/src/lib/billing.test.ts`：快照计算按到勤或抵扣计数，含无快照课程。
- `server/tests/api.test.ts`：补课行为、隔离、校验、冲突、更正、覆盖、删除与收费回归。
- `server/tests/provision.test.ts`：旧库转换、新库无旧列、重复运行、回滚再升级回归。
- `server/tests/billing.test.ts`：以台账抵扣替换旧布尔标记 fixture。
- `server/tests/helpers.ts`：临时库 reseed 清理两张新表。

### Web

- `web/src/api/attendance.ts`、`web/src/api/contract.test.ts`：新 DTO 和三个写接口契约，考勤更正仅写 status。
- `web/src/lib/makeup.ts`、`web/src/lib/makeup.test.ts`：候选集、覆盖表、表单校验、列表筛选和文案。
- `web/src/lib/attendance.ts`、`web/src/lib/attendance.test.ts`：覆盖格统计、插班标签与三种原状态 CSV。
- `web/src/queries/attendance.ts`、`web/src/queries/attendance.test.tsx`：补课 hooks、409 刷新、只覆盖 status 的 pending 状态。
- `web/src/queries/cache-effects.ts`、`web/src/queries/cache-effects.test.tsx`：增改删精确回写、到勤解除关联及收费展示失效矩阵。
- `web/src/queries/keys.ts`、`web/src/queries/inventory.test.ts`：mutation key 和 hooks 清单。
- `web/src/components/MakeupList.tsx`、`MakeupFormModal.tsx`、`makeup.css`：筛选、空态、列表、草稿表单、失效候选提示和删除确认。
- `web/src/pages/ClassAttendance.tsx`、`web/src/pages/ClassAttendance.test.tsx`：URL 视图切换、格子入口、蓝色角标、到勤确认与页面行为测试；页面由约 978 行降至约 800 行。
- `web/src/pages/BillingBatch.tsx`：无快照课程也显示「未入班 / 已补课」。
- `web/src/pages/SessionDetail.test.tsx`：旧考勤用例调整为 status，复用 Modal 的关闭按钮定位。
- `web/src/test-utils/fixtures.ts`、`cacheUniverse.ts`：attendance fixture 增加 makeups、移除 records.madeUp。

### 文档

- `AGENTS.md`：补课视图 URL、出勤抵扣约束和文档索引。
- `kb/docs/business-rules.md`：补课台账、统计、删除、迁移与收费快照口径。
- `kb/docs/classroom-session-lifecycle.md`：只保留请假更正，独立抵扣在覆盖后的保留与解除。
- `kb/plans/2026-11-09-makeup-lesson-records.md`：实施步骤全部勾选，注明迁移防重复的补充原因。
- `kb/next-up.md`：部署后线上 11 条历史标记的核对，未执行生产操作。

## 注意事项

- 抵扣关联不依赖 membership id；覆盖课堂会重建快照，而插班前课程本来就没有快照行。
- 改成 present 的服务端写入在同一事务解除抵扣，前端根据 `unlinkedMakeupId` 精确移除一节，空记录继续保留。撤销仅写 status，不恢复抵扣。
- 两个视图共用 attendance 缓存。补课成功写后更新该班缓存，只失效该生收费明细和本班批次详情，不触发收费重算；冲突 409 重新拉取，保留草稿并剔除失效勾选。
- 旧时长 NULL 可保持未填，补填后不能再清空；新登记必须为 1–600 的整数分钟。新库没有 `made_up`，旧库迁移后清零且保留列，旧请求字段静默忽略。
- 本机默认 shell 为 Node 26，会使 jsdom 的既有 localStorage 测试报错；项目 `mise.toml` 固定 Node 24，因此测试、构建和开发服务均通过 `mise exec node@24 -- pnpm ...` 运行，无配置改动。

## 偏离 plan 的地方及原因

仅补充迁移的已有抵扣检测：按原步骤，在「升级迁移 → 回滚旧版 → 对同一格再开旧开关 → 再升级」时，插入重复关联会触发 UNIQUE 约束、阻止启动。先新增回归测试确认失败，再用 `NOT EXISTS` 跳过已有抵扣，保留原记录，最后仍统一清零旧标记。未改变已定产品决策。

人工流程第 8 步的 seed 没有现成排班和收款项，因此用本地已认证浏览器调用公开 API 准备了覆盖七节历史课的课程周期与批次；重置收款项、打开编辑弹窗均走实际 UI。

## 测试与验收

所有日志、脚本、截图均在 `tmp/2026-11-09-makeup-lesson-records/`（gitignored，本地归档）。

| 检查 | 结果 / 证据 |
|---|---|
| 服务端测试先行 | `server-red.log`：实现前 36 条失败；`migration-rollback-red.log`：回滚重复标记用例失败 |
| Web 数据层 / UI 测试先行 | `web-red.log`、`web-ui-red.log`：新增行为实现前失败 |
| server 全量 test | 10 个文件、333 条通过；`server-test-final.log` |
| web 全量 test | 43 个文件、537 条通过；`web-test-final.log` |
| 两包 `tsc --noEmit` | 通过；`server-tsc-final.log`、`web-tsc-final.log` |
| web 生产构建 | 通过；`web-build.log`，保留现有大 chunk 提示，未扩展本次范围 |
| UI 检查 | 已看桌面流程和 600px 列表截图；detector 对本次 UI 文件返回 `[]`，`ui-detect.json` |
| 浏览器错误 | `agent-browser errors` 无输出 |

plan 测试表的自动化用例索引：

| plan 用例 | 覆盖位置 |
|---|---|
| POST 完整 payload、排序、登记老师、插班无快照 | `server/tests/api.test.ts`：`creates complete payload...` |
| present / 未结束 / 跨班 / 归档 / 空与重复课程等拒绝；日期、时长、备注校验 | 同文件：参数化 `rejects invalid creation` 与 `rejects archived students...` |
| 认证与所有写接口组织隔离 | 同文件：`rejects archived students...guards authentication and org on all writes` |
| PUT 标量与抵扣替换、忽略换学生、DELETE、409、自身保留 | 同文件：`updates fields and replaces coverage...` |
| NULL 时长补填后不能清空 | 同文件：`allows legacy null duration...` |
| 请假不解除、到勤返回解除 id、撤销不恢复 | 同文件：`keeps coverage for leave...`；缓存矩阵的 `attendance present removes only...` |
| overwrite 保留缺席抵扣和请假座位，到勤解除 | 同文件：`preserves leave and makeup coverage...`、`drops a correction when the edit marks that student present again` |
| 旧库迁移字段、清零、幂等；新库无旧列 | `server/tests/provision.test.ts`：`migrate` 下三个补课用例，含回滚重复标记 |
| 到堂统计与收费明细含无快照抵扣，仅创建/重置刷新，金额不变 | `server/src/lib/billing.test.ts`、`server/tests/billing.test.ts`；API 的 `counts covered absence and off-roster...` |
| 学生 / 班级 / 课堂删除、admin 全表残留 | API 的参数化 `cleans coverage on ... deletion` 及原 admin 残留扫描 |
| 课堂提交向后/向前兼容、旧更正 madeUp 忽略 | 原兼容守卫未改；API 的 `ignores the legacy makeup flag...` |
| 候选集、三种 reason、表单校验、文案、含归档历史的筛选 | `web/src/lib/makeup.test.ts` |
| 无快照统计、插班标签、CSV | `web/src/lib/attendance.test.ts`、`web/src/lib/makeup.test.ts` |
| 增改删缓存矩阵、收费失效、c2 不受影响、到勤解除一节 | `web/src/queries/cache-effects.test.tsx` |
| 视图/空态、格子预选与保存、到勤确认、409提示刷新且保留草稿 | `web/src/pages/ClassAttendance.test.tsx` 四条 App 级用例 |
| 三个请求契约与 hooks 清单 | `web/src/api/contract.test.ts`、`web/src/queries/inventory.test.ts` |

agent-browser 人工流程与截图索引：

| 步骤 | 实际结果 | 截图 / 证据 |
|---|---|---|
| 1 | wangli 登录，Tom 5/15 缺勤、5/22 请假 | `01-absence-leave.png` |
| 2 | 班级详情添加 MakeupY，七节历史课全部未在班 | `02-new-student-off.png` |
| 3 | 空态 → MakeupY 前三节、60 分钟、备注 → 三格蓝 ✓补、3/3；刷新保留 view | `03a-empty-list.png`、`03b-form-y.png`、`03c-y-covered-three.png` |
| 4 | Tom 缺勤格预选学生与课程，保存后蓝 ✓补，提示含原状态、日期、时长 | `04a-tom-preselected.png`、`04b-tom-covered-tooltip.png` |
| 5 | 编辑 MakeupY 取消第三节，该格恢复未在班、统计 2/2 | `05-y-remove-one.png` |
| 6 | Tom 到勤二次确认，空抵扣记录保留；删除再次确认并成功 | `06a-unlink-confirm.png`、`06b-empty-coverage-retained.png`、`06c-delete-confirm.png`、`06d-deleted.png` |
| 7 | 真实点击导出，捕获 Blob 文本，MakeupY 两格为「未在班（已补课）」 | `07-exported.png`、`07-export.csv.txt` |
| 8 | 重置收款项成功；MakeupY 已上到堂 2/7，明细两节未入班已补课，应收仍 ¥700 | `08a-reset-billing.png`、`08b-invoice-covered-lessons.png` |
| 9 | 关闭命名浏览器，执行清理并关闭自启 pnpm dev，5173/5177 无监听 | 清理前截图 `09a-narrow-list-before-cleanup.png`；清理动作见 `09-cleanup.log` |

验收前 `agent-inspect-session.sh` 显示 context 为 34%，由当前 agent 完成。清理执行 `mac-dev-cleanup --only browser --min-age 2`，保留可能被其它工作使用的近期浏览器；本次命名 session 已先显式关闭，清理显示 nothing to clean。

## 遗留问题

- 已部署（2026-11-09，hookploy `dp_1a1be61cbd9508dd569` succeeded，`/api/health` ok）。部署前在服务器留了快照 `/tmp/nce-class-pre-makeup-20261109.db`（含 11 个旧标记）。线上只读核对：`makeup_records` 11 条（启航班 8、六年级 3，时长均为 NULL），抵扣 11 条，`made_up=1` 剩 0，没有抵扣落在到勤格上。考勤页界面待老师账号登录确认，见 next-up。
- 已有离线写入暂停后自动恢复的问题仍按 `kb/known-issues.md` 跟进，本次未扩大修改范围。
- miniapp 未改动，未运行其测试。

## 相关文档

- [执行简报](../plans/2026-11-09-makeup-lesson-records-brief.md) — 本次执行范围与完成标准。
- [补课记录 plan](../plans/2026-11-09-makeup-lesson-records.md) — 实现依据，已勾选并注明迁移补充。
- [业务口径](../docs/business-rules.md) — 更新补课与收费统计。
- [课堂生命周期](../docs/classroom-session-lifecycle.md) — 更新覆盖课堂与抵扣解除。
- [Web 数据层](../docs/web-data-layer.md) — 参考缓存一致性与草稿规则。
- [验收指南](../docs/verification-guide.md) — 参考本地浏览器和弹窗表单操作。
- [部署后核对](../next-up.md) — 待部署时核对历史迁移。
- [已知问题](../known-issues.md) — 既有离线写入问题继续保留。
