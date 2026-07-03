# AGENTS.md

新概念英语课堂教学辅助系统。当前进度：**M1 · 基础框架 + 老师端班级管理页面（读+写闭环，含登录鉴权）+ 课前配置页 + 课堂主界面（本地优先 + 结束课堂一次性提交入库，含默认分组回写/session 快照/事件流/背书作业/出勤）+ 学生端微信小程序（Taro 双端）+ 存储层 Minio/OSS 落地 + 邀请与账户体系重构（wechat_account 分离 · 小程序内生成邀请/关联队列 · Bearer 会话）**。
需求/设计以 `kb/plans/2026-06-30-nce-class-m1-prd.md` 为准；班级管理写操作+登录见 `kb/plans/2026-07-01-nce-class-m1-management-wiring.md`；课堂运行时持久化见 `kb/plans/2026-07-02-nce-class-classroom-backend.md`；学生端小程序+存储见 `kb/plans/2026-07-02-nce-class-student-miniapp.md`（**学生端由 PRD 的 H5 改为小程序**，用户 2026-07-02 决定）；邀请/账户体系见 `kb/plans/2026-07-02-nce-class-wechat-account-invite.md`（**取代固定邀请码+recapToken 方案**：student 与 wechat_account 二元结构，注册只建 join_request，老师负责关联）。生产部署（server.name · service.domain · 服务器现场 build + Compose）见 `kb/plans/2026-07-02-nce-class-deploy.md`。设计还原参考 `nce-class-v1-design/*.dc.html`（gitignored）。

## 结构

pnpm workspace，前后端分离：

```
server/   Express + TS · Drizzle ORM + SQLite (better-sqlite3)
  src/db/{schema,ddl,seed,client}.ts   模型全程带 orgId；计分用 score_events 事件流派生（client 的 DB 路径可用 NCE_DB_PATH 覆盖，供测试）；账户体系四表 wechat_accounts / student_wechat_bindings(N:M) / class_invites(带过期) / join_requests(partial UNIQUE pending)；seed 含三个 mock 微信账户
  src/db/mutations.ts                  写操作（createClass/addStudent/deleteStudent 硬删/saveGrouping replace/commitSession 结束课堂单事务/upsertWechatAccount/bindTeacherWechat/createInvite/upsertJoinRequest 覆盖更新/linkJoinRequest 单事务关联+回填空字段/dismissJoinRequest），事务封装
  src/auth/{password,session,wx}.ts    自建密码认证 + 无状态签名 cookie + wx Bearer token（同 HMAC 方案、`wx:` 域前缀防串用）+ code2session（WX_MOCK=1 时 `mock:<name>` → `mock-openid-<name>`；真实走 WX_APPID/WX_SECRET）
  src/storage/                         StorageClient 抽象层：local（默认，NCE_UPLOAD_DIR 可覆盖）/ minio / oss，S3_VENDOR 切换（tests/storage.test.ts）；远端桶按 public-read，getUrl 同步拼 URL；students.photo_url 存 key 不存 URL，读侧 getUrl(key) 解析
  src/app.ts                           createApp()：读+写 REST + /api/wx/*（Bearer gate 三分：公开 /wx/login、wx 会话、老师 cookie 会话）；server.ts 仅 listen
  tests/                               vitest + supertest 集成测试（临时 DB harness + wxLogin 助手；覆盖登录/增删/分组/建班/recap/跨组织隔离/wx 会话与绑定/邀请注册/队列关联/binding 守卫/存储 switch）
web/      React + Vite + TS · 老师端桌面 Web（管理页 IBM Plex；课堂界面 Nunito/Baloo 2）
  src/App.tsx                          顶层 auth guard（GET /api/me → 401 跳 /login）+ ToastProvider
  src/pages/{ClassList,ClassDetail,Teachers,Login}.tsx  ClassList 建班 modal；ClassDetail 学生增删/分组 DnD/recap 浮窗
  src/components/{TopBar,Modal,Toast}.tsx  TopBar 退出登录；通用 Modal + Toast
  src/pages/Setup.tsx                  课前配置：本节课信息 + 上节课回顾 + 默认分组微调（拖拽/增组/缺席暂存）→ 开始课堂（写本地 store，不发后端）
  src/pages/Classroom.tsx              课堂主界面：看板/背书/作业/出勤/调组 五视图 + 学生/小组浮窗 + recap。学生浮窗按视图分化（上课=加减分/背书=背书状态/作业=作业状态，点选即提交并自动关窗，状态弹窗含显式「未检查」项且高亮当前状态）。本地优先：从 store 恢复/URL 参数 boot/否则跳 setup；每次改动落 localStorage；结束课堂预览→确认→一次性 commit；「退出不保存」放弃本地 session
  src/lib/api.ts                       fetch 客户端（get/post/put/del + ApiError 401；login/logout/createClass/addStudent/deleteStudent/saveGrouping/getSessionRecap/commitSession）
  src/lib/grouping.ts (+ .test.ts)     分组方案可编辑模型（toModel/moveStudent/addGroup/removeGroup/renameGroup/toPayload）
  src/lib/session.ts (+ .test.ts)      课堂事件流计分派生（sScore/gScore/recap，学生 id 为 string）+ Lesson 3 demo scenario（仅 session.test.ts 夹具）
  src/lib/setup.ts (+ .test.ts)        课前配置分组模型（buildSetup/moveStudent/addGroup/sums）+ 开始课堂 config 快照（buildSessionConfig 携带缺席名单含原组 / configFromDetail）
  src/lib/classroomStore.ts (+ .test.ts) 课堂本地状态：ClassroomSession 模型 + reducer（加减分/背书作业/出勤/调组/撤销）+ localStorage 持久化 + buildClassroomSession/buildCommitPayload/nowSql
miniapp/  Taro 4 + React + TS（webpack5，prebundle 关闭）· 学生端小程序（weapp 正式产物 / h5 开发调试，appid=touristappid 游客模式）
  config/index.ts                      双端编译配置；h5 devServer :10086 代理 /api、/uploads → :5177
  src/app.config.ts                    pages: index（分流：teacher→老师端 / 有孩子→recap 首页+多孩 chips / pending→等待页 / 欢迎页）/ join（?invite= 落地：预览+四项表单）/ recap（?sid=&student=）/ bind（老师绑定）/ teacher/classes（角标列表）/ teacher/class（生成邀请+队列关联）
  src/lib/api.ts                       Taro.request 封装（Bearer token 注入 setAuthToken；h5 相对路径走代理；weapp 直连 :5177 需关域名校验）+ uploadPhoto(Taro.uploadFile 带 auth header)
  src/lib/wxAuth.ts                    会话粘合：ensureLogin（token 存 nce.wxToken，401 时重新 wx.login；h5 用 nce.mockUser 的 mock 名发 code）+ 当前孩子记忆（nce.currentChild 只存 studentId）
  src/lib/flow.ts (+ .test.ts)         纯逻辑：mockLoginCode / routeForMe 首页分流 / pickChild 多孩回退 / validateJoinForm 手机号校验
  src/lib/recapView.ts (+ .test.ts)    recap 展示派生（medals 并列名次/状态配色 tone/fmtScore）；components/RecapView.tsx 还原 08-student-h5.html
```

## 开发命令

```bash
pnpm install     # 首次会编译 better-sqlite3 原生模块
pnpm db:reset    # 重建并填充 SQLite mock 数据 → server/data/app.db
pnpm dev         # server :5177 + web :5173（vite 代理 /api、/uploads）
```

单独启动 `pnpm dev:server` / `pnpm dev:web` / `pnpm dev:miniapp`（= miniapp h5 watch，:10086，需 server 在跑）。**server dev 脚本默认带 `WX_MOCK=1`**（mock 登录 code `mock:<name>`；接真微信时设 `WX_APPID`/`WX_SECRET` 并去掉 WX_MOCK）。小程序在微信开发者工具里调试见下方「微信开发者工具（weapp 本地调试）」一节。类型检查 `pnpm --filter <pkg> exec tsc --noEmit`；单测 `pnpm --filter web test` / `pnpm --filter server test` / `pnpm --filter miniapp test`（均 vitest）。

**部署**：仓库根 `Dockerfile` + `docker-compose.yml`（服务器现场 build，容器只跑 API，web 静态由宿主机 Caddy serve），发布脚本 `deploy/release.sh`（SSH 到 server.name：reset 代码 → build → 拷 webdist → db:migrate → up -d）。server 新增 `pnpm --filter server db:migrate`（幂等 DDL，server 启动时也会自动跑）与 `pnpm --filter server create-teacher -- --org ... --name ... --username ... --password ...`（干净库开真实账号）。细节见 `kb/plans/2026-07-02-nce-class-deploy.md`。

**登录墙**：管理页均需登录，先访问 `/login` 用 seed 老师登录（如 `wangli` / `demo1234`，全体老师同密码）。会话是 httpOnly 签名 cookie `nce_session`（7 天）。

已实现页面：登录 `/login`；班级列表 `/`；班级详情 `/classes/c1?tab=students|groups|invite|sessions`（学生增删、分组 DnD 保存、上课记录 recap 浮窗）；课前配置 `/classes/c1/setup`；课堂主界面 `/classes/c1/classroom`（直连判定顺序：①本地 store 命中该班进行中课堂→恢复 ②URL 带 `?lesson=4&title=...&duration=120`→用真实默认分组 boot 全新 session ③否则重定向 `/setup`；Lesson 3 固定 demo 不再有页面入口）。
API（除 `/api/health`、`/api/auth/login` 外全部经认证中间件，写入用 `req` 上的当前老师 + orgId 过滤）：
- 认证：`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/me`（无会话 401）、`POST /api/auth/verify-password`（登录墙内重验当前老师密码，错误 403 不影响会话；课堂「放弃本节课」弹窗用）。
- 读：`GET /api/classes`、`GET /api/classes/:id`（含 `lastRecap`）、`GET /api/sessions/:id/recap`（组分排名 + 🌟亮眼(净≥2)/⚠️被提醒(任一−1) + 出勤）。
- 写：`POST /api/classes`、`POST /api/classes/:id/students`、`DELETE /api/students/:id`（硬删连带清账本）、`PUT /api/students/:id/status`（`{status:'active'|'suspended'|'archived'}`，非 active 时清默认分组 membership；恢复在读不还原分组）、`PUT /api/classes/:id/groups`（整套 replace 默认分组，前端拖拽/改名/增删即时保存）、`POST /api/classes/:id/sessions`（**结束课堂一次性提交**：单事务里回写默认分组 §7.2 + 建 ClassSession(ended)/SessionGroup/SessionMembership 快照 + 批量 ScoreEvent/CheckRecord + buildRecap 返回；`clientSessionId` 幂等，`date` 由 `startedAt` 前 10 位派生，`startedAt/endedAt` 须为 `YYYY-MM-DD HH:mm:ss`）。
- 队列只读镜像：`GET /api/classes/:id/join-requests`（cookie 会话；处理只在小程序做）。
- 小程序（`/api/wx/*`，**Bearer token** 而非 cookie；`POST /api/wx/login` 公开，其余走 wx gate）：
  - 会话/身份：`POST /api/wx/login`（`{code}` → code2session/mock → upsert 账户 → `{token, me}`）、`GET /api/wx/me`（`{account, teacher|null, children[], pending[]}`，children 来自 bindings、pending 是排队中的 join_request）、`POST /api/wx/bind-teacher`（`{username,password}` 一次性绑定；老师已被绑/微信已绑过 → 409）。
  - 老师侧（wx 会话且已绑 teacher，未绑 403，orgId 从 teacher 取）：`GET /api/wx/teacher/classes`（含 pendingCount 角标）、`POST /api/wx/teacher/classes/:id/invites`（→ `{token(nanoid16), expiresAt(+7天), sharePath}`，新旧邀请并存各自过期）、`GET .../join-requests`（pending 队列含微信昵称）、`GET .../students`（花名册标注 linked）、`POST /api/wx/join-requests/:id/link`（`{studentId}` 单事务：建 binding + status=linked + 回填 student 空字段 photo/en_name/parent_phone 不覆盖已有值；非 pending/跨组织 404、学生不在该班 400）、`POST /api/wx/join-requests/:id/dismiss`。
  - 家长侧（wx 会话）：`GET /api/wx/invites/:token`（班级预览；过期/不存在 404）、`POST /api/wx/upload/photo`（multipart `photo` ≤5MB 仅图片 → `{key,url}`）、`POST /api/wx/invites/:token/join`（`{cnName, enName?, parentPhone?(11位), photoKey?}` → 建/覆盖更新 pending join_request，**不建 student**）、`GET /api/wx/students/:id`（binding 守卫：学生+班级+ended sessions+latestSessionId）、`GET /api/wx/students/:id/sessions/:sid`（个性化 recap：buildRecap + `mine`{attended/组/personalScore(只算 student 事件)/homework(缺记录=没交)/recitation(缺记录=未检查)} + `groups[].mine` 高亮；无 membership→`mine:null`；未绑定/跨班 404）。
- **旧 `/api/parent/*` 已删除**；`classes.invite_token` 列已删；`students.recap_token` 保留列但停用（将来免登录 H5 分享可能复用）。

## 测试与验证

这一节记录本项目实际用过的测试/验证套路，照抄即可，不用重新摸索。

### 单元/集成测试 + 类型检查

```bash
pnpm --filter server test              # vitest + supertest 集成测试（自带临时 DB，无需起服务/db:reset）
pnpm --filter web test                 # vitest 单测（计分派生 / 分组模型 / 课前配置）
pnpm --filter server exec tsc --noEmit # 类型检查（web 同理）
```

服务端测试 harness 在 `server/tests/helpers.ts`：`setupTestApp()` 用 `NCE_DB_PATH` 指向临时库 + 跑 DDL + 最小两组织 seed，返回 `{ app, sqlite, reseed }`，用 `request.agent(app)`（supertest）保持 cookie 跑登录态。新增写接口时**先加用例再实现**。

### 起服务手动验证

```bash
pnpm dev                               # server :5177 + web :5173
# ⚠️ 5173 常被邻近项目 tenderbuddy 占用；vite 无 strictPort 会自增（如 :5174），也可 pnpm --filter web exec vite --port 5180
# 清理端口前先确认进程归属：lsof -nP -iTCP:5177 -sTCP:LISTEN，再看 cwd：lsof -a -p <pid> -d cwd -Fn
pnpm db:reset                          # 重建 app.db。⚠️ 若 dev server 在跑要重启它——better-sqlite3 句柄仍指向被 rm 的旧 inode，不重启看不到新 seed
```

### 后端冒烟（curl）

```bash
# 登录拿 cookie（成功返回老师信息 + Set-Cookie: nce_session=...）
curl -s -i -X POST http://localhost:5177/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"wangli","password":"demo1234"}'
# 未登录访问受保护接口应 401
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5177/api/me
# 带 cookie 复用（-c 存 / -b 读 cookie jar）
CJ=/tmp/nce_cookies.txt
curl -s -c $CJ -X POST http://localhost:5177/api/auth/login -H 'Content-Type: application/json' -d '{"username":"wangli","password":"demo1234"}' >/dev/null
curl -s -b $CJ http://localhost:5177/api/sessions/sess-c1-7/recap | python3 -m json.tool
```

### DB 断言（sqlite3）

```bash
sqlite3 -header -column server/data/app.db "SELECT id,org_id,name,teacher_id FROM classes WHERE id='c1';"
# 某班分组归属 / 组内人数
sqlite3 -header -column server/data/app.db \
  "SELECT cg.name grp, s.name FROM class_group_memberships m JOIN class_groups cg ON cg.id=m.class_group_id JOIN students s ON s.id=m.student_id WHERE cg.class_id='c1' ORDER BY cg.order_index;"
```

### 浏览器端到端（agent-browser）

用 `agent-browser`（Skill 同名）驱动真实浏览器。**管理页都在登录墙后**，先登录：

```bash
agent-browser --session nce set viewport 1440 900
agent-browser --session nce open http://localhost:5180/            # 未登录会跳 /login
agent-browser --session nce snapshot -i                            # 拿 @e 引用（登录后 DOM 变了要重新 snapshot）
agent-browser --session nce fill @e2 "wangli"; agent-browser --session nce fill @e3 "demo1234"
agent-browser --session nce click @e4                              # 登录
agent-browser --session nce screenshot /path/shot.png
agent-browser --session nce close                                  # 用完关闭；若 daemon 卡住也用 close 复位
```

**坑：分组页 HTML5 拖拽调组，`agent-browser drag` 无效**（它发鼠标手势，HTML5 DnD 收不到）。改用 `eval` 手动派发拖拽事件，**分两次**中间 `wait` 让 React 提交 `dragId` 状态：

```bash
# ① 给源/目标元素打 id（draggable 的学生卡是普通 div，snapshot 不给引用），并 dispatch dragstart
agent-browser --session nce eval --stdin <<'EOF'
(() => {
  const rows = [...document.querySelectorAll('[draggable="true"]')];
  const src = rows.find(r => r.textContent.includes('小明'));
  const dst = rows.find(r => r.textContent.includes('军军'));  // 落到目标组里任一学生卡即可（drop 冒泡到组容器）
  window.__dt = new DataTransfer(); window.__dst = dst;
  src.dispatchEvent(new DragEvent('dragstart', { bubbles:true, cancelable:true, dataTransfer: window.__dt }));
  return 'dragstart sent';
})()
EOF
agent-browser --session nce wait 500
# ② dispatch dragover + drop
agent-browser --session nce eval --stdin <<'EOF'
(() => {
  const d = window.__dst, dt = window.__dt;
  d.dispatchEvent(new DragEvent('dragover', { bubbles:true, cancelable:true, dataTransfer: dt }));
  d.dispatchEvent(new DragEvent('drop',     { bubbles:true, cancelable:true, dataTransfer: dt }));
  return 'drop sent';
})()
EOF
# ③ 等保存后用上面的 sqlite3 断言 membership 变化
```

组名改名走 input：`fill @<input> "新名字"` 再 `press Enter`（onKeyDown Enter 触发 blur → 保存）。

**学生端 h5 端到端（三角色 mock 切换）**：`pnpm dev:miniapp` 起 :10086（手机视口 `set viewport 390 844`）。h5 没有 wx.login，登录身份由 storage 里的 mock 名决定，**切角色 = eval 改 `nce.mockUser` + 删 `nce.wxToken` 再 reload**（Taro h5 storage 值有 `{"data": <值>}` 包装）：

```bash
agent-browser --session nce eval --stdin <<'EOF'
(() => {
  localStorage.setItem('nce.mockUser', JSON.stringify({ data: 'dev-teacher' }));  // dev-teacher|dev-parent|dev-new
  localStorage.removeItem('nce.wxToken'); localStorage.removeItem('nce.currentChild');
  return 'ok';
})()
EOF
```

三角色流程（已验证）：`dev-teacher` 打开 / → 自动跳老师端班级列表 → 进三年级A班 → 生成邀请（**「生成邀请」按钮别用 find text——会命中提示文案**，用 eval 找 `taro-button-core` 按 textContent click）→ `sqlite3` 拿 token → 切 `dev-new` 打开 `/#/pages/join/index?invite=<token>` → 填中文名/英文名/手机号 → 确认加入 → index 变等待页 → 切回 `dev-teacher` 刷新班级页 → 队列点「关联到学生」→ 选学生 → Taro showModal 弹窗 `find text "确定" click` → 切 `dev-new` 刷新 → recap 首页（本人组高亮）。断言：`sqlite3 ... "SELECT status,linked_student_id FROM join_requests; SELECT student_id,wechat_account_id FROM student_wechat_bindings;"`。照片上传（chooseImage）浏览器里难自动化，curl 冒烟：先 `POST /api/wx/login` 拿 token，再 `curl -F 'photo=@x.png' -H "Authorization: Bearer $TOKEN" http://localhost:5177/api/wx/upload/photo`。

### 微信开发者工具（weapp 本地调试）

本机已装 `/Applications/wechatwebdevtools.app`（稳定版）。weapp 是正式产物，h5 只是可自动化的开发替身；改动过分享/授权/原生组件相关的东西要在这里人工过一遍。

```bash
# ① 起后端（dev 脚本自带 WX_MOCK=1）
pnpm dev:server
# ② weapp watch 编译（Taro → miniapp/dist；一次性构建用 pnpm --filter miniapp build:weapp）
pnpm --filter miniapp dev:weapp
# ③ 用 CLI 直接打开项目（也可在工具 GUI 里「导入项目」选 miniapp/ 目录——不是 dist/）
/Applications/wechatwebdevtools.app/Contents/MacOS/cli open --project /Users/reorx/Code/nce-class/miniapp
```

- **CLI 前置条件（一次性）**：开发者工具里先扫码登录，并在 设置 → 安全设置 → 打开「服务端口」，否则 `cli open` 报 `需要在设置中打开服务端口`。CLI 其他子命令：`cli quit` 关工具、`cli preview`/`cli upload`（**游客模式不可用**，要正式 appid）。
- **项目配置已预置**（`miniapp/project.config.json`）：`miniprogramRoot: ./dist`（所以导入的是 miniapp/ 而不是 dist/）、`appid: touristappid`（游客模式，无需注册）、`urlCheck: false`（= 详情里的「不校验合法域名」，weapp 直连本机 `http://localhost:5177`，见 `src/lib/api.ts` 的 BASE）。若请求仍被拦，检查 详情 → 本地设置 里该项没被工具按用户维度覆盖回去。
- **模拟器里 mock 登录**：touristappid 的 `wx.login` code 过不了服务端 WX_MOCK 校验，所以 `lib/wxAuth.ts` 约定——storage 里有 `nce.mockUser` 就改发 mock code。在工具 Console 执行后点「编译」刷新：

  ```js
  wx.setStorageSync('nce.mockUser', 'dev-teacher')  // dev-teacher | dev-parent | dev-new
  wx.removeStorageSync('nce.wxToken')               // 换角色必须清 token
  wx.removeStorageSync('nce.currentChild')
  ```

  不放 `nce.mockUser` 则走真 `wx.login`（正式 appid 路径，WX_MOCK 服务端会 401——这是预期）。
- **要人工过的点**：老师端 teacher/class 页「分享到微信群」按钮（`open-type="share"` + useShareAppMessage，模拟器会弹分享卡片，确认转发路径是 `pages/join/index?invite=<token>`）；join 页 `chooseImage` 选图上传；showModal 确认弹窗。
- **真机预览**：`localhost` 在手机上不通——把 `src/lib/api.ts` 的 BASE 临时改成本机局域网 IP（如 `http://192.168.x.x:5177`）再编译；且真机预览/上传本身需要正式 appid（游客模式只能用模拟器）。

**课堂端到端**：登录后走 `课前配置 /classes/c1/setup → 开始课堂 → 课堂五视图 → 结束课堂（预览→确认结束）→ 跳 /classes/c1?tab=sessions 看服务端 recap`。或直连 `/classes/c1/classroom?lesson=4&title=A+private+conversation&duration=120` 用真实默认分组 boot（无参数且无本地 store 会跳 /setup）。**课堂调组 DnD 同样收不到 `agent-browser drag`**，用上面的 `eval` 分两次 dispatch。结束课堂后可 `sqlite3 server/data/app.db "SELECT id,date,client_session_id FROM class_sessions WHERE class_id='c1' ORDER BY date DESC LIMIT 1;"` 断言新 session 落库。清本地进行中课堂：`eval` 里 `localStorage.removeItem('nce.classroom.c1')`（或课堂里点「退出不保存」）。

## 须知 / 约定

- **计分是事件流**：学生累计个人分、组分都由 `score_events`(±1) 派生，不落地存储。
- **学生状态** `students.status`：`active` 在读 / `suspended` 停课 / `archived` 已归档。非 active 完全不进课前配置、课堂与 session 快照（连缺席都不算：web 端 `buildSetup`/`toModel` 过滤，`saveGrouping` 只收 active 所以 commit 回写也会剔除）；人数口径（班级列表卡片/详情 studentCount/wx 老师班级列表/邀请预览）= 在读+停课，归档不计；归档学生详情页 students 数组仍返回（带 status，学生 tab「已归档」筛选查看/恢复/删除），wx 关联候选排除归档且 link 归档学生 400，但**已绑定家长的 children 列表与历史 recap 不受影响**；停课/归档即清默认分组 membership，恢复在读后出现在未分组区需手动拖回组。生产库迁移靠 `provision.migrate()` 的幂等 ALTER。
- **课堂本地优先**：整节课在浏览器本地态跑（`lib/classroomStore.ts`，localStorage key `nce.classroom.<classId>`），加减分/背书作业/出勤/调组/撤销全程可离线；仅「结束课堂」把整堂 `buildCommitPayload` 一次性 POST，后端单事务落库并 `buildRecap` 返回。幂等键 `client_session_id`（`class_sessions` 的 nullable UNIQUE 列，历史 seed 置 null）随重试不变，重复提交返回既有 sessionId。默认分组回写用**开课态**分组（缺席学生保留原组），不是课中调组后的终态。
- **鉴权**：无状态签名 cookie（`auth/session.ts`，HMAC/`AUTH_SECRET`，dev 有 fallback），`app.ts` 中间件 gate `/api/*`；写接口的 `teacherId`/`orgId` 取自当前登录老师。**疑似重复学生只提示不合并**（merge 已砍），靠删除解决。
- seed 自带 DDL（`ddl.ts`），`db:reset` 无需 drizzle-kit；生产迁移用 `pnpm db:generate`。
- 相对时间以 `server/src/util/time.ts` 的 `REFERENCE_TODAY=2026-07-01` 为基准（保证 demo 稳定）。
- 三年级A班刻意保留重复学生「浩浩」演示疑似重复 → 该班默认 13 人、全校 86（写操作会改变计数）。
- **端口 5173 也被邻近项目 tenderbuddy 占用**，清理进程时勿误杀。
- **账户体系：student 与 wechat_account 分开看待**（2026-07-02 重构）——student 是教师建立的教学实体，wechat_account 是纯微信身份（老师/家长共用一张表，角色由关联关系决定）：teacher↔account 走 `credentials(provider='wechat', wechat_account_id)`（小程序 bind 页输 web 用户名+密码一次绑定）；student↔account 走 `student_wechat_bindings`（N:M，多孩/父母都看）；家长注册只建 `join_requests`（同班同账户 pending 唯一，重复提交覆盖更新），**由老师在小程序关联到已有学生**（回填空字段不覆盖）。邀请是一次性带过期 token（`class_invites`，7 天，可并存），固定班级邀请码已废弃。
- **wx 会话是 Bearer token**（`Authorization: Bearer`，subject=wechatAccountId，与老师 cookie 互不通用）；无 appid 时 `WX_MOCK=1` 用 `mock:<name>` code，seed 三个 mock 账户：`dev-teacher`（绑 wangli）、`dev-parent`（绑 s-c1-1 小明）、`dev-new`（全新）；h5 端身份取 storage `nce.mockUser`（默认 dev-new）。孩子列表由服务端 bindings 派生，本地只记 `nce.currentChild`（studentId）。Taro h5 dev 必须关 prebundle（`compiler: { type:'webpack5', prebundle:{enable:false} }`，否则 webpack-virtual-modules 崩）。
- 遵循用户全局约定：pnpm 装依赖（`pnpm add`，勿手改 package.json）；勿用 try/catch 除非要求；改完代码不跑 formatter/linter。

## 待做（后续阶段）

- **邀请与账户体系已完成**（见 `kb/plans/2026-07-02-nce-class-wechat-account-invite.md`）：wx Bearer 会话 + 老师绑定 + 小程序生成邀请/分享 + join_request 队列关联 + binding 守卫 recap + web 只读队列，h5 三角色端到端已验证；weapp（真分享卡片 useShareAppMessage）需在微信开发者工具里人工过一遍。
- 老师端学生成长档案 §7.4（下一个 plan：纯读派生，`GET /api/students/:id/profile` + 页面；binding 守卫模式已就绪）。
- 有正式 appid 后：真 code2session（WX_APPID/WX_SECRET 已留好）、小程序码 scene 扫码邀请、服务器域名白名单、发布；wx.getPhoneNumber（需企业认证）不做，手机号手填。
- 老师管理页（Teachers.tsx）仅占位；计时器超时正计已做；投屏实时多端同步 M1 不做；已 dismissed/linked 队列历史界面 M1 不做。
