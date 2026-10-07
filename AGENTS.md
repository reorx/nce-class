# AGENTS.md

新概念英语课堂教学辅助系统，M1 已上线（service.domain）：老师端 Web + 学生端微信小程序 + 邀请与账户体系 + 排班收费。需求与各专题设计见 `kb/plans/`（PRD = `2026-06-30-nce-class-m1-prd.md`，做某块前先读对应 plan）。设计稿 `nce-class-v1-design/`（gitignored）。

## 结构

pnpm workspace。约定：`lib/` 下均为纯派生逻辑并配同名 `.test.ts`，UI 里的可测逻辑先抽 lib。

```
server/  Express + TS · Drizzle ORM + SQLite (better-sqlite3)
  src/app.ts    createApp() 含全部路由；server.ts 仅 listen
  src/db/       schema / ddl / seed / provision（幂等迁移 + 账号操作）/ mutations.ts（全部写操作，事务封装）/ 账号 CLI 入口
  src/auth/     老师签名 cookie + 小程序 wx Bearer token（WX_MOCK=1 时 code 用 `mock:<name>`）
  src/lib/      billing.ts 计费纯函数
  src/storage/  StorageClient：local（默认）/ minio / oss，S3_VENDOR 切换；库里存 key，读侧 getUrl 解析
  tests/        vitest + supertest 集成测试（helpers.ts 的 setupTestApp 用临时库，返回绑 127.0.0.1 的 server；勿直接 request(createApp())，见 listenLocal 注释）
web/     React + Vite + TS · 老师端桌面 Web（管理页 IBM Plex；课堂系 Nunito/Baloo 2）
  src/App.tsx   路由表
  src/pages/    一页一文件；Classroom = 课堂主界面（看板/背书/作业/出勤/调组/班级信息/日志 七视图）
  src/api/      按领域拆分的 fetch 函数 + DTO（client.ts 管 cookie/JSON/错误分类），不依赖 React
  src/queries/  TanStack Query：keys / 各领域 useXxxQuery·useXxxMutation / cache-effects（写后回写与失效规则）/ 会话代次
  src/lib/      classroomStore（课堂本地态 + 持久化 + commit payload）/ classroomBoot（进入判定）/ session（事件流计分派生）/ queryView（读取状态口径）/ 其余按页面命名
  src/test-utils/ 假 fetch、DTO fixtures、renderApp（整个 App 驱动页面级测试）、写后矩阵的全量缓存
miniapp/ Taro 4 + React（weapp 正式产物 / h5 开发调试）
  src/pages/    index（按身份分流）/ join / recap / bind / teacher/*
  src/lib/      api（Bearer 注入）/ wxAuth（登录 + mock 身份）
```

全局弹窗走 Provider：`useStudentModal()`（编辑学生姓名）、Toast，任意页面可触发。

## 页面与 API

路由以 `web/src/App.tsx` 为准，这里只列 query 参数：

- `/classes?is_archived=true` 已归档班级
- `/classes/:id?tab=students|groups|notes|homework|invite|schedule|sessions`
- `/classes/:id/sessions/:sid?tab=overview|homework|recap|info`
- `/classes/:id/setup?backfill=1` 补录过去的课
- `/classes/:id/classroom`：`?edit_id=<sid>` 编辑上课记录；`?lesson=4&title=...&duration=120` 直接开新课；都不带且本地无进行中课堂则跳 setup

API 全在 `server/src/app.ts`，字段校验以代码为准。除 `/api/health`、`/api/auth/login`、`/api/wx/login` 外均过认证中间件；写接口的 teacherId/orgId 取自当前登录者，跨组织一律 404。

- 老师（cookie）：auth、teachers、classes（含 students / groups / notes / homework-template，后三者整套 replace）、sessions（commit、详情、更正、recap）、attendance、tags、schedules、billing/batches、invoices
- 管理员 `/api/admin/*`：`teacher.is_admin` 每请求重读，非管理员 403；删除班级、改密需在 body 带 `adminPassword` 复核
- 小程序 `/api/wx/*`（Bearer）：老师侧需已绑 teacher 否则 403；家长侧读学生数据有 binding 守卫

## 开发与测试

```bash
pnpm install     # better-sqlite3 13 走 N-API 自带预编译，换 node 版本无需重编
pnpm db:reset    # 重建 seed 数据 → server/data/app.db（dev server 在跑要重启，旧句柄指向被删 inode）
pnpm dev         # server :5177 + web :5173（vite 代理 /api、/uploads）
pnpm dev:miniapp # miniapp h5 watch :10086（需 server 在跑）

pnpm --filter server test              # 自带临时库，无需起服务；web / miniapp 同理
pnpm --filter server exec tsc --noEmit # 类型检查；web / miniapp 同理
```

- seed 老师 `wangli` / `demo1234`（全体同密码）。server dev 脚本自带 `WX_MOCK=1`。
- ⚠️ 端口 5173/5177 常被邻近项目 tenderbuddy 占用。清理前先 `lsof -nP -iTCP:5177 -sTCP:LISTEN` 确认进程 cwd，勿误杀。web 可换端口：`pnpm --filter web exec vite --port 5180`。
- 新增写接口**先加测试用例再实现**。
- 改完除了跑测试和 tsc，用 `agent-browser` 走一遍真实流程。⚠️ 两个坑：HTML5 拖拽用 `agent-browser drag` 无效；弹窗表单里 `@e` 引用会失效。两者都要用 `eval`，写法照抄 `kb/docs/verification-guide.md`。

## 部署

push master → GitHub Actions 构建镜像 → hookploy 部署，迁移随服务启动自动执行。只改 `kb/**`、`miniapp/**`、`.md` 不触发部署。小程序不走 CI，本地用 node 24 上传。

账号开通、重置密码、管理员授予都只能用 CLI（`create-teacher` / `reset-password` / `set-admin`）。命令、生产环境用法和注意事项见 `kb/docs/deploy-and-ops.md`，动部署配置或操作生产账号前先读。

## 文档

- `kb/docs/classroom-session-lifecycle.md` — 课堂数据从开课到落库的流转：进入判定、结束课堂、补录、编辑上课记录、兼容纪律的由来。改 Classroom、classroomStore、commit 接口前读。
- `kb/docs/web-data-layer.md` — Web 读取缓存时效、页面加载/错误/后台刷新的展示口径、写后刷新规则、草稿与最新读取、身份切换、课堂本地优先在数据层的例外。改 Web 页面的数据读取或写入、加新接口前读。
- `kb/docs/business-rules.md` — 学生姓名与状态、班级归档、账户邀请、出勤作业、教材、管理员、排班收费的业务口径。改这些功能前读对应小节。
- `kb/docs/verification-guide.md` — curl 冒烟、agent-browser 流程与坑、小程序 h5 切角色、微信开发者工具。做端到端验证时读。
- `kb/docs/miniapp-h5-three-role-e2e.md` — 小程序 h5 三角色流程（生成邀请 → 注册 → 关联 → recap）。改邀请、账户、小程序后跑回归时读。
- `kb/docs/deploy-and-ops.md` — 发版流水线、环境变量、账号 CLI、小程序上传。
- `kb/docs/miniapp-status-and-roadmap.md` — 小程序功能范围、上线链路核对表、体验版验收步骤、下一版规划。问小程序进度或做小程序发布前读。

## 须知 / 约定

- **⚠️ 结束课堂 schema 向后兼容，不可破坏**：课堂进行中服务端可能发新版，旧页面的 commit payload 必须照常入库。①服务端永不新增必填字段，新字段一律可选带默认；②不收紧校验、不改名、不改语义；③未知字段静默忽略（`buildCommitInput` 显式挑字段）。localStorage 里的 `ClassroomSession` 同理只加可选字段。守卫用例在 `server/tests/api.test.ts`「向后/向前兼容」，挂了改实现不改测试。
- **Web 请求层**：组件只用 `queries/<domain>` 的 hooks、类型从 `api/<domain>` `import type`，不直接调 API、不手拼 queryKey、不把响应复制进 state 再手动 reload；写后缓存规则只写在 `queries/cache-effects.ts`。读取状态用 `components/QueryState`（有数据就展示，不拿 isFetching 当白屏条件）；编辑表单在开始编辑时建草稿，后台刷新不覆盖。缓存时效、写后规则、身份与课堂例外见 `kb/docs/web-data-layer.md`。
- **课堂本地优先**：整节课跑在浏览器 localStorage（`nce.classroom.<classId>`），仅「结束课堂」一次性 POST，后端单事务落库，`client_session_id` 幂等。补录与编辑上课记录复用同一套；编辑走 `PUT /sessions/:id/commit` 原地覆盖，不回写默认分组、不改作业、保留已有考勤更正。
- **计分是事件流**：个人分、组分由 `score_events`(±1) 派生，不落地存储。组分 = 当前到堂组员个人分之和 + 小组独立分，调组随人走；`score_events.session_group_id` 只是加分时所在组的历史，不参与组分（2026-10 口径变更，勿改回）。
- **鉴权双轨**：老师 cookie 与小程序 Bearer token 互不通用。
- **新增挂靠班级的表要同步 `mutations.deleteClass`**。`api.test.ts` 的 admin 用例会扫描全部表做残留断言。
- **学生姓名**：`students.name` 存的是英文名（主显示名），`cn_name` 是中文名（可空）。`PUT /api/students/:id` 缺 `cnName` key 时不动该列，传空串才清空，勿改成按值判断。
- **学生状态** active / suspended / archived：非 active 不进课前配置、课堂与 session 快照。与班级归档无关。
- **班级归档**：首页列表分流，禁止新建课程周期和收款项；历史排班与收款记录可继续维护，其他功能不联动。详见业务口径。
- **出勤**：commit payload 只有 present / absent，`leave` 只由考勤更正产生。读侧一律用 `!== 'present'` 判定未到堂。
- **教材 key 是字符串**（`'1'`-`'4'`、`starterA`、`starterB`）。前端下拉值一律过 `parseBook`，勿 `Number()`。课数表在 `server/src/app.ts` 与 `web/src/lib/homework.ts` 两处镜像，要同步改。
- **计费**：应收 = 单价 × 课程次数 + 附加费，全班一致、不按到堂扣减，例外由老师改最终金额（2026-10 口径变更，勿改回）。`billing.ts` 的 `today` 是显式参数，生产传真实当天，**不要用 `REFERENCE_TODAY`**。金额在库里和 API 里一律整数分，字段名带 `Cents`。
- **数据库**：seed 自带 DDL，`db:reset` 无需 drizzle-kit；生产迁移靠 `provision.migrate()` 幂等执行。列声明类型须与存值一致，不借 SQLite 类型亲和性混存；换列类型写真迁移，参考 `provision.ts` 的 `convertColumnToText`。
- **seed**：相对时间基准 `REFERENCE_TODAY=2026-07-01`（只服务展示层，保 demo 稳定）。三年级A班刻意留重复学生「浩浩」。
- **miniapp** 的 browserslist 锁在 chrome60 / ios10，微信 CI 不认 ES2020 语法，勿改。
- **commit message**：首行只写一句简短总结，空行后用 `-` 列表写详情（改了什么 / 口径与根因 / 测试与验证结果）。
- pnpm 装依赖用 `pnpm add`，勿手改 package.json；勿用 try/catch 除非要求；改完代码不跑 formatter / linter。

## 待办与已知问题

- `kb/todo.md` — 待做事项。问「接下来做什么」时读。
- `kb/known-issues.md` — 当前已知的缺陷与简化实现。动相关功能前先查，发现新问题记进去，解决了就删。
- `kb/next-up.md` — 要等某个时间点或条件（如部署后）才能做的核对。进 kb 工作时看有没有到期项。
- M1 不做：投屏实时多端同步、已 dismissed/linked 队列历史界面、wx.getPhoneNumber（需企业认证，手机号手填）。
