---
created: 2026-07-02
tags:
  - plan
  - milestone-1
  - nce-class
  - miniapp
  - storage
---

# NCE Class · M1 学生端小程序 Plan（Taro 双端 + 邀请加入 + recap + 存储落地）

> 学生端从 PRD §7.5 的「微信内 H5」改为**微信小程序**（用户 2026-07-02 决定）。本 plan 覆盖：存储抽象层落地（Minio/OSS，参考 `../tenderbuddy/packages/core/src/storage/`）、服务端免登录学生 API（邀请加入 + 个性化 recap）、管理端邀请页接真数据、Taro 小程序端。
>
> ⚠️ 决策 1–4 是在用户暂离时按推荐方案拍板的，随时可推翻重调。

## 已定决策

1. **技术栈：Taro 4 + React + TS**，pnpm workspace 新增 `miniapp/` 包。与 web 端同为 React/TS，心智成本最低。
2. **双编译目标：weapp 为正式产物，h5 为开发/测试兜底**。同一套代码 `pnpm dev:h5` 起浏览器可跑版本（agent-browser 可端到端测），weapp 用微信开发者工具预览。PRD「链接转发微信群」的分发方式由 h5 产物保留。
3. **家长凭据：沿用 `recapToken` bearer + 小程序本地 storage**。加入班级后 token 存 `wx.storage`（支持多孩子 token 列表 + 切换），下次打开直达自家孩子 recap。不依赖微信登录，无 appid 可全流程开发；架构上预留 openid 绑定（credentials 表模式同理）。
4. **暂无 appid**：开发者工具游客模式（touristappid）。邀请入口 M1 用**输入邀请码**；日后有正式 appid 再加「小程序码 scene 扫码进入」，服务端邀请码模型不变。
5. **照片上传走服务端中转**（multipart → `storageClient.putObject`），不用 presigned PUT——`wx.uploadFile` 只支持 POST multipart，中转最省事且照片很小。
6. **存储接口保持现有简化版**（`putObject/getUrl/deleteObject`，`getUrl` 同步），不照搬 tenderbuddy 的 presigned 接口。Minio/OSS 桶按 **public-read** 处理（Minio `ensureBucket` 时设桶策略；OSS 建桶时人工设），`getUrl` 由 endpoint/bucket/customDomain 拼公开 URL。签名 URL 会过期，与「recap 页长期可看」冲突；照片非敏感，M1 接受，隐私边界仍是 recapToken。
7. **DB 存 key 不存 URL**：`students.photo_url` 列改存 storage key（现网数据全为 null，无迁移负担），读侧用 `storageClient.getUrl(key)` 解析，换 vendor 不坏历史数据。列名不改。
8. **邀请码 = `classes.invite_token`**（新列，TEXT UNIQUE NOT NULL）：seed 用固定值保 demo 稳定（如 `c1-x8kq2mlp`），`createClass` 用 `nanoid(10)`（小写化，家长要手输）。管理端邀请 tab 展示真码。

## 背景与现状

- `server/src/storage/`：`StorageClient` 抽象 + local 实现已有；`index.ts` 里 minio/oss 分支是 throw 的 TODO。tenderbuddy 参考实现：`minio` SDK / `ali-oss` SDK，`S3_*` 环境变量，`S3_VENDOR` switch。
- `students.recap_token` 建表即有且 UNIQUE，但无任何路由使用；`photo_url` 只用于 `hasPhoto` 布尔。
- 邀请链接是硬编码假链接（`app.ts` classDetailPayload `inviteLink`）。
- auth gate 拦截 `/api/*` 仅放行 `/health`、`/auth/login`——学生端路由需加入放行清单（或挂 `/api/parent/*` 前缀统一放行）。
- recap 派生 `buildRecap(s)` 已有（组排名 + 🌟/⚠️ + 出勤），缺「本人个性化卡」和「本人所在组高亮」。

## 服务端 API（免登录，token 即凭据）

全部挂 `/api/parent/*` 前缀，auth gate 一条前缀放行。org 隔离天然成立：token → 唯一实体 → 顺藤摸瓜，不跨查。

### 邀请加入（onboarding）
- `GET /api/parent/join/:inviteToken` → 班级预览 `{ className, level, teacherName, orgName, studentCount }`；未知 token 404。
- `POST /api/parent/join/:inviteToken/photo` → multipart 单文件 `photo`（multer，≤5MB，仅 image/*）→ 存 `students/<nanoid>.<ext>` → `{ key, url }`。上传先于建学生，key 随 join 提交。
- `POST /api/parent/join/:inviteToken` → `{ name, photoKey? }` → 建学生（`source='parent'`，`photo_url=photoKey`，新 `recapToken`）→ `{ recapToken, studentId, name, className }`。**不做认领/查重**（PRD §7.5：重复靠老师管理端删除）。

### recap（学生专属）
- `GET /api/parent/me/:recapToken` → `{ student: { id, name, photoUrl }, class: { name, level, teacherName, orgName }, sessions: [{ id, date, weekday, lessonNumber, lessonTitle }...(ended, 新→旧)], latestSessionId }`
- `GET /api/parent/me/:recapToken/sessions/:sessionId` → `buildRecap` 基础上增加：
  - `mine`: `{ attended: bool|null, groupName, groupEmoji, personalScore, homework: '完成'|'没交', recitation: '已背完'|'背完部分'|'没背'|'未检查' }`；该生无 membership（入班晚于该堂课）→ `mine: null`，前端显示「未参加本堂课」。
  - `groups[].mine: bool`（本人所在组高亮）。
  - session 不属于该生班级 → 404。
  - 口径：personalScore 只算 `targetType='student'` 事件；作业缺记录=没交；背书缺记录=未检查（PRD §8）。

### 管理端
- `GET /api/classes/:id` 的 `inviteLink` 假数据 → 换 `inviteToken` 真值；web 邀请 tab 展示邀请码（大字 + 复制）+ 使用说明（家长在小程序里输码）。

## 存储落地（参考 tenderbuddy）

- `server/src/storage/minio.ts`：`minio` SDK；endpoint 解析 host/port/SSL 同 tenderbuddy；`ensureBucket` 建桶 + 设 public-read 桶策略；`putObject` → `client.putObject`；`getUrl` 拼 `<scheme>://<endpoint>/<bucket>/<key>`（有 customDomain 优先）。
- `server/src/storage/oss.ts`：`ali-oss` SDK；cname 判定同 tenderbuddy；`getUrl` 拼 customDomain 或 `https://<bucket>.<endpoint>/<key>`。
- `index.ts`：`S3_VENDOR=local|minio|oss` switch 落实，读 `S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY/S3_CUSTOM_DOMAIN`；缺配置时报错。**local 仍是默认**，dev/test 不需要跑 Minio。
- 测试：vendor switch + 各 client 的 `getUrl` 纯函数断言（不打真网络）；local 的 put/delete 已有行为保持。

## 小程序端（miniapp/）

```
miniapp/
  package.json          Taro 4 + @tarojs/plugin-framework-react
  project.config.json   appid: touristappid（游客模式）
  config/index.ts       h5 devServer 代理 /api → :5177
  src/app.config.ts     pages: index / join/index / recap/index
  src/lib/api.ts        Taro.request 封装（BASE_URL 按环境）
  src/lib/children.ts   本地孩子列表（token CRUD + 当前选中），纯函数可单测
  src/pages/index/      无 token → 引导去 join；有 token → 最新 recap + 历史列表 + 多孩切换
  src/pages/join/       输邀请码 → 班级预览 → 传照片(wx.chooseMedia+uploadFile) + 填名字 → 确认加入 → 存 token → 回 index
  src/pages/recap/      单堂 recap（本人卡 / 🏆各组得分含高亮 / 🌟 / ⚠️），?sid= 参数
```

- UI 还原 `kb/prototypes/08-student-h5.html`（本人卡渐变黄、rank 行、badge 名单、绿 CTA）。
- 纯逻辑（children 列表、recap 数据整形）出 lib 配 vitest；页面层 h5 编译后 agent-browser 过流程。

## 测试计划（BDD 先行）

server（vitest+supertest，`setupTestApp` harness，先写用例再实现）：
1. 邀请预览：有效 token 200 返回班级信息；无效 404；**免登录可访问**。
2. 加入：建学生 source=parent、发 recapToken、photoKey 落 photo_url；名字必填 400；无效 token 404。
3. 照片上传：multipart 存文件返回 key；非图片/超限 400。
4. me：token → 学生+班级+ended sessions（新→旧）+ latestSessionId；无效 token 404。
5. 个性化 recap：出席学生的 mine 四项口径（个人分只算 student 事件 / 作业缺记录=没交 / 背书缺记录=未检查）+ groups[].mine 高亮；缺席学生 attended=false；无 membership → mine=null；跨班 session 404。
6. auth gate 回归：`/api/parent/*` 放行不影响其余 401。
7. 存储 switch / getUrl 单测。

miniapp：`lib/children.ts`、recap 整形函数 vitest；h5 端到端（join 全流程 → recap 渲染）用 agent-browser。

## 任务拆解（可独立验证的顺序）

1. **存储**：minio.ts / oss.ts / index.ts switch + 单测（`pnpm add --filter server minio ali-oss`）。
2. **schema/seed**：classes.invite_token（schema+ddl+seed 固定值+createClass 生成）；`db:reset` 后 sqlite3 断言。
3. **服务端学生 API**：测试先行 → `/api/parent/*` 路由（multer 上传、join、me、个性化 recap）→ 全绿。
4. **管理端邀请 tab**：inviteToken 真值 + 展示改版。
5. **miniapp 脚手架**：Taro init 进 workspace，h5/weapp 双起跑通 hello。
6. **miniapp 三页**：join / index / recap + lib 单测。
7. **端到端**：h5 全流程（agent-browser）+ 开发者工具手动过 weapp（用户侧验证）。

## 不在本 plan 内

- openid 绑定 / wx.login、小程序码 scene 扫码邀请（等正式 appid）。
- 小程序发布、域名白名单配置（生产部署阶段）。
- 老师端学生成长档案 §7.4（下一个 plan）。
- 疑似重复学生合并（M1 已砍，靠删除）。
