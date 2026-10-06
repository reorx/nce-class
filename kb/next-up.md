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
