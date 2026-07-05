---
created: 2026-07-04
tags:
  - note
  - nce-class
  - miniapp
  - wechat
  - launch
---

# 小程序邀请功能上线链路缺失项（mock → 真微信）

> 结论（2026-07-04 排查）：邀请学生加入班级的**功能代码已是完成态**——生成邀请（`useShareAppMessage` 分享卡片）→ join 页表单 → join_request 队列 → 老师关联，h5 三角色端到端已验证（见 [[2026-07-02-nce-class-wechat-account-invite]]）。剩下的全是「从 mock 到真微信」的壳，按依赖顺序列出。
>
> 生产后端已就绪：`https://service.domain/api/health` 返回 200（2026-07-04 验证）。

## 缺失项清单（按依赖顺序）

### 1. ✅ 注册正式 appid（2026-07-04 已拿到）

- appid `wx19490e22f3580fb0` 已写入 `miniapp/project.config.json`（secret 在 gitignored 的 `tmp/wx_miniprogram.txt`，勿入库）。真机预览、`cli preview`/`cli upload` 解锁。
- **个人主体可行，但有一项付费认证**（2026-07-05 修正——原「分享不需要认证」是 2023 前的旧知识）：2023 底起所有小程序须完成年度「**小程序认证**」（个人主体 30 元/年，人脸核身；与企业「微信认证」是两回事），否则**限制发版/搜索/分享**——分享卡片被封即此因，见第 7 项。`wx.getPhoneNumber` 才要企业认证（手机号手填方案已落地）。

### 2. ✅ 服务端接真 code2session（2026-07-04 已配置生产）

- server.name `/opt/apps/nce-class/.env`：已**删除 `WX_MOCK=1`**、加上 `WX_APPID`/`WX_SECRET`，容器已重建（改前备份 `.env.bak`）。验证：health 200，`mock:dev-teacher` code 登录返回 401（mock 通道已关死）。
- 本地开发不受影响（server dev 脚本自带 `WX_MOCK=1`）。本地要测真实登录链路时用 `WX_MOCK= WX_APPID=... WX_SECRET=... pnpm --filter server dev` 覆盖。

### 3. ✅ miniapp API BASE 环境化 + mp 后台域名白名单（2026-07-05 全部完成）

- `miniapp/src/lib/api.ts` 已按 `NODE_ENV` 切：`dev:weapp`（watch）→ `http://localhost:5177`，`build:weapp` → `https://service.domain`（已验证 dist 产物只含生产域名）。
- mp 后台 request / uploadFile / downloadFile 三类合法域名已配 `https://service.domain`（用户 2026-07-05 完成）。
- 开发者工具里 `urlCheck: false` 只对本地调试生效，真机/正式版走白名单。

### 4. 微信开发者工具人工过一遍 weapp 产物（AGENTS.md 待做挂着的）

h5 是可自动化的替身，以下原生能力只能在工具/真机人工验证：

- teacher/class 页「分享到微信群」：`open-type="share"` 按钮弹分享卡片，确认转发 path 是 `pages/join/index?invite=<token>`。
- join 页 `chooseImage` 选图 → 上传。
- 关联/忽略的 `showModal` 确认弹窗。
- 操作步骤（CLI 打开、mock 登录 console 命令）见 AGENTS.md「微信开发者工具（weapp 本地调试）」一节。

### 5. ✅(上传) 体验版 → 审核发布（2026-07-05 首个版本已传，待后台设体验版）

- `miniprogram-ci` 已跑通：`pnpm --filter miniapp preview:weapp`（二维码 → `tmp/weapp-preview-qr.jpg`）/ `upload:weapp`（已传 **0.1.0**，描述 `f66b3b9 2026-07-05 邀请+recap M1`，robot 1）。密钥在 `tmp/private.wx19490e22f3580fb0.key`（gitignored）。
- **踩过的坑（复现必看）**：
  - Homebrew **node 25 跑不了 miniprogram-ci**（编译期 `getItem is not a function`、`--enable-es6` 时 worker `close` 崩）→ 用 nvm node 24：`PATH="$HOME/.nvm/versions/node/v24.6.0/bin:$PATH" pnpm --filter miniapp <script>`。
  - 微信 CI 校验器（-80057）**不认 ES2020 语法**（`??`/`?.`），而 Taro 原 browserslist（es6-module）会保留它们 → miniapp `browserslist` 已锁 `chrome >= 60, ios >= 10`，**勿改回**。微信侧 `--enable-es6` 转译不可靠（worker 崩），保持本地转译方案。
- **剩余人工两步**：mp 后台「版本管理」把 0.1.0 设为**体验版**并把老师/家长加为体验成员；正式发布需过审核（教育类目一般顺利，预留被打回余量）。

### 6. ✅ 首个真实老师账号的绑定（2026-07-05 真机验证通过）

- 生产库是干净库 + `create-teacher` 建号（无 seed mock 账户）。老师首次进小程序走 `pages/bind` 用 web 用户名+密码绑定 wechat_account——**体验版真机实测绑定成功**（真 wx.login → 生产 code2session → bind 全链路通）。要写进给老师的使用说明里。

### 7. ⚠️ 小程序认证（2026-07-05 真机测出，当前唯一阻塞项）

- **现象**：体验版真机上老师生成邀请后点分享，被提示「由于小程序未完成认证」无法分享。
- **原因**：微信 2023 底政策——所有小程序（含个人主体）须完成年度「小程序认证」，未认证限制**发版/被搜索/分享**（[蓝点网报道](https://www.landiannews.com/archives/101017.html)、[知乎梳理](https://zhuanlan.zhihu.com/p/716290833)）。
- **解决**：mp 后台 → 设置 → 基本设置 → 小程序认证，个人主体 **30 元/年** + 人脸核身，当天即可生效。完成后分享卡片（邀请 + 将来的 recap 分享）恢复可用。
- 注意这是**年审**：每年到期要续认证，过期分享会再次被封。

## 不阻塞上线的后续项

- 小程序码 scene 扫码邀请（分享卡片已够用，nice-to-have）。
- ~~`cli upload` 自动化发版~~ → 已改用 `miniprogram-ci`（见第 5 项），后续可考虑挂进 `deploy/release.sh`。

## 相关文档

- [[2026-07-02-nce-class-wechat-account-invite]] — 邀请与账户体系的功能实现 plan（本笔记的前提）
- [[2026-07-02-nce-class-deploy]] — 生产部署方式（第 2 项 env 的落点）
- [[../plans/2026-07-04-nce-class-recap-wechat-share]] — recap 分享到微信群 plan（功能二，依赖本清单打通真机分享）
