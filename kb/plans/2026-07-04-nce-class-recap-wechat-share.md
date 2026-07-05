---
created: 2026-07-04
tags:
  - plan
  - nce-class
  - miniapp
  - recap
  - wechat
  - share
---

# NCE Class · 课堂战报分享到微信群 Plan（session 级分享卡片 + 落地分流）

> 现状（2026-07-04 排查）：小程序 `pages/recap` 没有 `useShareAppMessage`；web 端 RecapPanel（session 详情页 Recap tab，原 RecapPreview 已并入）的「推送全班」是 placeholder toast。结构性缺口在**权限模型**——现有 recap 接口是 binding 守卫的（`GET /api/wx/students/:id/sessions/:sid`，URL 带 studentId），即使给页面加上转发，卡片 path 带的是分享者自家孩子的 studentId，群里其他家长点开直接 404。
>
> 本 plan 引入「**按 session 分享**」语义：卡片只带 sid，落地后按当前微信账户身份分流。真机群转发的验证依赖 [[../notes/2026-07-04-miniapp-invite-launch-gaps]] 打通（正式 appid + 生产 BASE）；本 plan 的开发与 h5 验证不被其阻塞。

## 已定需求（用户给定）

1. 在小程序内把课堂 recap 分享到微信群，群里各家长点开能看到课堂战报。
2. **课后处理**（2026-07-04 追加，随作业机制落地）：老师端小程序增加「课后处理」菜单——点近期已上完的课，把 **Recap + 作业** 的小程序链接分享到学生群。作业数据已就位（`class_sessions.homework_content/review_book/review_lesson` + `classes.homework_template/textbook`，web 端 session 详情页 `/classes/:id/sessions/:sid` 布置，见 AGENTS.md「作业布置」）；本 plan 实现时：
   - 老师端「上课记录」页即「课后处理」入口（**2026-07-05 已落地**：老师端首页改为导航中枢 `pages/teacher/home`，新增 `pages/teacher/sessions` 上课记录页 + org 级 `GET /api/wx/teacher/sessions`，brief 已含 `hasHomework`/`className`；行目前不可点，本 plan 实现时挂上跳 recap）。
   - `GET /api/wx/sessions/:sid/recap` 的 envelope 附 `homework: {content, reviewBook, reviewLesson} | null`（guest 是否可见作业内容：作业不含学生个人信息，倾向三态都返回，实现时再拍板）。
   - recap 页（RecapView 下方）渲染作业内容 section；个性化端点 `GET /api/wx/students/:id/sessions/:sid` 同样附 homework 字段。

## 展开设计（我拍板的部分，可推翻）

- **分享粒度是 session 不是 student**：卡片 path 为 `pages/recap/index?sid=<sessionId>`，**不带 studentId**。谁点开就以谁的微信身份解析视角。
- **落地分流三态**（服务端判定，不信任前端）：
  - `teacher`：该校老师（wx 账户已绑 teacher 且 org 匹配）→ 全班版 recap（`mine: null`，复用现有 `ParentRecap` shape，RecapView 直接渲染）。
  - `parent`：账户在该班有任一 binding → 返回该班内绑定的孩子列表，前端选定孩子后**复用现有个性化端点** `GET /api/wx/students/:id/sessions/:sid` 拉数据（多孩同班出 chips，默认 `nce.currentChild` 命中者或第一个）。
  - `guest`：其余任何 wx 会话 → **不给 recap 数据**（全班版含 🌟/⚠️ 学生姓名，不对未关联账户暴露），只返回班级预览（名称/级别/老师/人数，与邀请预览同口径）+「你还没有关联孩子，请联系老师获取邀请」引导——分享卡片顺便成为拉新入口，与邀请流程闭环。跨组织老师也按 guest 处理。
- **分享入口两处**：
  - **老师端**（主推）：teacher/class 页新增「上课记录」区块（最近 N 节）→ 点进 recap 页（老师视角全班版）→ 页内「分享到微信群」按钮（`open-type="share"`）。老师端小程序目前没有任何 recap 入口，这一层是新增的。
  - **家长端**（顺手）：现有 recap 页同样挂 `useShareAppMessage`，转发 path 一样只带 sid——家长转发出去别人看到的也是各自视角，不泄露分享者孩子的数据。
- **recap 页参数兼容**：`?sid=&student=` 现有入口行为不变（index 首页跳转仍带 student）；仅 `?sid=` 时走新分流。h5 端无真分享，按钮 fallback 复制落地 URL（与 teacher/class 页 copyLink 同法）。
- **web 端 RecapPanel「推送全班」**（`components/RecapPanel.tsx`，挂在 `pages/SessionDetail.tsx` 的 Recap tab）：本 plan 不做服务端推送（模板消息/订阅消息需另立项），把 placeholder 文案改成「请在小程序课后处理里转发到班级群」的引导即可。
- **无 schema 变更**：不加表不加列；session 均为 ended（只有 commit 才落库），无进行中态需要处理。

## API（挂 `/api/wx/*`，wx Bearer gate）

- `GET /api/wx/sessions/:sid/recap` — **分享落地分流端点**：
  - sid 不存在 → 404。
  - 返回统一 envelope：`{ access: 'teacher'|'parent'|'guest', class: {id, name, level, teacherName, orgName, studentCount}, session: {date, weekday, lessonNumber, lessonTitle} }`
  - `access='teacher'` 时附 `recap: ParentRecap`（buildRecap，`mine: null`）。
  - `access='parent'` 时附 `children: [{studentId, name, photoUrl}]`（仅该班内绑定的孩子）；recap 数据由前端拿 studentId 走现有个性化端点，**不在此端点重复派生**。
  - `access='guest'` 时无 recap/children 字段。
- ~~`GET /api/wx/teacher/classes/:id/sessions`~~ → **已由 org 级 `GET /api/wx/teacher/sessions` 取代并落地**（2026-07-05 随老师端导航中枢实现：sessionSummary + classId/className/hasHomework，倒序；守卫同现有 teacher 侧端点）。本 plan 直接复用，不再做 per-class 端点。

## 小程序改动

```
pages/recap          参数分流：有 student → 现行为不变；仅 sid → 调 /api/wx/sessions/:sid/recap
                     teacher → RecapView 全班版；parent → 单孩直显/多孩 chips（选中后走现有个性化端点）；
                     guest → 班级预览卡 + 引导文案
                     + useShareAppMessage：title「{className} {M月d日} 课堂战报」，path 只带 sid
                     + 页内分享按钮（open-type="share"；h5 fallback 复制 /#/pages/recap/index?sid= 链接）
pages/teacher/sessions  行挂点击 → 跳 pages/recap?sid=（页面与端点已随 2026-07-05 导航中枢落地，行目前不可点）
lib/api.ts           + getSessionRecapShared(sid) / getTeacherClassSessions(classId) 及类型
lib/recapView.ts 或新纯函数模块   分流决策纯函数（envelope → 渲染模式 + 默认孩子挑选，含 nce.currentChild 回退），可单测
```

## 测试计划（BDD 先行，supertest + WX_MOCK）

1. **分流端点 · teacher**：dev-teacher（绑 wangli）访问本校 session → `access=teacher` + recap 全量 + `mine=null`；跨组织老师 → `access=guest` 无 recap 字段。
2. **分流端点 · parent**：dev-parent（绑 s-c1-1）访问 c1 的 session → `access=parent` + children 只含该班绑定的孩子；同账户多孩同班 → children 多条；绑的是别班孩子 → `access=guest`。
3. **分流端点 · guest**：dev-new → `access=guest`，有 class 预览、无 recap/children；未登录 401；sid 不存在 404。
4. **泄露回归**：guest 响应体断言不含任何学生姓名字段（stars/warned/groups）。
5. **老师 sessions 列表**：本校班级返回倒序 brief；他组织班级 404；未绑 teacher 403。
6. **miniapp 纯函数单测**：envelope 分流决策、多孩默认挑选（currentChild 命中/失效回退第一个）。
7. **h5 端到端（agent-browser 三角色）**：sqlite3 拿一个 c1 的 sid → dev-teacher 开 `/#/pages/recap/index?sid=` 看全班版并见分享按钮；切 dev-parent 同 URL 看到小明个性化视图（本组高亮）；切 dev-new 同 URL 看到班级预览+引导。teacher/class 页断言「上课记录」区块可点入。
8. **weapp 人工项**（记入验证清单，依赖开发者工具）：recap 页转发卡片 path 正确；老师从上课记录进入后转发；模拟器内以另一 mock 身份打开该 path 验证分流。

## 任务拆解（可独立验证顺序）

1. **server**：两个新端点（先写用例再实现；分流判定抽 `resolveSessionAccess(account, session)` 纯函数入 mutations/queries 侧）。
2. **miniapp lib**：api 类型与函数 + 分流纯函数 + 单测。
3. **recap 页改造**：参数分流 + 三态渲染 + useShareAppMessage + 分享按钮（h5 复制 fallback）。
4. **teacher/class 上课记录入口**：区块 + 跳转。
5. **web RecapPanel**：「推送全班」按钮改引导文案（一行改动，`components/RecapPanel.tsx`）。
6. **端到端**：h5 三角色跑通 + weapp 人工验证项记录。

## 相关文档

- [[../notes/2026-07-04-miniapp-invite-launch-gaps]] — 上线链路缺失项（真机群转发验证的前置）
- [[2026-07-02-nce-class-wechat-account-invite]] — wx 会话/binding/邀请体系（本 plan 的权限基座）
- [[2026-07-02-nce-class-classroom-backend]] — buildRecap 与 session 快照（全班版数据来源）
