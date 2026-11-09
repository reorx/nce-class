---
created: 2026-11-09
tags:
  - attendance
  - makeup
  - web
  - server
---

# 补课记录允许不抵扣任何课（提前补课）

## PRD

### 背景

补课记录（见 [补课记录 plan](2026-11-09-makeup-lesson-records.md)）上线后，老师在线上发现：一个学生如果没有可以抵扣的课，就保存不了补课记录。

实际教学里有「提前补」的情况：学生以前缺的课都补完了，但下周某节课确定会缺，于是先找时间补上。这时还没有缺课可以抵扣，老师却需要先把这次补课登记下来。现在的表单要求至少勾选一节课；没有可抵扣的课时，保存按钮直接不能点，这次补课就记不进去。

### 目标

登记或编辑补课时，「抵扣的课」改为选填。一节课都不勾也能保存，之后学生缺课了，老师再编辑这条记录，把那节课勾上。

### 功能与交互

#### 1. 登记 / 编辑补课表单

- 「抵扣的课」从必填改为选填，没勾任何课不再报「请至少选择一节课」。
- 该学生没有可抵扣的课时，提示改为「该学生暂时没有可抵扣的缺课，可以先登记，之后有缺课时再编辑这条记录勾选」，保存按钮可以点。
- 列表里有可抵扣的课、但一节都没勾时，同样可以保存。
- 编辑已有记录时，可以把原来勾选的课全部取消再保存，保存后这条记录不抵扣任何课。
- 学生、补课日期、时长的必填规则不变。

#### 2. 补课记录列表

不抵扣任何课的记录照常出现在列表里，「抵扣的课」一栏仍然醒目显示「未抵扣任何课」，提醒老师之后去关联。点开后的编辑表单列出该学生当前可抵扣的课，勾上保存，出勤表对应格子就变成已补。

#### 3. 删除确认

删除一条不抵扣任何课的记录时，确认文案为「确定删除这条补课记录吗？」，不再出现「它抵扣的 0 节课将恢复为原状态」。抵扣了课的记录保持原文案。

#### 4. 不受影响的地方

不抵扣任何课的记录不会让出勤表上的任何格子变成已补，出勤统计和收费参考也不变。

### 不做的事

- 出勤表格子弹窗不改：点开缺勤格子仍然只有「登记补课」，不提示该生已有未抵扣的记录，也不提供「用已有记录抵扣」。提前补课之后要关联，老师去「补课记录」里编辑那条记录。
- 不做「预补余额」之类的自动抵扣，学生以后缺课不会自动挂到未抵扣的记录上。
- 不改补课日期、时长、备注的规则。

### 验收标准

1. 选一个没有可抵扣缺课的学生，看到新提示，填好日期和时长后能保存；列表里出现这条记录，显示「未抵扣任何课」。
2. 有可抵扣的课但一节不勾，也能保存。
3. 编辑一条已抵扣课的记录，取消全部勾选后能保存；原来被抵扣的格子恢复为缺勤、请假或未在班。
4. 编辑一条不抵扣任何课的记录，勾上后来缺的课并保存，出勤表那一格显示已补，出勤统计按已补计算。
5. 删除不抵扣任何课的记录时，确认文案是「确定删除这条补课记录吗？」。
6. 不选学生、日期无效、时长为空或不是 1–600 的正整数时，仍然不能保存并在字段下方提示。

## Tech Design

### 现状

- 存储层已经允许一条记录不关联任何课：`makeup_records` 与 `makeup_record_sessions`（`server/src/db/ddl.ts`）是一对多关系，没有约束要求至少一行；`createMakeup` / `updateMakeup`（`server/src/db/mutations.ts`）对空数组只是不插入行。考勤更正把格子改成到勤时，会把记录的课全部解除，这种 0 节记录早就存在，列表也能正确显示（`formatMakeupSessions` 返回「未抵扣任何课」，`MakeupList.tsx` 给它加上 `makeup-warning` 样式）。
- 限制只在请求校验和表单两层：
  - 服务端 `parseMakeup`（`server/src/app.ts`）里，`!ids.length` 返回 400，错误信息是「请至少选择一节课，且不能重复」。POST `/api/classes/:id/makeups` 与 PUT `/api/makeups/:id` 共用这个函数。
  - 前端 `validateMakeupForm`（`web/src/lib/makeup.ts`）在 `sessionIds` 为空时返回「请至少选择一节课」。
  - `MakeupFormModal.tsx` 的保存按钮带 `disabled={!!draft.studentId && candidates.length === 0}`；没有候选时显示「该学生没有可抵扣的缺课」；删除确认写的是「删除后，它抵扣的 {n} 节课将恢复为原状态，确定吗？」。

### 方案

只放开校验和表单，存储、读取接口和缓存规则都不动。服务端 `sessionIds` 仍然要求是数组（元素是字符串、不能重复），只是允许为空。数组以外的值（包括缺少这个字段）仍然返回 400：前端每次都会发这个字段，缺字段说明调用方有问题，不该被当成空数组接受。

### 数据变动

无。不改表结构，不需要迁移；API 的请求和响应格式不变，只是 `sessionIds: []` 从被拒绝变为被接受。

### 逻辑变动

**server**

- `server/src/app.ts` `parseMakeup`：从 `sessionIds` 校验条件里去掉 `!ids.length`，错误信息改为「抵扣的课必须是不重复的课程 ID 列表」。后面的 for 循环对空数组自然跳过。

**web**

- `web/src/lib/makeup.ts` `validateMakeupForm`：删除 `sessionIds` 为空时的报错。`MakeupDraft` 类型不变。
- `web/src/components/MakeupFormModal.tsx`：
  - 保存按钮去掉 `disabled={!!draft.studentId && candidates.length === 0}`（`fieldset disabled={busy}` 照旧管提交中状态）。
  - `!candidates.length` 分支的提示改为「该学生暂时没有可抵扣的缺课，可以先登记，之后有缺课时再编辑这条记录勾选」。
  - 删除确认：`editing.sessionIds.length === 0` 时显示「确定删除这条补课记录吗？」，否则保持原文案。
  - `{errors.sessionIds && ...}` 那一行可以删掉，`validateMakeupForm` 不会再返回这个字段。
- `MakeupList.tsx`、`cache-effects.ts`、`api/attendance.ts` 都不用改：0 节记录的显示和写后缓存已经覆盖。

**文档**

- `kb/docs/business-rules.md`「出勤、作业与补课记录」：在「一条补课记录对应一名学生……」那条后补一句：抵扣的课可以为空，用于提前补课，之后编辑记录勾选；没有抵扣的记录在列表显示「未抵扣任何课」，不影响出勤表、统计和收费。原来写「全部抵扣被解除后……显示『未抵扣任何课』」的那条保留。
- `kb/plans/2026-11-09-makeup-lesson-records.md`：PRD 表单字段表里「抵扣的课 | 至少勾选一节」，以及「没有可抵扣的课时……此时保存按钮不可用」这两处已经不对，改成选填，并链接到本 plan；Tech Design 里 `sessionIds：非空数组` 改为「数组，可为空」。只改这几处，不重写原 plan。

### 实施步骤

- [x] 1. server 测试先行：在 `server/tests/api.test.ts` 的 `describe('makeup records（补课台账）')` 里，把 `{ sessionIds: [] }` 从 `rejects invalid creation` 表中移除，再补上 `{ sessionIds: undefined }`、`{ sessionIds: 'sess1' }`（仍应 400）；新增用例「creates and updates a record with no covered lessons」（断言见下）。跑测试，新用例应失败
- [x] 2. 改 `parseMakeup`，server 测试全绿，`pnpm --filter server exec tsc --noEmit` 通过
- [x] 3. web 单测先行：改 `web/src/lib/makeup.test.ts` 的 `validates each field ...` 用例（重命名，空 `sessionIds` 不再报错）；在 `web/src/pages/ClassAttendance.test.tsx` 新增页面级用例（见下）。跑测试，新用例应失败
- [x] 4. 改 `validateMakeupForm` 与 `MakeupFormModal.tsx`，web 测试全绿，`pnpm --filter web exec tsc --noEmit` 通过
- [x] 5. 更新 `kb/docs/business-rules.md` 与原补课 plan 里那几处
- [x] 6. agent-browser 端到端验证（见下），截图存到 `tmp/2026-11-09-makeup-without-coverage/`
- [x] 7. 提交（代码 + 文档 + 本 plan 勾选，一个 commit，commit message 按 AGENTS.md 格式）。**不要 push**：push master 会触发生产部署，由用户决定

### 测试与验证

**server（`server/tests/api.test.ts`）**

| 验收 | 用例 |
|---|---|
| 1 | POST `input({ sessionIds: [] })` 返回 201，`body.sessionIds` 为 `[]`；`GET /api/classes/c1/attendance` 的 `makeups` 里有这条，没有任何格子被它覆盖 |
| 3 | 先 POST 抵扣 `['sess1']`，再 PUT 同一条 `sessionIds: []` 返回 200；之后用 `sessionIds: ['sess1']` 新建另一条应成功（证明 sess1 已释放） |
| 4 | 对上面 0 节的记录 PUT `sessionIds: ['sess1']`，返回的 `sessionIds` 是 `['sess1']` |
| — | `sessionIds` 缺失、为字符串、有重复、含非字符串仍然 400（`rejects invalid creation` 表） |

**web**

- `web/src/lib/makeup.test.ts`：`validateMakeupForm({ ...draft, sessionIds: [] })` 返回 `{}`；空学生、空日期仍然报错，结果对象里没有 `sessionIds` 键。
- `web/src/pages/ClassAttendance.test.tsx`（默认 `f.attendance()` 里 s1 在 x1 到勤，正好没有可抵扣的课）：
  - 验收 1：切到「补课记录」→「登记补课」→ 选 Tom → 看到新提示文案 → 保存按钮可点 → 点时长 60 → 保存 → 断言 POST body 的 `sessionIds` 为 `[]`。
  - 验收 3：`GET attendance` 返回带 `makeups: [record]` 且 x1 是缺勤的数据，打开这条记录，取消勾选 x1 → 保存 → 断言 PUT body 的 `sessionIds` 为 `[]`。
  - 验收 5：`makeups: [{ ...record, sessionIds: [] }]`，打开记录 → 点「删除这条补课记录」→ 看到「确定删除这条补课记录吗？」。
- 现有测试里没有断言旧文案「请至少选择一节课」「该学生没有可抵扣的缺课」，改文案不会打断它们。

**端到端（agent-browser，按 `kb/docs/verification-guide.md`；弹窗表单的 `@e` 引用会失效，改用 `eval`）**

1. `pnpm db:reset` 后起 `pnpm dev`（先按 AGENTS.md 检查 5173/5177 有没有被别的项目占用），用 `wangli` / `demo1234` 登录。
2. 打开某个班的 `/classes/:id/attendance?view=makeups`，登记补课时选一个全勤的学生（看出勤表挑一个全是 ✓ 的），确认看到新提示，填 60 分钟保存 → 列表里出现「未抵扣任何课」。截图。
3. 回出勤表，把这个学生的某一格改成缺勤；回补课记录，打开刚才那条，勾上这节课保存 → 出勤表那格显示蓝色 ✓「补」。截图。
4. 再打开这条记录，取消勾选保存 → 格子恢复为缺勤；删除这条记录，确认文案是「确定删除这条补课记录吗？」。截图。
5. 验证完关掉 agent-browser 会话，跑 `mac-dev-cleanup --only browser`。

### 风险与待定

- 遇到 409 时，表单会刷新候选，并取消勾选已经被别人抵扣的课，同时提示「部分课程已不可抵扣，已取消勾选，请重新选择」。以前勾选被清空后保存会被拦下，现在可以直接存成一条 0 节记录。提示仍然显示，「已选 0 节」也看得见，所以不额外拦截。真实使用中如果出现误存，再考虑这种情况下要求确认。
