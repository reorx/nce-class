# AGENTS.md

新概念英语课堂教学辅助系统。M1 已基本完成并部署上线（service.domain）：老师端 Web（班级管理 / 课前配置 / 课堂主界面 / 考勤 / 成长档案 / session 详情）+ 学生端微信小程序（Taro 双端）+ 邀请与账户体系 + 存储层。需求与各专题设计见 `kb/plans/`（PRD = `2026-06-30-nce-class-m1-prd.md`，其余按日期命名，做某块前先读对应 plan）。设计稿参考 `nce-class-v1-design/*.dc.html`（gitignored）。

## 结构

pnpm workspace，前后端分离。约定：`lib/` 下均为纯派生逻辑并配同名 `.test.ts`，UI 里的可测逻辑先抽 lib。

```
server/  Express + TS · Drizzle ORM + SQLite (better-sqlite3)
  src/db/       schema/ddl/seed/client（DB 路径可用 NCE_DB_PATH 覆盖，供测试）；mutations.ts 全部写操作，事务封装
  src/auth/     密码认证 + 老师无状态签名 cookie + 小程序 wx Bearer token（同 HMAC，`wx:` 前缀防串用）+ code2session（WX_MOCK=1 时 `mock:<name>`）
  src/storage/  StorageClient：local（默认）/ minio / oss，S3_VENDOR 切换；students.photo_url 存 key，读侧 getUrl 解析
  src/app.ts    createApp() 含全部路由；server.ts 仅 listen
  tests/        vitest + supertest 集成测试（helpers.ts 的 setupTestApp 用临时库，request.agent 保持 cookie）
web/     React + Vite + TS · 老师端桌面 Web（管理页 IBM Plex；课堂系 Nunito/Baloo 2）
  pages/    ClassList / ClassDetail（学生·分组 DnD·班级资源·作业模板·上课记录）/ StudentProfile（成长档案矩阵）/
            SessionDetail（作业布置·Recap·课堂信息三 tab，结束课堂后落地）/ ClassAttendance（考勤网格）/
            Sessions（org 级课堂列表）/ Teachers（添加/改名改密，用户名不可改）/ Setup（课前配置；?backfill=1 补录过去的课）/
            Classroom（课堂主界面：看板/背书/作业/出勤/调组/班级信息/日志 七视图 + 上节课 popover + 多选批量 + 投屏 zoom）/ Login
  lib/      classroomStore（课堂本地态 reducer + localStorage 持久化 + commit payload）/ session（事件流计分派生）/
            setup / grouping / attendance / profile / homework / lesson / recapCard / recapV3（v3 战报派生：领奖台/组明细/分类统计）/ classroomLog /
            tags（奖章归一化，与 server 口径一致）/ multiSelect / prevLesson / zoom / api（fetch 客户端）
miniapp/ Taro 4 + React（weapp 正式产物 / h5 开发调试；appid wx19490e22f3580fb0；browserslist 锁 chrome60/ios10——微信 CI 不认 ES2020 语法，勿改）
  pages:    index（按身份分流）/ join（?invite= 落地表单）/ recap / bind（老师绑定）/ teacher/{home,classes,class,sessions}
  lib:      api（Bearer 注入；h5 走 :10086 代理）/ wxAuth（ensureLogin + mock 身份）/ flow / recapView
```

## 页面与 API

web 路由：`/`、`/classes/:id`（?tab=students|groups|notes|homework|invite|sessions）、`/classes/:id/students/:sid`、`/classes/:id/sessions/:sid`（?tab=homework|recap|info）、`/classes/:id/attendance`、`/classes/:id/setup`、`/classes/:id/classroom`、`/sessions`、`/teachers`、`/login`。课堂直连判定：本地 store 有该班进行中课堂→恢复（若 URL `?edit_id` 与本地态不符则弹冲突拦截页）；`?edit_id=<sid>`→拉 `GET /sessions/:id` 的 `ledger` 反向还原为可编辑课堂（编辑上课记录）；`?lesson=4&title=...&duration=120`→boot 新课；否则跳 setup。

API 全在 `server/src/app.ts`，除 `/api/health`、`/api/auth/login`、`/api/wx/login` 外均过认证中间件，orgId 取自当前登录者、跨组织一律 404。字段校验细节以代码为准，速览：

- 老师 cookie 会话：auth（login/logout/me/verify-password）、teachers 增改、classes 增改 + students（增删改名改状态）+ groups（整套 replace）+ notes / homework-template（整篇 replace）、`POST /classes/:id/sessions`（结束课堂一次性提交，见下方兼容纪律）、sessions（详情含 `ledger` 还原块 / `PUT /sessions/:id` 部分更新课堂信息 / `PUT /sessions/:id/commit` 覆盖重提交=编辑上课记录 / homework / attendance 更正 / 删除 / recap）、attendance 矩阵、tags（org 奖章库）、join-requests 只读镜像。
- 小程序 `/api/wx/*`（Bearer，与 cookie 互不通用）：me / bind-teacher；老师侧（需已绑 teacher，否则 403）classes/sessions/invites/join-requests 关联与驳回/students；家长侧 invites 预览 + join（只建 join_request）+ upload/photo + students recap（binding 守卫）。

## 开发与测试

```bash
pnpm install     # 首次编译 better-sqlite3 原生模块
pnpm db:reset    # 重建 seed 数据 → server/data/app.db（dev server 在跑要重启，旧句柄指向被删 inode）
pnpm dev         # server :5177 + web :5173（vite 代理 /api、/uploads）
pnpm dev:miniapp # miniapp h5 watch :10086（需 server 在跑）

pnpm --filter server test              # supertest 集成测试（自带临时库，无需起服务）
pnpm --filter web test                 # miniapp 同理，均 vitest
pnpm --filter server exec tsc --noEmit # 类型检查（web/miniapp 同理）
```

- **登录墙**：管理页均需登录，seed 老师 `wangli` / `demo1234`（全体同密码）。会话 = httpOnly 签名 cookie `nce_session`（7 天）。
- server dev 脚本自带 `WX_MOCK=1`；接真微信设 `WX_APPID`/`WX_SECRET` 并去掉 WX_MOCK。
- ⚠️ 端口 5173/5177 常被邻近项目 tenderbuddy 占用或混淆；清理前先 `lsof -nP -iTCP:5177 -sTCP:LISTEN` 确认进程 cwd，勿误杀。web 可 `pnpm --filter web exec vite --port 5180`。
- 新增写接口 **先加测试用例再实现**（TDD）。

**部署**：push master → GitHub Actions（`.github/workflows/deploy.yml`）build 镜像（server + web/dist 同一镜像）push 到 ghcr → 用 digest 调服务器部署 webhook（repo Secrets：`WEBHOOK_SECRET` + `WEBHOOK_URL`，含路径的完整 URL）。服务器侧 compose / 部署脚本 / Caddy 路由由 deploy 工作区的 Ansible 管理（容器只跑 API，web 静态从镜像拷到 webdist 由宿主机 Caddy serve）；`.env` 变量名 SSOT = 仓库根 `.env.example`，真值服务器手填。weapp 上传**不走 CI**：本地 `pnpm --filter miniapp upload:weapp`（生产 API 域名由 gitignored `miniapp/.env.production.local` 的 `TARO_APP_API_BASE` 构建时注入，缺失即构建报错；需 nvm node24）。`pnpm --filter server db:migrate` 幂等 DDL（server 启动也自动跑，部署无需手动迁移）；干净库开账号用 `pnpm --filter server create-teacher`。

## 验证套路

```bash
# curl 冒烟：登录拿 cookie jar 后带 -b 访问
CJ=/tmp/nce_cookies.txt
curl -s -c $CJ -X POST http://localhost:5177/api/auth/login -H 'Content-Type: application/json' -d '{"username":"wangli","password":"demo1234"}' >/dev/null
curl -s -b $CJ http://localhost:5177/api/sessions/sess-c1-7/recap | python3 -m json.tool
# DB 断言
sqlite3 -header -column server/data/app.db "SELECT id,org_id,name,teacher_id FROM classes WHERE id='c1';"
```

**浏览器端到端用 `agent-browser`**（Skill 同名）：`open → snapshot -i 拿 @e 引用 → fill/click`，先过登录墙；DOM 变了要重新 snapshot，用完 `close`。课堂全流程：setup → 开始课堂 → 七视图操作 → 结束课堂（确认式）→ 落地 session 详情页，之后 sqlite3 断言 `class_sessions` 新行。清本地进行中课堂：eval `localStorage.removeItem('nce.classroom.c1')`。

**坑：HTML5 拖拽（分组页/课堂调组）`agent-browser drag` 无效**（发的是鼠标手势）。用 `eval` 手动派发，**分两次**、中间 `wait 500` 让 React 提交状态：

```bash
agent-browser --session nce eval --stdin <<'EOF'
(() => {
  const rows = [...document.querySelectorAll('[draggable="true"]')];
  const src = rows.find(r => r.textContent.includes('小明'));
  window.__dt = new DataTransfer();
  window.__dst = rows.find(r => r.textContent.includes('军军'));  // 目标组内任一卡片，drop 会冒泡
  src.dispatchEvent(new DragEvent('dragstart', { bubbles:true, cancelable:true, dataTransfer: window.__dt }));
  return 'dragstart sent';
})()
EOF
agent-browser --session nce wait 500
agent-browser --session nce eval "(() => { const d=window.__dst, dt=window.__dt; d.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt})); d.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt})); return 'drop sent'; })()"
```

**miniapp h5 端到端**：视口 390×844，身份由 storage 决定，切角色 = eval 改 mock 名 + 删 token 再 reload（Taro h5 storage 值有 `{"data":<值>}` 包装）。完整三角色流程（生成邀请→注册→关联→recap，含按钮定位坑与断言 SQL）照抄 `kb/docs/miniapp-h5-three-role-e2e.md`。

```js
localStorage.setItem('nce.mockUser', JSON.stringify({ data: 'dev-teacher' }));  // dev-teacher|dev-parent|dev-new
localStorage.removeItem('nce.wxToken'); localStorage.removeItem('nce.currentChild');
```

**微信开发者工具（weapp 人工验证）**：h5 只是开发替身，改过分享/授权/原生组件要在工具里过一遍。要点：
- `pnpm --filter miniapp dev:weapp` watch 编译后 `/Applications/wechatwebdevtools.app/Contents/MacOS/cli open --project <repo>/miniapp`（导入 miniapp/ 不是 dist/；需先在工具里扫码登录并打开「服务端口」设置）。
- 模拟器 mock 登录：Console 里 `wx.setStorageSync('nce.mockUser','dev-teacher')` + `wx.removeStorageSync('nce.wxToken')` 后点「编译」。
- 真机预览/上传走 miniprogram-ci：`pnpm --filter miniapp preview:weapp / upload:weapp`。坑：①密钥在 gitignored `tmp/private.<appid>.key`；②node 25 跑不了，要 nvm node24 前缀 PATH。preview 打的是正式构建（直连生产）。

## 文档

- `kb/docs/miniapp-h5-three-role-e2e.md` — 小程序 h5 三角色端到端验证流程（老师生成邀请→家长注册→老师关联→recap 验收）。做邀请/账户/小程序相关改动后跑回归时读。

## 须知 / 约定

- **计分是事件流**：个人分、组分均由 `score_events`(±1) 派生，不落地存储。奖章 tag 同理本地存名字、结束课堂随 commit 入库（`org_tags` 按名幂等 upsert + `session_tags` 快照）。
- **课堂本地优先**：整节课跑在浏览器本地（`classroomStore.ts`，localStorage `nce.classroom.<classId>`），仅「结束课堂」一次性 POST，后端单事务落库。幂等键 `client_session_id` 重试不变，重复提交返回既有 sessionId。默认分组回写用**下课态**分组（课中调组持久化到默认分组）。提交前 payload 自动备份到 `nce.classroom.backup.<clientSessionId>`（成功才清，留最新 10 条，可原样重 POST）。补录课堂（backfill）复用同一套，payload 零改动。编辑上课记录（`?edit_id`）同样复用：`GET /sessions/:id` 的 `ledger`（id 维度原始快照：sessionGroups/memberships/逐条 events/checks/tags）经 `buildEditSession` 反向还原为带 `editOfSessionId` 标记的本地课堂（复用同一 `nce.classroom.<classId>` 槽位，故进行中课堂时编辑会被冲突拦截），结束时走 `PUT /sessions/:id/commit`→`overwriteSession` 原地覆盖同一 session（删 5 张子表→UPDATE 保留 id/client_session_id/作业字段→重写 ledger），**不回写默认分组**，并保留已有 leave/补课更正（含其分组座位）。
- **⚠️ 结束课堂 schema 向后兼容（protobuf 式，不可破坏）**：课堂进行中服务端可能发新版，旧页面 commit payload 必须照常入库。纪律：①服务端永不新增必填字段，新字段一律可选带默认；②不收紧校验、不改名、不改语义；③未知字段静默忽略（`buildCommitInput` 显式挑字段）。web 端 localStorage 的 `ClassroomSession` shape 同理只加可选字段（先例：teacherId/startedAt/tags/backfill/editOfSessionId/endedAt/homeworkContent）。守卫用例在 `server/tests/api.test.ts`「向后/向前兼容」——挂了改契约不改测试。
- **鉴权双轨**：老师 = 无状态签名 cookie（HMAC/`AUTH_SECRET`，dev 有 fallback；生产必须显式设置，缺失启动即 throw）；小程序 = wx Bearer token（subject=wechatAccountId），互不通用。写接口的 teacherId/orgId 取自当前登录者。
- **学生状态** `students.status`：active 在读 / suspended 停课 / archived 归档。非 active 不进课前配置、课堂与 session 快照（缺席也不算）；人数口径 = 在读+停课；停课/归档即清默认分组 membership，恢复后需手动拖回组；已绑定家长的历史 recap 不受影响。
- **账户体系**：student（教学实体）与 wechat_account（微信身份）分离。teacher↔account 走 credentials（bind 页一次绑定）；student↔account 走 `student_wechat_bindings`（N:M）；家长注册只建 `join_requests`（pending 唯一、重复提交覆盖），由老师在小程序关联（回填空字段不覆盖）。邀请 = 一次性 7 天 token（`class_invites`，可并存）。
- **出勤/作业口径**：commit payload 只有 present/absent；`leave` 只由考勤更正接口产生，读侧一律 `!== 'present'` 视为未到堂；`madeUp` 只进考勤页统计不改当日 recap。作业三态 没交(默认)/完成/需补，缺记录=没交。作业布置文本可在课堂「作业检查」侧栏边上课边写（随 commit 可选字段 `homeworkContent` 落库，仅创建路径），也可课后在 session 详情页 PUT；编辑上课记录不改作业（overwrite 结构性忽略）。
- seed 自带 DDL，`db:reset` 无需 drizzle-kit；生产迁移靠 `provision.migrate()` 幂等 ALTER。相对时间基准 `REFERENCE_TODAY=2026-07-01`（`server/src/util/time.ts`，保 demo 稳定）。三年级A班刻意留重复学生「浩浩」（该班 13 人、全校 86）；疑似重复只提示不合并。
- 全局约定：pnpm 装依赖（`pnpm add`，勿手改 package.json）；勿用 try/catch 除非要求；改完代码不跑 formatter/linter。

## 待做

- **小程序上线**：链路已通（appid/生产凭据/域名/体验版/真机绑定均 ✅），唯一阻塞 = 小程序年度认证（个人主体，未认证禁分享）→ 认证后真机过邀请全流程 → 提审发布。清单见 `kb/notes/2026-07-04-miniapp-invite-launch-gaps.md`。
- **recap 分享到微信群 + 课后处理**：plan 已写好待实现，见 `kb/plans/2026-07-04-nce-class-recap-wechat-share.md`。
- 不做（M1）：投屏实时多端同步、已 dismissed/linked 队列历史界面、wx.getPhoneNumber（需企业认证，手机号手填）。
