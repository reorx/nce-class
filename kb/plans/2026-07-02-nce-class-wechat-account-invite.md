---
created: 2026-07-02
tags:
  - plan
  - milestone-1
  - nce-class
  - miniapp
  - auth
  - refactor
---

# NCE Class · 邀请与账户体系重构 Plan（wechat_account 分离 + 小程序内生成邀请/关联队列）

> 取代 [[2026-07-02-nce-class-student-miniapp]] 中「固定班级邀请码 + 手输 + recapToken 本地存储」的邀请/凭据方案（该 plan 的存储层、/api/parent recap 派生口径、miniapp 骨架继续沿用）。
>
> 依据用户 2026-07-02 的结构澄清：**student 与 wechat_account 分开看待**——student 是教师建立的教学实体，一切教学数据围绕它；wechat_account 是微信用户身份，注册只创建 wechat_account，**由老师负责把 wechat_account 关联到 student**，学生无此权限。学生始终不注册，课程照常进行。

## 已定需求（用户给定，不可更改）

1. student / wechat_account 二元结构如上；wechat_account 的核心目的是让微信登录用户访问其对应 student 的数据（recap、成长档案）。
2. 邀请流程：老师**登录小程序**（teacher 也对应 wechat_account）→ 小程序端班级管理页 → 选班级 → 点「生成邀请」→ 分享到微信群。
3. 学生点群里的小程序分享卡片 → 填**中文名、英文名、家长手机号、头像照片** → 确认加入班级（此时只建 wechat_account + 注册信息，不建 student）。
4. 老师在小程序班级管理页点「邀请队列」→ 看到已注册的微信账户 → 点一个 → **关联到已存在的 student**（student 由 web 端班级管理创建）。

## 展开设计（我拍板的部分，可推翻）

- **wechat_account 是纯身份表**，老师/家长共用一张表；「是老师还是家长」由关联关系决定，不在账户上打角色标。
- **teacher ↔ wechat_account 用 credentials 表**（该表当初就为此预留）：`credentials` 加 `wechat_account_id` 列，绑定时插一行 `provider='wechat'`。绑定入口：小程序里首次登录后输**一次** web 端用户名+密码完成绑定（自助、无需管理后台）。
- **student ↔ wechat_account 用独立映射表** `student_wechat_bindings`（N:M）：一个家长账户可关联多个孩子（多孩），一个学生可被多个账户关联（父母都看）。旧「本地 nce.children 列表」废弃，孩子列表改由服务端 bindings 派生。
- **注册产物是 join_request**（邀请队列条目）：`{class, wechat_account, 中文名, 英文名, 家长手机号, photoKey, status}`。老师关联时可把照片/英文名/手机号**回填到 student 的空字段**（不覆盖已有值）。
- **邀请是一次性生成的带过期 token**（默认 7 天，可反复生成，新旧并存到各自过期），不再是班级固定码；`classes.invite_token` 列废弃删除。
- **会话**：小程序不用 cookie，改 **Bearer token**。`wx.login` code → 服务端 code2session → upsert wechat_account → 签发 HMAC token（复用 `auth/session.ts` 的签名思路，subject 从 teacherId 换成 wechatAccountId），小程序存 storage、每请求带 `Authorization: Bearer`。
- **无 appid 的开发方案（关键）**：`WX_MOCK=1` 时 code2session 走本地 stub——`code = 'mock:<name>'` 确定性映射 `openid = 'mock-openid-<name>'`。seed 预置三个 mock 账户：`dev-teacher`（已绑 wangli）、`dev-parent`（已绑 s-c1-1 小明）、`dev-new`（全新）。h5 端 `lib/wxAuth.ts` 在 TARO_ENV=h5 时用 localStorage 里的 mock name 发 code，agent-browser 端到端全流程可测；weapp + 测试号/正式 appid 时走真 code2session。
- 家长手机号：手动填写（`wx.getPhoneNumber` 需企业认证，不用），仅存 join_request / 回填 student，格式校验 11 位。
- recapToken 机制整体退役：`/api/parent/*` 路由删除，`students.recap_token` 列保留不删（将来 H5 无登录分享可能复用），web 邀请 tab 改为「去小程序生成邀请」说明 + 邀请队列只读列表。

## 数据模型（新增/变更）

```
wechat_accounts(id, openid UNIQUE, unionid?, nickname?, avatar_url?, created_at, last_login_at)
student_wechat_bindings(id, student_id FK, wechat_account_id FK, created_by(teacher), created_at,
                        UNIQUE(student_id, wechat_account_id))
class_invites(id, class_id FK, token UNIQUE(nanoid 16), created_by, created_at, expires_at)
join_requests(id, class_id FK, wechat_account_id FK, invite_id FK, cn_name, en_name?, parent_phone?,
              photo_key?, status[pending|linked|dismissed], linked_student_id?, handled_by?, handled_at?,
              created_at, UNIQUE(class_id, wechat_account_id) WHERE status='pending')
credentials                + wechat_account_id 列（provider='wechat' 行使用）
students                   + en_name?, parent_phone? 列（关联时回填空字段）
classes                    − invite_token 列（删除；ddl/seed/tests 同步）
```

## API（全部挂 `/api/wx/*`，Bearer token 中间件；auth gate 三分：公开 /wx/login、wx 会话、老师 cookie 会话）

**会话/身份**
- `POST /api/wx/login` `{code}` → code2session（或 mock）→ upsert 账户 → `{token, me}`。
- `GET /api/wx/me` → `{account, teacher?|null, children: [{studentId, name, className, classId}...]}`（teacher 来自 credentials 关联；children 来自 bindings）。
- `POST /api/wx/bind-teacher` `{username, password}` → 校验密码凭据 → 建 provider='wechat' credential；已被绑的账户/老师给 409。

**老师侧（wx 会话且已绑 teacher，orgId 从 teacher 取）**
- `GET /api/wx/teacher/classes` → 本组织班级列表（含 pending 队列数角标）。
- `POST /api/wx/teacher/classes/:id/invites` → `{token, expiresAt, sharePath: "pages/join/index?invite=<token>"}`。
- `GET /api/wx/teacher/classes/:id/join-requests?status=pending` → 队列（含申请者填写的四项 + 微信昵称）。
- `GET /api/wx/teacher/classes/:id/students?unlinked=1` → 供关联选择的花名册（标注已关联者）。
- `POST /api/wx/join-requests/:id/link` `{studentId}` → 单事务：建 binding + status=linked + 回填 student 空字段（photo/en_name/parent_phone）。
- `POST /api/wx/join-requests/:id/dismiss` → status=dismissed。

**学生/家长侧（wx 会话）**
- `GET /api/wx/invites/:token` → 班级预览（过期/不存在 404，提示找老师要新邀请）。
- `POST /api/wx/upload/photo` → multipart（复用 multer+storage，≤5MB 图片）→ `{key,url}`。
- `POST /api/wx/invites/:token/join` `{cnName, enName?, parentPhone?, photoKey?}` → 建 join_request；同班已有 pending 的重复提交给 409（可覆盖更新，二选一：默认覆盖更新）。
- `GET /api/wx/students/:id` / `GET /api/wx/students/:id/sessions/:sid` → 由 binding 守卫的 me/个性化 recap（**复用现 /api/parent 的派生逻辑**，抽成共享函数后删旧路由）。

## 小程序页面

```
pages/index          登录引导（静默 wx.login）→ 按 me 分流：teacher→teacher/classes；有 children→recap 首页(现有,数据源改 /api/wx)；
                     有 pending join_request→「已提交，等待老师确认」状态页；否则→欢迎页(提示通过群邀请进入)
pages/join           分享卡片落地页 ?invite=<token>：班级预览 + 中文名/英文名/家长手机号/头像 → 确认 → 等待页
pages/teacher/classes   班级列表（队列数角标）
pages/teacher/class     班级详情：生成邀请（useShareAppMessage 分享卡片；h5 fallback 复制链接）+ 邀请队列
                        （条目：头像/中文名/英文名/手机号/昵称 → 关联到学生(选择器)/忽略）
pages/bind           老师绑定页：用户名+密码 一次性绑定
```

多孩切换保留（chips 数据源改为 me.children）；`lib/children.ts` 本地 token 模型删除，只留「当前选中 studentId」的本地记忆。

## 测试计划（BDD 先行，supertest + WX_MOCK）

1. wx/login：mock code 建账户/幂等复登；坏 code 401；token 中间件守卫 /api/wx/*。
2. bind-teacher：正确密码建 wechat credential；错密码 401；重复绑定 409；绑定后 me.teacher 非空。
3. invites：老师生成（他组织班级 404）；预览有效/过期/不存在；过期判定用可注入时钟或 expires_at 直改 DB。
4. join：建 join_request 含四项；同班重复提交覆盖更新；未登录 401。
5. link/dismiss：单事务建 binding + 回填空字段不覆盖已有值；跨组织老师 404；dismiss 后不再出现在 pending。
6. children/recap 守卫：绑定后 me.children 出现、可拉个性化 recap；未绑定学生 id 访问 404；多孩/多家长（两账户绑同一学生）各自可见。
7. 回归：/api/parent/* 删除后 404；老师 web cookie 会话不受影响。
8. miniapp lib 单测：wxAuth mock 分支、join 表单校验（手机号）、分流逻辑纯函数。
9. h5 端到端（agent-browser，三账户三浏览器会话）：dev-teacher 生成邀请拿 token → dev-new 打开 join?invite= 提交 → dev-teacher 队列里关联到某 student → dev-new 刷新变 recap 首页；sqlite3 断言 bindings/join_requests。

## 任务拆解（可独立验证顺序）

1. schema/ddl/seed：四张新表 + credentials/students 列 + 删 invite_token + mock 账户 seed。
2. wx 会话：code2session(+WX_MOCK) + Bearer 签发/校验 + login/me/bind-teacher（测试先行）。
3. 邀请与注册 API：invites/预览/upload/join（测试先行）。
4. 队列与关联 API：join-requests/link/dismiss + children/recap 守卫路由，抽共享 recap 派生，删 /api/parent/*。
5. miniapp：wxAuth + index 分流 + bind 页。
6. miniapp 老师端两页（生成邀请 + 分享 + 队列关联）。
7. miniapp join 页重写 + 等待页 + recap 数据源切换，删本地 token 模型。
8. web 邀请 tab 改造（说明 + 只读队列）。
9. h5 三角色端到端 + AGENTS.md/memory 更新。

## 待决策（默认拍板，等你否决）

1. **老师绑定方式**：小程序里输用户名+密码一次性绑定（默认）vs web 端生成 6 位绑定码到小程序输入。
2. **重复提交策略**：同账户同班二次提交默认**覆盖更新** pending 条目（vs 拒绝）。
3. **appid 现状**：默认按「暂无/测试号待办」设计（WX_MOCK 兜底）；若你已有测试号 appid+secret，任务 2 直接接真 code2session（`WX_APPID/WX_SECRET` env），分享卡片真机可测。
4. **邀请有效期** 默认 7 天；**students.recap_token 保留列但停用**。
5. web 端是否也支持关联操作：默认只读（关联只在小程序做，与你描述一致）；做成 web 也可操作成本很低，可后补。

## 不在本 plan 内

- 学生成长档案 §7.4（recap 守卫路由为其预留同款鉴权模式）。
- unionid 多端打通、wx.getPhoneNumber、消息推送、发布与域名白名单。
- 已 dismissed/linked 队列的历史管理界面（M1 只看 pending）。
