---
created: 2026-09-28
tags:
  - deploy
  - ops
  - miniapp
  - runbook
---

# 部署与运维

写给要发版、开账号、重置密码、授予管理员或上传小程序的人：每件事怎么做，要注意什么。

服务器侧的细节（compose、部署脚本、Caddy 路由、生产环境只读查库的命令）不在本仓库，由 deploy 工作区管理，见那边的 `kb/docs/nce-class.md`。

## Web 与服务端发版

push 到 master 即发版：

1. GitHub Actions（`.github/workflows/deploy.yml`）构建镜像并推到 ghcr。server 与 web 的构建产物在同一个镜像里。
2. CI 带着镜像 digest 调用服务器上的 hookploy，由它拉镜像、迁移数据库、重启容器、做健康检查。

要点：

- **只改 `kb/**`、`miniapp/**` 或 `.md` 文件不会触发部署。**
- hookploy 是异步的，收到请求立即返回。CI 变绿只说明构建和触发成功，部署是否成功要在服务器上用 `hookploy deploys nce-class` 确认。
- CI 用到两个仓库 Secret：`HOOKPLOY_TOKEN` 和 `HOOKPLOY_URL`（不带路径的 base URL）。仓库是公开的，基础设施域名不要写进代码或文档。
- 容器只跑 API；web 静态文件从镜像里拷出来，由宿主机的 Caddy 提供。
- 数据库迁移是幂等的，服务启动时自动执行，发版不需要手动迁移。需要单独跑时用 `pnpm --filter server db:migrate`。

## 环境变量

变量名以仓库根的 `.env.example` 为准，真实值在服务器上手填。

`AUTH_SECRET` 在生产必须显式设置，缺失时服务启动即报错。开发环境有内置的 fallback。

接真微信需要设置 `WX_APPID` 和 `WX_SECRET`，并且不带 `WX_MOCK`。

## 账号管理

以下命令在本地直接运行。生产环境在容器内执行，前面加 `docker compose exec app`；从远程执行需要 `ssh -t`，因为密码是交互输入的。

| 要做的事 | 命令 |
|---|---|
| 干净库开账号 | `pnpm --filter server create-teacher` |
| 开首个账号并设为管理员 | `pnpm --filter server create-teacher ... --admin` |
| 重置密码 | `pnpm --filter server reset-password -- --username <登录名>` |
| 授予管理员 | `pnpm --filter server set-admin -- --username <登录名>` |
| 撤销管理员 | `pnpm --filter server set-admin -- --username <登录名> --revoke` |

- 重置密码不需要登录。新密码交互输入两次，不回显；也接受管道传入两行。
- `reset-password` 和 `set-admin` 不带登录名或登录名不存在时，会列出库里全部登录名，`set-admin` 还会标出谁是管理员。
- 管理员变更在对方下一次请求时生效，不需要重新登录。
- 已是管理员的人也可以在 `/admin` 页面添加老师和修改成员密码。

### 两个要小心的地方

**旧库升级后没有任何管理员。** 管理员字段的迁移不回填，升级后需要手动 `set-admin` 指定第一个管理员。

**改密码不会踢掉已登录的会话。** 老师会话是无状态的签名 cookie，有效期 7 天，服务端没有会话表可以吊销。怀疑密码泄露时，除了改密码，还要轮换 `AUTH_SECRET`，这会让所有人重新登录。

## 小程序上传

小程序不走 CI，始终在本地上传，因为上传密钥只存在本地。

```bash
mise x node@24 -- pnpm --filter miniapp preview:weapp   # 生成真机预览二维码 → tmp/weapp-preview-qr.jpg
mise x node@24 -- pnpm --filter miniapp upload:weapp    # 上传为开发版，版本号取自 miniapp/package.json
```

- 必须用 node 24。node 25 跑不了 miniprogram-ci。
- 上传密钥在 `tmp/private.<appid>.key`，不进仓库。
- 生产 API 域名来自 `miniapp/.env.production.local` 里的 `TARO_APP_API_BASE`，不进仓库，缺失时构建直接报错。
- preview 打的也是正式构建，扫码后直连生产数据。
- 上传后还需要在微信公众平台后台设为体验版、提审、发布。

上线进度与验收清单见 `kb/docs/miniapp-status-and-roadmap.md`。

## 相关文件

- `.github/workflows/deploy.yml`、`Dockerfile`
- `.env.example`
- `server/src/db/provision.ts` — 迁移与账号操作的实现；`create-teacher.ts`、`reset-password.ts`、`set-admin.ts` 是命令行入口
- `miniapp/package.json` — preview / upload 脚本
