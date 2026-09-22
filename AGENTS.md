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
  pages/    ClassList（首页 + ?is_archived=true 已归档班级页）/ ClassDetail（学生·分组 DnD·班级资源·作业模板·上课记录）/ StudentProfile（成长档案矩阵）/
            SessionDetail（作业布置·Recap·课堂信息三 tab，结束课堂后落地）/ ClassAttendance（考勤网格）/
            Sessions（org 级课堂列表）/ Teachers（改名，用户名不可改；添加老师、改密只在 Admin）/ Admin（仅管理员：删除班级·添加老师·修改成员密码）/
            Setup（课前配置；?backfill=1 补录过去的课）/
            Classroom（课堂主界面：看板/背书/作业/出勤/调组/班级信息/日志 七视图 + 上节课 popover + 多选批量 + 投屏 zoom）/ Login
  components/ 全局 StudentModalProvider（编辑学生姓名弹窗，useStudentModal() 在任意页面/循环内触发，对标 ToastProvider）
  lib/      classroomStore（课堂本地态 reducer + localStorage 持久化 + commit payload）/ session（事件流计分派生）/
            setup / grouping / attendance / profile / homework / lesson / recapCard / recapV3（v3 战报派生：领奖台/组明细/分类统计）/ classroomLog /
            tags（奖章归一化，与 server 口径一致）/ studentName（英文名/中文名校验与主副名派生）/ multiSelect / prevLesson / zoom / admin（删除影响面文案·改密表单校验）/ classList（首页/归档页按 isArchived 分流·搜索·计数）/ api（fetch 客户端）
miniapp/ Taro 4 + React（weapp 正式产物 / h5 开发调试；appid wx19490e22f3580fb0；browserslist 锁 chrome60/ios10——微信 CI 不认 ES2020 语法，勿改）
  pages:    index（按身份分流）/ join（?invite= 落地表单）/ recap / bind（老师绑定）/ teacher/{home,classes,class,sessions}
  lib:      api（Bearer 注入；h5 走 :10086 代理）/ wxAuth（ensureLogin + mock 身份）/ flow / recapView
```

## 页面与 API

web 路由：`/`、`/classes`（同 `/`；`?is_archived=true` = 已归档班级列表）、`/classes/:id`（?tab=students|groups|notes|homework|invite|sessions）、`/classes/:id/students/:sid`、`/classes/:id/sessions/:sid`（?tab=homework|recap|info）、`/classes/:id/attendance`、`/classes/:id/setup`、`/classes/:id/classroom`、`/sessions`、`/teachers`、`/admin`（非管理员渲染无权限空态，顶导也不显示入口）、`/login`。课堂直连判定：本地 store 有该班进行中课堂→恢复（若 URL `?edit_id` 与本地态不符则弹冲突拦截页）；`?edit_id=<sid>`→拉 `GET /sessions/:id` 的 `ledger` 反向还原为可编辑课堂（编辑上课记录）；`?lesson=4&title=...&duration=120`→boot 新课；否则跳 setup。

API 全在 `server/src/app.ts`，除 `/api/health`、`/api/auth/login`、`/api/wx/login` 外均过认证中间件，orgId 取自当前登录者、跨组织一律 404。字段校验细节以代码为准，速览：

- 管理员 `/api/admin/*`（cookie 会话 + gate：`teacher.is_admin` 每请求随 teacher 行重读，非管理员 403；删除班级、改密 body 带 `adminPassword` 同请求复核，错 403；添加老师只过 gate）：`GET /admin/classes`（本 org 班级 + 删除影响面计数）、`DELETE /admin/classes/:id`（`mutations.deleteClass` 单事务硬删该班全部挂靠数据）、`POST /admin/teachers`（本 org 普通老师，用户名跨 org 唯一否则 409）、`PUT /admin/teachers/:id/password`（复用 `provision.resetPassword`）。
- 老师 cookie 会话：auth（login/logout/me/verify-password；login/me 带 `isAdmin`）、teachers 列表 + 改名（body 带非空 password → 403；添加老师、改密只走 admin，旧 `POST /teachers` 已删 → 404）、classes 增改 + students（增删改名改状态）+ groups（整套 replace）+ notes / homework-template（整篇 replace）、`POST /classes/:id/sessions`（结束课堂一次性提交，见下方兼容纪律）、sessions（详情含 `ledger` 还原块 / `PUT /sessions/:id` 部分更新课堂信息 / `PUT /sessions/:id/commit` 覆盖重提交=编辑上课记录 / homework / attendance 更正 / 删除 / recap）、attendance 矩阵、tags（org 奖章库）、join-requests 只读镜像。
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

**部署**：push master → GitHub Actions（`.github/workflows/deploy.yml`）build 镜像（server + web/dist 同一镜像）push 到 ghcr → 用 digest 调服务器部署 webhook（repo Secrets：`WEBHOOK_SECRET` + `WEBHOOK_URL`，含路径的完整 URL）。服务器侧 compose / 部署脚本 / Caddy 路由由 deploy 工作区的 Ansible 管理（容器只跑 API，web 静态从镜像拷到 webdist 由宿主机 Caddy serve）；`.env` 变量名 SSOT = 仓库根 `.env.example`，真值服务器手填。weapp 上传**不走 CI**：本地 `pnpm --filter miniapp upload:weapp`（生产 API 域名由 gitignored `miniapp/.env.production.local` 的 `TARO_APP_API_BASE` 构建时注入，缺失即构建报错；node 25 跑不了 miniprogram-ci，用 `mise x node@24 -- pnpm --filter miniapp upload:weapp`）。`pnpm --filter server db:migrate` 幂等 DDL（server 启动也自动跑，部署无需手动迁移）；干净库开账号用 `pnpm --filter server create-teacher`；忘记密码（无需登录）用 `pnpm --filter server reset-password -- --username <登录名>`：新密码交互输入两次不回显（也接受管道两行），不带/带错 username 时列出库里全部用户名；生产在容器内 `docker compose exec app pnpm --filter server reset-password -- --username <登录名>`（远程要 `ssh -t`）。管理员只能用 CLI 授予/撤销：`pnpm --filter server set-admin -- --username <登录名> [--revoke]`（不带/带错 username 列出全部用户名及 `[admin]` 标记，对方下一次请求即生效）；干净库开首个账号可 `create-teacher ... --admin` 一步到位。⚠️ `is_admin` 迁移不回填，旧库升级后**没有任何管理员**，需手动 set-admin。⚠️ 会话是无状态签名 cookie，改密（CLI 或 /admin）不吊销已签发的会话，怀疑泄露需轮换 `AUTH_SECRET`。

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
- 真机预览/上传走 miniprogram-ci：`pnpm --filter miniapp preview:weapp / upload:weapp`。坑：①密钥在 gitignored `tmp/private.<appid>.key`；②node 25 跑不了，用 `mise x node@24 -- pnpm --filter miniapp <script>`。preview 打的是正式构建（直连生产）。

## 文档

- `kb/docs/miniapp-h5-three-role-e2e.md` — 小程序 h5 三角色端到端验证流程（老师生成邀请→家长注册→老师关联→recap 验收）。做邀请/账户/小程序相关改动后跑回归时读。

## 须知 / 约定

- **计分是事件流**：个人分、组分均由 `score_events`(±1) 派生，不落地存储。奖章 tag 同理本地存名字、结束课堂随 commit 入库（`org_tags` 按名幂等 upsert + `session_tags` 快照）。
- **课堂本地优先**：整节课跑在浏览器本地（`classroomStore.ts`，localStorage `nce.classroom.<classId>`），仅「结束课堂」一次性 POST，后端单事务落库。幂等键 `client_session_id` 重试不变，重复提交返回既有 sessionId。默认分组回写用**下课态**分组（课中调组持久化到默认分组）。提交前 payload 自动备份到 `nce.classroom.backup.<clientSessionId>`（成功才清，留最新 10 条，可原样重 POST）。补录课堂（backfill）复用同一套，payload 零改动。编辑上课记录（`?edit_id`）同样复用：`GET /sessions/:id` 的 `ledger`（id 维度原始快照：sessionGroups/memberships/逐条 events/checks/tags）经 `buildEditSession` 反向还原为带 `editOfSessionId` 标记的本地课堂（复用同一 `nce.classroom.<classId>` 槽位，故进行中课堂时编辑会被冲突拦截），结束时走 `PUT /sessions/:id/commit`→`overwriteSession` 原地覆盖同一 session（删 5 张子表→UPDATE 保留 id/client_session_id/作业字段→重写 ledger），**不回写默认分组**，并保留已有 leave/补课更正（含其分组座位）。
- **⚠️ 结束课堂 schema 向后兼容（protobuf 式，不可破坏）**：课堂进行中服务端可能发新版，旧页面 commit payload 必须照常入库。纪律：①服务端永不新增必填字段，新字段一律可选带默认；②不收紧校验、不改名、不改语义；③未知字段静默忽略（`buildCommitInput` 显式挑字段）。web 端 localStorage 的 `ClassroomSession` shape 同理只加可选字段（先例：teacherId/startedAt/tags/backfill/editOfSessionId/endedAt/homeworkContent）。守卫用例在 `server/tests/api.test.ts`「向后/向前兼容」——挂了改契约不改测试。
- **鉴权双轨**：老师 = 无状态签名 cookie（HMAC/`AUTH_SECRET`，dev 有 fallback；生产必须显式设置，缺失启动即 throw）；小程序 = wx Bearer token（subject=wechatAccountId），互不通用。写接口的 teacherId/orgId 取自当前登录者。
- **管理员**：`teachers.is_admin`（0/1）与 `role`（owner/teacher，仅展示）无关，只由 set-admin CLI / `create-teacher --admin` 授予，页面无法提权。高危操作集中在 `/admin`：删除班级（硬删除级联，同 deleteStudent 口径：`org_tags`、`wechat_accounts`、存储照片不删）、添加老师（一律普通老师，页面不能提权）、修改成员密码；/teachers 只能改名。新增挂靠班级的表时要同步 `deleteClass`——`api.test.ts` admin 用例扫描全部表的 id/引用列做残留断言兜底。
- **学生姓名**：`students.name` = 英文名（必填、主显示名、头像首字母取它，历史列名沿用），`students.cn_name` = 中文名（可空，班级学生卡片 / 分组成员 / 收款单行 / 成长档案头部下方小字；考勤与课堂不显示）。`en_name` 已于 2026-09-15 删除（生产 0 行有值），`join_requests` 的 `cn_name`/`en_name` 是家长注册时点快照，勿混。⚠️ `PUT /api/students/:id` 用 `'cnName' in body` 判定是否写该列——缺 key 不动列（旧页面只发 `{name}` 不会清空中文名）；传空串/空白 = 清空。关联 join_request 时 `cn_name` 按 COALESCE 回填。全程无快照（recap/ledger/收款单都是读时 JOIN），改名刷新即对。
- **学生状态** `students.status`：active 在读 / suspended 停课 / archived 归档。非 active 不进课前配置、课堂与 session 快照（缺席也不算）；人数口径 = 在读+停课；停课/归档即清默认分组 membership，恢复后需手动拖回组；已绑定家长的历史 recap 不受影响。
- **班级归档** `classes.is_archived`（0/1，与学生 `status=archived` 无关）：**纯展示标记**，只为让首页班级列表只剩在上的班。编辑班级信息弹窗里勾选；`GET /api/classes` 照常返回全部班级并带 `isArchived`，由 web `lib/classList` 分流到首页（「n 个归档 ›」入口）与 `/classes?is_archived=true`。详情/开课/排班收款/`/sessions` 筛选/小程序老师端列表/admin 一律不做联动，归档班照常可用。`PUT /api/classes/:id` 不带 `isArchived`（旧页面）= 保持原状态，非布尔 400；新建不接收。
- **账户体系**：student（教学实体）与 wechat_account（微信身份）分离。teacher↔account 走 credentials（bind 页一次绑定）；student↔account 走 `student_wechat_bindings`（N:M）；家长注册只建 `join_requests`（pending 唯一、重复提交覆盖），由老师在小程序关联（回填空字段不覆盖）。邀请 = 一次性 7 天 token（`class_invites`，可并存）。
- **出勤/作业口径**：commit payload 只有 present/absent；`leave` 只由考勤更正接口产生，读侧一律 `!== 'present'` 视为未到堂；`madeUp` 只进考勤页统计不改当日 recap。作业三态 没交(默认)/完成/需补，缺记录=没交。作业布置文本可在课堂「作业检查」侧栏边上课边写（随 commit 可选字段 `homeworkContent` 落库，仅创建路径），也可课后在 session 详情页 PUT；编辑上课记录不改作业（overwrite 结构性忽略）。
- **教材 key**：`classes.textbook` / `class_sessions.review_book` 为 TEXT 列，值 `'1'`-`'4'`（新概念第一~四册）或 `starterA`/`starterB`（青少版A/B：15 单元 × 3 课 = 45 课，课文复习下拉显示 Unit · Lesson，`review_lesson` 仍存 1-45 平铺序号）。课数表 `server/src/app.ts` 与 `web/src/lib/homework.ts` 双处镜像；API 另收旧页面的整数 1-4 并归一为字符串；前端下拉值一律过 `parseBook`（勿 `Number()`）。
- seed 自带 DDL，`db:reset` 无需 drizzle-kit；生产迁移靠 `provision.migrate()` 幂等 ALTER。SQLite 列声明类型须与存值一致，不借类型亲和性混存；要换列类型写真迁移（参考 `provision.ts` 的 `convertColumnToText`：ADD→CAST→DROP→RENAME，按 PRAGMA 类型判断幂等）。相对时间基准 `REFERENCE_TODAY=2026-07-01`（`server/src/util/time.ts`，保 demo 稳定）。三年级A班刻意留重复学生「浩浩」（该班 13 人、全校 86）；疑似重复只提示不合并。
- **commit message**：首行只写一句简短总结（一屏放得下，别塞细节），空行后用 `-` 列表写详情（改了什么 / 口径与根因 / 测试与验证结果）。⚠️ 别把整篇细节挤进首行——2026-07~09 有 13 个 commit 这么干过（最长首行 2306 字节 ≈ 770 字），已于 2026-09-14 统一重写为本格式。
- 全局约定：pnpm 装依赖（`pnpm add`，勿手改 package.json）；勿用 try/catch 除非要求；改完代码不跑 formatter/linter。

## 待做

- **小程序上线**：年度认证已通过（2026-09-16），0.2.0 已上传（邀请版，不含 recap 分享）。剩余人工：mp 后台设体验版 → 真机过邀请全流程（分享卡片/选图/关联）→ 提审发布。清单与验收步骤见 `kb/notes/2026-07-04-miniapp-invite-launch-gaps.md`。
- **recap 分享到微信群 + 课后处理**：plan 已写好待实现，见 `kb/plans/2026-07-04-nce-class-recap-wechat-share.md`。
- 不做（M1）：投屏实时多端同步、已 dismissed/linked 队列历史界面、wx.getPhoneNumber（需企业认证，手机号手填）。
