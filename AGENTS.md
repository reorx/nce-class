# AGENTS.md

新概念英语课堂教学辅助系统。当前进度：**M1 · 基础框架 + 老师端班级管理页面（读+写闭环，含登录鉴权）+ 课前配置页 + 课堂主界面（本地优先 + 结束课堂一次性提交入库，含默认分组回写/session 快照/事件流/背书作业/出勤）+ 学生端微信小程序（Taro 双端：邀请码加入 + 个性化 recap）+ 存储层 Minio/OSS 落地**。
需求/设计以 `kb/plans/2026-06-30-nce-class-m1-prd.md` 为准；班级管理写操作+登录见 `kb/plans/2026-07-01-nce-class-m1-management-wiring.md`；课堂运行时持久化见 `kb/plans/2026-07-02-nce-class-classroom-backend.md`；学生端小程序+存储见 `kb/plans/2026-07-02-nce-class-student-miniapp.md`（**学生端由 PRD 的 H5 改为小程序**，用户 2026-07-02 决定）。设计还原参考 `nce-class-v1-design/*.dc.html`（gitignored）。

## 结构

pnpm workspace，前后端分离：

```
server/   Express + TS · Drizzle ORM + SQLite (better-sqlite3)
  src/db/{schema,ddl,seed,client}.ts   模型全程带 orgId；计分用 score_events 事件流派生（client 的 DB 路径可用 NCE_DB_PATH 覆盖，供测试）
  src/db/mutations.ts                  写操作（createClass/addStudent/addParentStudent/deleteStudent 硬删/saveGrouping replace/commitSession 结束课堂单事务），事务封装
  src/auth/{password,session}.ts       自建密码认证 + 无状态签名 cookie（HMAC，AUTH_SECRET）+ parseCookies（session.test.ts）
  src/storage/                         StorageClient 抽象层：local（默认，NCE_UPLOAD_DIR 可覆盖）/ minio / oss，S3_VENDOR 切换（tests/storage.test.ts）；远端桶按 public-read，getUrl 同步拼 URL；students.photo_url 存 key 不存 URL，读侧 getUrl(key) 解析
  src/app.ts                           createApp()：读+写 REST + 免登录 /api/parent/*（注册在 gate 之前，token 即凭据）+ 认证中间件（gate 其余 /api/*）；server.ts 仅 listen
  tests/                               vitest + supertest 集成测试（临时 DB harness，覆盖登录/增删/分组/建班/recap/跨组织隔离/parent 加入+个性化 recap/存储 switch）
web/      React + Vite + TS · 老师端桌面 Web（管理页 IBM Plex；课堂界面 Nunito/Baloo 2）
  src/App.tsx                          顶层 auth guard（GET /api/me → 401 跳 /login）+ ToastProvider
  src/pages/{ClassList,ClassDetail,Teachers,Login}.tsx  ClassList 建班 modal；ClassDetail 学生增删/分组 DnD/recap 浮窗
  src/components/{TopBar,Modal,Toast}.tsx  TopBar 退出登录；通用 Modal + Toast
  src/pages/Setup.tsx                  课前配置：本节课信息 + 上节课回顾 + 默认分组微调（拖拽/增组/缺席暂存）→ 开始课堂（写本地 store，不发后端）
  src/pages/Classroom.tsx              课堂主界面：看板/背书/作业/出勤/调组 五视图 + 学生/小组浮窗 + recap。本地优先：从 store 恢复/URL 参数 boot/否则跳 setup；每次改动落 localStorage；结束课堂预览→确认→一次性 commit；「退出不保存」放弃本地 session
  src/lib/api.ts                       fetch 客户端（get/post/put/del + ApiError 401；login/logout/createClass/addStudent/deleteStudent/saveGrouping/getSessionRecap/commitSession）
  src/lib/grouping.ts (+ .test.ts)     分组方案可编辑模型（toModel/moveStudent/addGroup/removeGroup/renameGroup/toPayload）
  src/lib/session.ts (+ .test.ts)      课堂事件流计分派生（sScore/gScore/recap，学生 id 为 string）+ Lesson 3 demo scenario（仅 session.test.ts 夹具）
  src/lib/setup.ts (+ .test.ts)        课前配置分组模型（buildSetup/moveStudent/addGroup/sums）+ 开始课堂 config 快照（buildSessionConfig 携带缺席名单含原组 / configFromDetail）
  src/lib/classroomStore.ts (+ .test.ts) 课堂本地状态：ClassroomSession 模型 + reducer（加减分/背书作业/出勤/调组/撤销）+ localStorage 持久化 + buildClassroomSession/buildCommitPayload/nowSql
miniapp/  Taro 4 + React + TS（webpack5，prebundle 关闭）· 学生端小程序（weapp 正式产物 / h5 开发调试，appid=touristappid 游客模式）
  config/index.ts                      双端编译配置；h5 devServer :10086 代理 /api、/uploads → :5177
  src/app.config.ts                    pages: index（最新 recap+历史+多孩切换）/ join（输邀请码→预览→照片+名字→加入）/ recap（单堂 ?sid=）
  src/lib/api.ts                       Taro.request 封装（h5 相对路径走代理；weapp 直连 :5177 需关域名校验）+ uploadPhoto(Taro.uploadFile)
  src/lib/children.ts (+ .test.ts)     「我的孩子」列表纯模型（parseState/addChild/removeChild/setCurrent）；childrenStore.ts 是 Taro storage 粘合（key nce.children）
  src/lib/recapView.ts (+ .test.ts)    recap 展示派生（medals 并列名次/状态配色 tone/fmtScore）；components/RecapView.tsx 还原 08-student-h5.html
```

## 开发命令

```bash
pnpm install     # 首次会编译 better-sqlite3 原生模块
pnpm db:reset    # 重建并填充 SQLite mock 数据 → server/data/app.db
pnpm dev         # server :5177 + web :5173（vite 代理 /api、/uploads）
```

单独启动 `pnpm dev:server` / `pnpm dev:web` / `pnpm dev:miniapp`（= miniapp h5 watch，:10086，需 server 在跑）。小程序真机/开发者工具：`pnpm --filter miniapp dev:weapp` 后用微信开发者工具导入 `miniapp/`（产物在 `miniapp/dist`，详情里勾选「不校验合法域名」才能连本机 :5177）。类型检查 `pnpm --filter <pkg> exec tsc --noEmit`；单测 `pnpm --filter web test` / `pnpm --filter server test` / `pnpm --filter miniapp test`（均 vitest）。

**登录墙**：管理页均需登录，先访问 `/login` 用 seed 老师登录（如 `wangli` / `demo1234`，全体老师同密码）。会话是 httpOnly 签名 cookie `nce_session`（7 天）。

已实现页面：登录 `/login`；班级列表 `/`；班级详情 `/classes/c1?tab=students|groups|invite|sessions`（学生增删、分组 DnD 保存、上课记录 recap 浮窗）；课前配置 `/classes/c1/setup`；课堂主界面 `/classes/c1/classroom`（直连判定顺序：①本地 store 命中该班进行中课堂→恢复 ②URL 带 `?lesson=4&title=...&duration=120`→用真实默认分组 boot 全新 session ③否则重定向 `/setup`；Lesson 3 固定 demo 不再有页面入口）。
API（除 `/api/health`、`/api/auth/login` 外全部经认证中间件，写入用 `req` 上的当前老师 + orgId 过滤）：
- 认证：`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/me`（无会话 401）。
- 读：`GET /api/classes`、`GET /api/classes/:id`（含 `lastRecap`）、`GET /api/sessions/:id/recap`（组分排名 + 🌟亮眼(净≥2)/⚠️被提醒(任一−1) + 出勤）。
- 写：`POST /api/classes`、`POST /api/classes/:id/students`、`DELETE /api/students/:id`（硬删连带清账本）、`PUT /api/classes/:id/groups`（整套 replace 默认分组，前端拖拽/改名/增删即时保存）、`POST /api/classes/:id/sessions`（**结束课堂一次性提交**：单事务里回写默认分组 §7.2 + 建 ClassSession(ended)/SessionGroup/SessionMembership 快照 + 批量 ScoreEvent/CheckRecord + buildRecap 返回；`clientSessionId` 幂等，`date` 由 `startedAt` 前 10 位派生，`startedAt/endedAt` 须为 `YYYY-MM-DD HH:mm:ss`）。
- 学生端（**免登录**，`/api/parent/*`，token 即凭据）：`GET /api/parent/join/:inviteToken`（班级预览）、`POST .../photo`（multipart `photo` ≤5MB 仅图片 → `{key,url}`，先传照片后加入）、`POST /api/parent/join/:inviteToken`（`{name, photoKey?}` → 建 source=parent 学生 + 发 recapToken）、`GET /api/parent/me/:recapToken`（学生+班级+ended sessions+latestSessionId）、`GET /api/parent/me/:recapToken/sessions/:sessionId`（个性化 recap：buildRecap + `mine`{attended/组/personalScore(只算 student 事件)/homework(缺记录=没交)/recitation(缺记录=未检查)} + `groups[].mine` 高亮；无 membership→`mine:null`；跨班 404）。邀请码在 `classes.invite_token`（seed 固定值，c1 = `c1x8kq2mlp`；createClass 生成小写 10 位）。

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

**学生端 h5 端到端**：`pnpm dev:miniapp` 起 :10086（手机视口 `set viewport 390 844`），流程 `index 空态 → 输入邀请码加入班级 → 填 c1x8kq2mlp → 查看班级 → 填名字 → 确认加入 → 回 index 看最新 recap → 点历史课堂进 /pages/recap/index?sid=...`。按钮多为 `find text "..." click`（Taro 的 View 无标准 role）。加入后 `sqlite3` 断言 `SELECT name,source FROM students WHERE source='parent'`。**坑：Taro h5 的 storage 值有 `{"data": <json string>}` 包装**，eval 注入孩子列表要按此格式写 `nce.children`。照片上传（chooseImage）浏览器里难自动化，用 curl 冒烟：`curl -F 'photo=@x.png' http://localhost:5177/api/parent/join/c1x8kq2mlp/photo`。

**课堂端到端**：登录后走 `课前配置 /classes/c1/setup → 开始课堂 → 课堂五视图 → 结束课堂（预览→确认结束）→ 跳 /classes/c1?tab=sessions 看服务端 recap`。或直连 `/classes/c1/classroom?lesson=4&title=A+private+conversation&duration=120` 用真实默认分组 boot（无参数且无本地 store 会跳 /setup）。**课堂调组 DnD 同样收不到 `agent-browser drag`**，用上面的 `eval` 分两次 dispatch。结束课堂后可 `sqlite3 server/data/app.db "SELECT id,date,client_session_id FROM class_sessions WHERE class_id='c1' ORDER BY date DESC LIMIT 1;"` 断言新 session 落库。清本地进行中课堂：`eval` 里 `localStorage.removeItem('nce.classroom.c1')`（或课堂里点「退出不保存」）。

## 须知 / 约定

- **计分是事件流**：学生累计个人分、组分都由 `score_events`(±1) 派生，不落地存储。
- **课堂本地优先**：整节课在浏览器本地态跑（`lib/classroomStore.ts`，localStorage key `nce.classroom.<classId>`），加减分/背书作业/出勤/调组/撤销全程可离线；仅「结束课堂」把整堂 `buildCommitPayload` 一次性 POST，后端单事务落库并 `buildRecap` 返回。幂等键 `client_session_id`（`class_sessions` 的 nullable UNIQUE 列，历史 seed 置 null）随重试不变，重复提交返回既有 sessionId。默认分组回写用**开课态**分组（缺席学生保留原组），不是课中调组后的终态。
- **鉴权**：无状态签名 cookie（`auth/session.ts`，HMAC/`AUTH_SECRET`，dev 有 fallback），`app.ts` 中间件 gate `/api/*`；写接口的 `teacherId`/`orgId` 取自当前登录老师。**疑似重复学生只提示不合并**（merge 已砍），靠删除解决。
- seed 自带 DDL（`ddl.ts`），`db:reset` 无需 drizzle-kit；生产迁移用 `pnpm db:generate`。
- 相对时间以 `server/src/util/time.ts` 的 `REFERENCE_TODAY=2026-07-01` 为基准（保证 demo 稳定）。
- 三年级A班刻意保留重复学生「浩浩」演示疑似重复 → 该班默认 13 人、全校 86（写操作会改变计数）。
- **端口 5173 也被邻近项目 tenderbuddy 占用**，清理进程时勿误杀。
- **学生端是小程序不是 H5**（PRD §7.5 的 H5 方案已被小程序取代）：家长凭据 = `recapToken` 存小程序本地（`nce.children`，支持多孩切换），无微信登录；邀请入口 = 手输邀请码（无 appid，游客模式），小程序码 scene 扫码与 openid 绑定等正式 appid 后再做。Taro h5 dev 必须关 prebundle（`compiler: { type:'webpack5', prebundle:{enable:false} }`，否则 webpack-virtual-modules 崩）。
- 遵循用户全局约定：pnpm 装依赖（`pnpm add`，勿手改 package.json）；勿用 try/catch 除非要求；改完代码不跑 formatter/linter。

## 待做（后续阶段）

- **学生端小程序 + 存储层已完成**（见 `kb/plans/2026-07-02-nce-class-student-miniapp.md`）：邀请码加入（含照片上传）+ 个性化 recap（本人卡/本人组高亮/历史下翻）+ 多孩切换，h5 端到端已验证；weapp 需在微信开发者工具里人工过一遍。
- 老师端学生成长档案 §7.4（下一个 plan：纯读派生，`GET /api/students/:id/profile` + 页面）。
- 有正式 appid 后：小程序码 scene 扫码邀请、wx.login/openid 绑定、服务器域名白名单、发布。
- 老师管理页（Teachers.tsx）仅占位；计时器超时正计已做；投屏实时多端同步 M1 不做。
