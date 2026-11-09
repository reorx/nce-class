# Next up

> 接下来要做的事，按时间排。做完一项就删掉，结果记到条目指定的 kb 文档，这里不留记录。

## push master 部署之后（2026-09-28 的 5 个提交，含 better-sqlite3 11 → 13 升级）

- **镜像构建与启动**：GitHub Actions 构建成功，hookploy 部署后容器正常起来、`/api/health` 返回 ok，启动日志里 migrate 无报错。命令与查日志方式见 `kb/docs/deploy-and-ops.md`。
- **收银台时间显示**：线上打开任一收款批次，「快照于」和已收款时间应与北京时间一致（此前慢 8 小时）。
  → 结果记到 `kb/sessions/2026-09-28-resolve-known-issues.md`「遗留问题」，有异常则登记 `kb/known-issues.md`

## push master 部署之后（2026-10-06 应收改为全班一致）

- **重置线上收款项**：部署后逐个打开 5 个收款项点「重置收款项」→「重新计算收款项」（条款不用改）。至少要做启航班、六年级、四年级三个，它们现在有学生按旧口径少收。全部都是未收款、没改过金额的行，重置后应收与最终金额都回到标准值。
- **核对**：启航班 12 人每人 ¥2,400，合计 ¥28,800；其余批次每人 = 单价 × 课程次数 + 附加费（四年级、三年级🌸 ¥2,200，六年级 ¥2,400，八年级 ¥2,900）。只读查库：`SELECT batch_id, COUNT(*), MIN(final_amount_cents), MAX(final_amount_cents) FROM invoices GROUP BY batch_id`，每个批次 MIN = MAX。
  → 核对完删掉本节；有异常登记 `kb/known-issues.md`

## `web-query-foundation` 合并并 push master 部署之后（Web 请求层迁到 TanStack Query）

- **收银台往返**：线上打开收银台 → 进任一收款项 → 30 秒内返回，列表应立即显示、DevTools 网络里没有新的 `/api/billing/batches` 请求；超过 30 秒返回先显示旧列表再后台刷新。
- **退出与重新登录**：在任一页面退出 → 换账号登录应落在首页，不回到上个账号的页面。
- **课堂本地优先**：开一节测试课加几分，断网刷新页面仍能进课堂、分数不丢；联网后结束课堂只落库一节（只读查 `class_sessions` 该班最新一行）。用完删除测试课堂记录。
  → 结果记到 `kb/sessions/2026-10-07-web-query-component-migration.md`「遗留问题」；有异常登记 `kb/known-issues.md`

## push master 部署之后（2026-10-07 组分改为「组员个人分之和 + 小组独立分」）

- **线上历史课受影响范围**：组分是读时派生，部署后历史课也按新口径重算。只读查库列出「加分时所在组 ≠ 最终到堂所在组」的节次，这些课的 recap / 课堂情况 / 成长档案 / 小程序组分会变：
  `SELECT e.session_id, COUNT(*) FROM score_events e LEFT JOIN session_memberships sm ON sm.session_id=e.session_id AND sm.student_id=e.target_id WHERE e.target_type='student' AND e.session_group_id IS NOT (CASE WHEN sm.attendance='present' THEN sm.session_group_id END) GROUP BY e.session_id`
  挑一节打开课堂情况，核对每组分数 = 到堂组员个人分之和 + 小组独立分。
  → 受影响节次告诉老师（已发出去的旧战报图里组分会和线上对不上）；核对完删掉本节

## 单个学生收款条目删除功能部署之后（2026-10-13）

- **删除入口与隔离**：核对待收款编辑弹窗有删除和二次确认；实际删除时核对当前人数与最终合计，其他条目的金额、备注与收款时间不变。Jimmy 已在生产只读副本完成本地验证，线上尚未删除；上线后的数据修改需按用户当时指示执行。
  → 结果记到 `kb/sessions/2026-10-13-delete-student-invoice.md`

## 补课记录已部署（2026-11-09），需老师账号在线上看一眼

- **历史展示**：线上登录后打开启航班、六年级考勤页，原来的 11 格应显示蓝色 ✓「补」；切到「补课记录」应有对应条目（启航班 8、六年级 3），时长显示「未记录时长」。库里的迁移结果已核对无误，这里只差界面确认。
- **清理部署前快照**：确认无误后删掉服务器上的 `/tmp/nce-class-pre-makeup-20261109.db`（`ssh tc-sg-01 'rm /tmp/nce-class-pre-makeup-20261109.db'`）。
  → 结果记到 `kb/sessions/2026-11-09-makeup-lesson-records.md`「遗留问题」，完成后删除本节；有异常登记 `kb/known-issues.md`。
