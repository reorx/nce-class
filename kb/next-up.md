# Next up

> 接下来要做的事，按时间排。做完一项就删掉，结果记到条目指定的 kb 文档，这里不留记录。

## push master 部署之后（2026-09-28 的 5 个提交，含 better-sqlite3 11 → 13 升级）

- **镜像构建与启动**：GitHub Actions 构建成功，hookploy 部署后容器正常起来、`/api/health` 返回 ok，启动日志里 migrate 无报错。命令与查日志方式见 `kb/docs/deploy-and-ops.md`。
- **收银台时间显示**：线上打开任一收款批次，「快照于」和已收款时间应与北京时间一致（此前慢 8 小时）。
  → 结果记到 `kb/sessions/2026-09-28-resolve-known-issues.md`「遗留问题」，有异常则登记 `kb/known-issues.md`
