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
  src/pages/{ClassList,ClassDetail,Teachers,Login}.tsx  ClassList 建班与 ClassDetail 编辑班级共用 components/ClassInfoModal.tsx（名称/教材册数/负责老师，onSubmit 调用方注入；「课程级别」字段已删）；ClassDetail 学生增删/分组 DnD/班级资源/作业模板/上课记录（课名站内链接进 session 详情页，作业已布置显示标记）
  src/pages/SessionDetail.tsx          Session 详情页 `/classes/:id/sessions/:sid`（结束课堂后落地；?tab=homework|recap）：作业布置 tab（作业模板卡共用组件 + 作业内容生成/手改 + 课文复习级联选择 + 完成布置）+ Recap tab（RecapPanel）。旧 RecapPreview 页已删（路由 `/…/recap` 不再存在，无重定向）
  src/components/RecapPanel.tsx        课堂战报面板（原 RecapPreview 本体）：左=移动端预览（手机边框）、右=下载图片/复制图片（html-to-image 截 RecapCard 本体，pixelRatio 2）/推送全班（placeholder toast）
  src/components/HomeworkTemplateEditor.tsx  作业模板卡片（NotesTab 同款编辑/查看），班级管理「作业模板」tab 与 session 详情页共用，保存动作由调用方注入
  src/lib/homework.ts (+ .test.ts)     作业纯派生：BOOK_LESSON_COUNTS 每册课数（镜像 server app.ts）/lessonOptions/clampLesson 级联默认/fmtDateCn/renderHomeworkTemplate（{lesson_number}/{date}/{class_name} 变量替换）
  src/lib/lesson.ts (+ .test.ts)       lessonLabel 课次标签（合并原 setup.ts lessonLabel 与 ClassDetail fmtLesson 两份实现）
  src/components/RecapCard.tsx         课堂战报卡片（还原设计稿「Recap 页面.dc.html」）：头部/各组得分领奖台/今日之星+老师提醒；传 personal 显示个人卡（到课/个人分/背书作业状态），不传即全班版
  src/lib/recapCard.ts (+ .test.ts)    战报纯派生：podium 领奖台排列（冠军居中）/groupBars 柱高/fmtDurationCn/dateLabel/背书作业 tone（与小程序 recapView 口径一致）
  src/components/{TopBar,Modal,Toast}.tsx  TopBar 退出登录；通用 Modal + Toast
  src/pages/Setup.tsx                  课前配置：本节课信息 + 上节课回顾 + 默认分组微调（拖拽/增组/缺席暂存）→ 开始课堂（写本地 store，不发后端）
  src/pages/Classroom.tsx              课堂主界面：看板/背书/作业/出勤/调组/班级信息/日志 七视图 + 学生/小组浮窗 + recap。班级信息视图（dock 左侧独立按钮）左=班级/本节课信息、右=班级资源 markdown（可编辑保存；进视图时现场 GET classDetail，不进本地 session 快照）。日志视图（dock 独立按钮）合并时间线最新在上：加减分条目带「撤销」（任意单条，undoEvent 删事件→个人分与组分原子回退）、背书/作业/出勤变更仅记录。学生浮窗按视图分化（上课=加减分/背书=背书状态/作业=作业状态，点选即提交并自动关窗，状态弹窗含显式「未检查」项且高亮当前状态）。本地优先：从 store 恢复/URL 参数 boot/否则跳 setup；每次改动落 localStorage；结束课堂预览→确认→一次性 commit；「退出不保存」放弃本地 session
  src/lib/api.ts                       fetch 客户端（get/post/put/del + ApiError 401；login/logout/createClass/addStudent/deleteStudent/saveGrouping/sessionDetail/saveSessionHomework/updateHomeworkTemplate/commitSession）
  src/lib/grouping.ts (+ .test.ts)     分组方案可编辑模型（toModel/moveStudent/addGroup/removeGroup/renameGroup/toPayload）
  src/lib/session.ts (+ .test.ts)      课堂事件流计分派生（sScore/gScore/recap，学生 id 为 string）+ Lesson 3 demo scenario（仅 session.test.ts 夹具）
  src/lib/setup.ts (+ .test.ts)        课前配置分组模型（buildSetup/moveStudent/addGroup/sums）+ 开始课堂 config 快照（buildSessionConfig 携带缺席名单含原组 / configFromDetail）
  src/lib/classroomStore.ts (+ .test.ts) 课堂本地状态：ClassroomSession 模型 + reducer（加减分/背书作业/出勤/调组/撤销 undo 尾部 + undoEvent 任意单条）+ localStorage 持久化 + buildClassroomSession/buildCommitPayload/nowSql；可选 log 数组存背书/作业/出勤变更（StatusLogEntry，与 events 共用 nid 发号成全序，点同状态 no-op 不记，仅本地永不进 commit payload）
  src/lib/classroomLog.ts (+ .test.ts) 课堂日志派生 buildLogLines：events（可撤销，带组同步说明）+ log（仅记录）合并按 id 倒序成时间线
  src/pages/ClassAttendance.tsx        考勤页 `/classes/:id/attendance`（还原设计稿「历史出勤.dc.html」，课堂系 Nunito/Baloo 风格全屏网格）：列=该班 ended sessions（无学期/排课概念，不渲染设计稿的「待上/下次」列与学期切换）、行=非归档学生（停课=删除线+灰 tag，插班=行首 off 格推导出黄 tag）；格子 ✓/✕/假/·（off=无 membership 快照，锁定不可点）+ 补 角标，crosshair hover；点格开更正弹窗（到勤/缺勤/请假 + 补课开关，乐观更新失败回滚）+ 撤销栈（逐条重放 prev 值 PUT）+ 导出 CSV（前端 BOM Blob）；行出勤率=（present+补课)/在班次数，≥90 绿 ≥75 橙 否则红；入口=班级卡片「考勤」按钮（开始上课右侧）
  src/lib/attendance.ts (+ .test.ts)   考勤纯派生：recordKey/rowCells（缺 membership → status null=off）/rowStats（补课计入出勤）/rateColor 阈值/rowTag 停课·插班/classAttendanceStats 均值·满勤/weekdayCN/dateParts/buildAttendanceCsv
miniapp/  Taro 4 + React + TS（webpack5，prebundle 关闭）· 学生端小程序（weapp 正式产物 / h5 开发调试，正式 appid wx19490e22f3580fb0；browserslist 锁 chrome60/ios10——微信 CI 校验器不认 ES2020 语法（??/?.），勿改回 es6-module 目标）
  config/index.ts                      双端编译配置；h5 devServer :10086 代理 /api、/uploads → :5177
  src/app.config.ts                    pages: index（分流：teacher→老师端导航中枢 / 有孩子→recap 首页+多孩 chips / pending→等待页 / 欢迎页）/ join（?invite= 落地：预览+四项表单）/ recap（?sid=&student=）/ bind（老师绑定）/ teacher/home（老师端首页=导航中枢：班级管理卡带全校 pending 角标 + 上课记录卡）/ teacher/classes（角标列表）/ teacher/class（生成邀请+队列关联）/ teacher/sessions（org 级上课记录一览，作业已布置/未布置标记，行暂不可点——课后处理/recap 分享将来挂这）
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

**部署**：仓库根 `Dockerfile` + `docker-compose.yml`（服务器现场 build，容器只跑 API，web 静态由宿主机 Caddy serve），发布脚本 `deploy/release.sh`（SSH 到 server.name：reset 代码 → build → 拷 webdist → db:migrate → up -d；**加 `--miniapp`/`-m` 会在服务器部署成功后接着从本地上传 weapp**——本地构建+miniprogram-ci，自动用 nvm node24，缺密钥/本地与 origin/master 不一致会报警，传完仍需 mp 后台设体验版或提审）。server 新增 `pnpm --filter server db:migrate`（幂等 DDL，server 启动时也会自动跑）与 `pnpm --filter server create-teacher -- --org ... --name ... --username ... --password ...`（干净库开真实账号）。细节见 `kb/plans/2026-07-02-nce-class-deploy.md`。

**登录墙**：管理页均需登录，先访问 `/login` 用 seed 老师登录（如 `wangli` / `demo1234`，全体老师同密码）。会话是 httpOnly 签名 cookie `nce_session`（7 天）。

已实现页面：登录 `/login`；班级列表 `/`；班级详情 `/classes/c1?tab=students|groups|notes|homework|invite|sessions`（班级基本信息编辑弹窗、学生增删、分组 DnD 保存、班级资源 markdown 查看/编辑、作业模板查看/编辑、上课记录课名点入 session 详情页）；session 详情 `/classes/c1/sessions/:sid?tab=homework|recap`（结束课堂「确认结束」后直接落地此页；作业布置 + Recap 两 tab；**旧 `/classes/:id/sessions/:sid/recap` 路由已删除，无重定向**）；课前配置 `/classes/c1/setup`；课堂主界面 `/classes/c1/classroom`（直连判定顺序：①本地 store 命中该班进行中课堂→恢复 ②URL 带 `?lesson=4&title=...&duration=120`→用真实默认分组 boot 全新 session ③否则重定向 `/setup`；Lesson 3 固定 demo 不再有页面入口）。
API（除 `/api/health`、`/api/auth/login` 外全部经认证中间件，写入用 `req` 上的当前老师 + orgId 过滤）：
- 认证：`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/me`（无会话 401）、`POST /api/auth/verify-password`（登录墙内重验当前老师密码，错误 403 不影响会话；课堂「放弃本节课」弹窗用）。
- 读：`GET /api/classes`、`GET /api/classes/:id`（含 `lastRecap`；补 `textbook`/`homeworkTemplate`，sessions 行带 `hasHomework`）、`GET /api/sessions/:id`（**session 详情**：sessionSummary + 班级上下文 `classId/className/classTextbook/homeworkTemplate` + `homeworkContent/reviewBook/reviewLesson` + 内嵌 `recap`，session 详情页一次拿全；跨组织 404）、`GET /api/sessions/:id/recap`（组分排名 + 🌟亮眼(净≥2)/⚠️被提醒(任一−1) + 出勤）。
- 写：`POST /api/classes`（可选 `textbook` 教材册数 1-4 非法 400；可选 `teacherId` 负责老师，缺省=当前登录老师、须同校否则 400）、`PUT /api/classes/:id`（**班级基本信息**整替换：`{name, teacherId, textbook?}`，name/teacherId 必填、textbook 1-4 或 null 否则 400、teacherId 须同校老师否则 400，返回 classDetail；classDetail 补 `teacherId` 供表单预填。**「课程级别」`classes.level` 已删**（2026-07-05，`provision.migrate` 幂等 DROP COLUMN，读写 payload 均无 level）。前端：详情页头部「✎ 编辑」与班级列表「新建班级」共用 `components/ClassInfoModal.tsx` 弹窗（名称/教材册数/负责老师下拉））、`POST /api/classes/:id/students`、`DELETE /api/students/:id`（硬删连带清账本）、`PUT /api/students/:id/status`（`{status:'active'|'suspended'|'archived'}`，非 active 时清默认分组 membership；恢复在读不还原分组）、`PUT /api/classes/:id/groups`（整套 replace 默认分组，前端拖拽/改名/增删即时保存）、`PUT /api/classes/:id/notes`（**班级资源** markdown 整篇 replace，`{notes:string}` 空白串存 null，返回 classDetail；列 `classes.notes`，渲染用 `marked`——内容仅同校老师可写故不消毒，web 共用 `components/Markdown.tsx` + global.css `.md-body`）、`POST /api/classes/:id/sessions`（**结束课堂一次性提交**：单事务里回写默认分组 §7.2 + 建 ClassSession(ended)/SessionGroup/SessionMembership 快照 + 批量 ScoreEvent/CheckRecord + buildRecap 返回；`clientSessionId` 幂等，`date` 由 `startedAt` 前 10 位派生，`startedAt/endedAt` 须为 `YYYY-MM-DD HH:mm:ss`；可选 `teacherId` = **主讲老师**（须同校否则 400，缺省=提交老师），落 `class_sessions.teacher_id`，classDetail 的 sessions 带 `teacherName`。前端：课前配置「本节课」卡 + 课堂信息编辑弹窗均有主讲老师下拉（`GET /api/teachers` + `GET /api/me` 默认当前登录老师），teacherId/teacherName 随 SessionConfig→ClassroomSession→commit payload 贯穿，`setLessonInfo` 不带 teacher 字段时保持原选择；弹窗另可改**开始时间**（HH:MM time input，`applyStartTime` 只换时分保留日期、秒归零，不带 `startedAt` 时保持原值——持久化 shape 未变，新旧版本进行中课堂互相兼容），倒计时按新 startedAt 重算。课堂头部：左=课次课题（粗黑，点击开弹窗），右=班级名+倒计时（浅灰无背景，超时红字））、`PUT /api/sessions/:id`（**修改上课记录开始时间**：`{startedAt:'YYYY-MM-DD HH:mm:ss'}`，格式校验 + 须早于 `ended_at` 否则 400，`date` 按 startedAt 前 10 位重新派生，实际时长读侧派生自动变化；classDetail 的 sessions 带 `startedAt/endedAt`。前端：上课记录行「改时间」按钮（无 startedAt 的旧行隐藏）→ 弹窗 HH:MM time input（复用 `applyStartTime`/`startTimeOf`，只换时分保留日期），早于结束时间校验红字提示、改输入即清除）、`PUT /api/classes/:id/homework-template`（**作业模板**整篇 replace：`{template:string}` 空白存 null，返回 classDetail；列 `classes.homework_template`，变量 `{lesson_number}/{date}/{class_name}` 生成在前端做——`lib/homework.ts renderHomeworkTemplate`）、`PUT /api/sessions/:id/homework`（**完成布置**：`{content, reviewBook?, reviewLesson?}`，content 空白存 null；reviewBook 1-4、reviewLesson 1..每册课数（一144/二96/三60/四48，`BOOK_LESSON_COUNTS` 前后端镜像）、有 lesson 必须有 book 否则 400；返回 sessionDetailPayload。**作业在 commit 之后的详情页填写，独立 PUT，不进 commit payload、不碰向后兼容契约**。前端：作业布置 tab 打开时若无已保存作业内容按模板自动生成一次，「生成」按钮手动覆盖，课文复习默认 册=classes.textbook、课=lessonNumber）。
- 队列只读镜像：`GET /api/classes/:id/join-requests`（cookie 会话；处理只在小程序做）。
- 小程序（`/api/wx/*`，**Bearer token** 而非 cookie；`POST /api/wx/login` 公开，其余走 wx gate）：
  - 会话/身份：`POST /api/wx/login`（`{code}` → code2session/mock → upsert 账户 → `{token, me}`）、`GET /api/wx/me`（`{account, teacher|null, children[], pending[]}`，children 来自 bindings、pending 是排队中的 join_request）、`POST /api/wx/bind-teacher`（`{username,password}` 一次性绑定；老师已被绑/微信已绑过 → 409）。
  - 老师侧（wx 会话且已绑 teacher，未绑 403，orgId 从 teacher 取）：`GET /api/wx/teacher/classes`（含 pendingCount 角标）、`GET /api/wx/teacher/sessions`（org 级上课记录 brief，与 web `GET /api/sessions` 同 shape：sessionSummary + classId/className）、`POST /api/wx/teacher/classes/:id/invites`（→ `{token(nanoid16), expiresAt(+7天), sharePath}`，新旧邀请并存各自过期）、`GET .../join-requests`（pending 队列含微信昵称）、`GET .../students`（花名册标注 linked）、`POST /api/wx/join-requests/:id/link`（`{studentId}` 单事务：建 binding + status=linked + 回填 student 空字段 photo/en_name/parent_phone 不覆盖已有值；非 pending/跨组织 404、学生不在该班 400）、`POST /api/wx/join-requests/:id/dismiss`。
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

- **CLI 前置条件（一次性）**：开发者工具里先扫码登录，并在 设置 → 安全设置 → 打开「服务端口」，否则 `cli open` 报 `需要在设置中打开服务端口`。CLI 其他子命令：`cli quit` 关工具。**预览/上传不走工具 CLI**，用 `miniprogram-ci`（见下条）。
- **项目配置已预置**（`miniapp/project.config.json`）：`miniprogramRoot: ./dist`（所以导入的是 miniapp/ 而不是 dist/）、`appid: wx19490e22f3580fb0`（正式 appid，2026-07-05 起）、`urlCheck: false`（= 详情里的「不校验合法域名」，weapp dev 构建直连本机 `http://localhost:5177`，正式构建指 `https://service.domain`，见 `src/lib/api.ts` 的 BASE 按 NODE_ENV 分流）。若请求仍被拦，检查 详情 → 本地设置 里该项没被工具按用户维度覆盖回去。
- **真机预览/上传（miniprogram-ci，无需开发者工具）**：`pnpm --filter miniapp preview:weapp`（二维码落 `tmp/weapp-preview-qr.jpg`）/ `pnpm --filter miniapp upload:weapp`（传开发版本，之后在 mp 后台「版本管理」设体验版）。**两个坑**：①上传密钥在 gitignored `tmp/private.wx19490e22f3580fb0.key`（mp 后台可重新生成）；②**Homebrew node 25 跑不了 miniprogram-ci**（`getItem is not a function` / worker `close` 崩），要用 nvm 的 node 24 前缀 PATH：`PATH="$HOME/.nvm/versions/node/v24.6.0/bin:$PATH" pnpm --filter miniapp preview:weapp`。
- **模拟器里 mock 登录**：本地 server 是 WX_MOCK，真 `wx.login` code 过不了校验，所以 `lib/wxAuth.ts` 约定——storage 里有 `nce.mockUser` 就改发 mock code。在工具 Console 执行后点「编译」刷新：

  ```js
  wx.setStorageSync('nce.mockUser', 'dev-teacher')  // dev-teacher | dev-parent | dev-new
  wx.removeStorageSync('nce.wxToken')               // 换角色必须清 token
  wx.removeStorageSync('nce.currentChild')
  ```

  不放 `nce.mockUser` 则走真 `wx.login`（正式 appid 路径，WX_MOCK 服务端会 401——这是预期）。
- **要人工过的点**：老师端 teacher/class 页「分享到微信群」按钮（`open-type="share"` + useShareAppMessage，模拟器会弹分享卡片，确认转发路径是 `pages/join/index?invite=<token>`）；join 页 `chooseImage` 选图上传；showModal 确认弹窗。
- **真机预览**：`preview:weapp` 打的是正式构建（BASE=service.domain），扫码直连生产。要真机连本地 server 时才需要把 BASE 临时改成本机局域网 IP（如 `http://192.168.x.x:5177`）再编译。

**课堂端到端**：登录后走 `课前配置 /classes/c1/setup → 开始课堂 → 课堂五视图 → 结束课堂（预览→确认结束）→ 落地 session 详情页 /classes/c1/sessions/<sid>（默认作业布置 tab，?tab=recap 看服务端 recap）`。或直连 `/classes/c1/classroom?lesson=4&title=A+private+conversation&duration=120` 用真实默认分组 boot（无参数且无本地 store 会跳 /setup）。**课堂调组 DnD 同样收不到 `agent-browser drag`**，用上面的 `eval` 分两次 dispatch。结束课堂后可 `sqlite3 server/data/app.db "SELECT id,date,client_session_id FROM class_sessions WHERE class_id='c1' ORDER BY date DESC LIMIT 1;"` 断言新 session 落库。清本地进行中课堂：`eval` 里 `localStorage.removeItem('nce.classroom.c1')`（或课堂里点「退出不保存」）。

## 须知 / 约定

- **计分是事件流**：学生累计个人分、组分都由 `score_events`(±1) 派生，不落地存储。
- **学生状态** `students.status`：`active` 在读 / `suspended` 停课 / `archived` 已归档。非 active 完全不进课前配置、课堂与 session 快照（连缺席都不算：web 端 `buildSetup`/`toModel` 过滤，`saveGrouping` 只收 active 所以 commit 回写也会剔除）；人数口径（班级列表卡片/详情 studentCount/wx 老师班级列表/邀请预览）= 在读+停课，归档不计；归档学生详情页 students 数组仍返回（带 status，学生 tab「已归档」筛选查看/恢复/删除），wx 关联候选排除归档且 link 归档学生 400，但**已绑定家长的 children 列表与历史 recap 不受影响**；停课/归档即清默认分组 membership，恢复在读后出现在未分组区需手动拖回组。生产库迁移靠 `provision.migrate()` 的幂等 ALTER。
- **课堂本地优先**：整节课在浏览器本地态跑（`lib/classroomStore.ts`，localStorage key `nce.classroom.<classId>`），加减分/背书作业/出勤/调组/撤销全程可离线；仅「结束课堂」把整堂 `buildCommitPayload` 一次性 POST，后端单事务落库并 `buildRecap` 返回。幂等键 `client_session_id`（`class_sessions` 的 nullable UNIQUE 列，历史 seed 置 null）随重试不变，重复提交返回既有 sessionId。默认分组回写用**开课态**分组（缺席学生保留原组），不是课中调组后的终态。**提交失败兜底**：confirmEnd 在 POST 前先把 payload+完整 session 备份到 `nce.classroom.backup.<clientSessionId>`（按 clientSessionId 独立成键，同班开新课覆盖 `nce.classroom.<classId>` 也冲不掉；保留最新 10 条），服务端确认成功才 `clearCommitBackup`；备份的 payload 可原样重 POST（幂等）。API：`saveCommitBackup/listCommitBackups/clearCommitBackup`。
- **⚠️ 结束课堂 schema 向后兼容（protobuf 式，不可破坏）**：课堂进行中服务端可能发新版，旧页面的 commit payload 必须照常入库。演进纪律——①服务端永不新增必填字段，新字段一律可选带默认（先例：`teacherId`→提交老师、`createdAt`→startedAt）；②不收紧既有字段校验、不改名、不改语义；③未知字段静默忽略（`buildCommitInput` 显式挑字段，勿引入 schema-strict 校验）。同理 web 端 localStorage 持久化的 `ClassroomSession` shape 也只加可选字段（页面刷新后新代码要能读旧存档，先例：teacherId/startedAt）。守卫用例：`server/tests/api.test.ts` 的「向后兼容/向前兼容」两条——挂了改契约不改测试。注释位置：server `buildCommitInput`/`CommitInput`、web `CommitPayload`/`classroomStore.ts` persistence 段。
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
- **小程序上线链路**（进展清单见 `kb/notes/2026-07-04-miniapp-invite-launch-gaps.md`）：✅ 正式 appid（wx19490e22f3580fb0 已入 project.config.json；secret 在 gitignored tmp/，勿入库）✅ 生产 .env 已配 WX_APPID/WX_SECRET 并移除 WX_MOCK（2026-07-04，mock 登录已 401）✅ API BASE 按 NODE_ENV 环境化（dev→localhost:5177，build:weapp→https://service.domain）。✅ 域名白名单已配 ✅ miniprogram-ci 预览/上传已跑通（0.1.0 已传，脚本与 node24/browserslist 坑见「微信开发者工具」节）✅ 体验版已设、真机老师绑定验证通过（2026-07-05）。**当前唯一阻塞：小程序年度认证**（个人主体 30 元/年+人脸核身，未认证禁分享——真机分享邀请卡片被提示「未完成认证」）→ 认证后真机过邀请全流程 → 审核发布；wx.getPhoneNumber（需企业认证）不做，手机号手填；小程序码 scene 扫码邀请为 nice-to-have。
- **recap 分享到微信群 + 课后处理**（plan 已写好待实现，见 `kb/plans/2026-07-04-nce-class-recap-wechat-share.md`）：session 级分享卡片（path 只带 sid）+ 落地三态分流（teacher 全班版 / parent 选孩子走现有个性化端点 / guest 班级预览+引导加入）+ 老师端小程序「课后处理」入口（近期已上完的课 → 分享 Recap+作业到学生群，recap 页渲染作业 section）；新端点 `GET /api/wx/sessions/:sid/recap`、`GET /api/wx/teacher/classes/:id/sessions`；无 schema 变更（作业列已随 web 端作业机制落地）。
- 老师管理页（Teachers.tsx）仅占位；计时器超时正计已做；投屏实时多端同步 M1 不做；已 dismissed/linked 队列历史界面 M1 不做。
