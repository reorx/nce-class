---
created: 2026-07-06
tags:
  - miniapp
  - e2e
  - agent-browser
  - testing
---

# 小程序 h5 三角色端到端验证流程

用 agent-browser 在 h5 端跑通「老师生成邀请 → 新家长注册 → 老师关联 → 家长看 recap」全流程。h5 是 weapp 的可自动化开发替身，此流程已验证可照抄；涉及分享卡片/chooseImage/原生组件的改动仍需微信开发者工具人工过（见 AGENTS.md「验证套路」）。

## 前置

```bash
pnpm dev:server        # 自带 WX_MOCK=1
pnpm dev:miniapp       # h5 watch :10086，代理 /api → :5177
agent-browser --session nce set viewport 390 844   # 手机视口
```

seed 三个 mock 微信账户：

| mock 名 | 身份 |
|---|---|
| `dev-teacher` | 已绑老师 wangli |
| `dev-parent` | 已绑学生 s-c1-1 小明 |
| `dev-new` | 全新账户（默认身份） |

## 切角色

h5 没有 wx.login，身份由 storage 里的 mock 名决定。**切角色 = eval 改 `nce.mockUser` + 删 token 再 reload**（Taro h5 storage 值有 `{"data":<值>}` 包装）：

```bash
agent-browser --session nce eval --stdin <<'EOF'
(() => {
  localStorage.setItem('nce.mockUser', JSON.stringify({ data: 'dev-teacher' }));  // dev-teacher|dev-parent|dev-new
  localStorage.removeItem('nce.wxToken'); localStorage.removeItem('nce.currentChild');
  return 'ok';
})()
EOF
# 然后 reload / 重新 open
```

## 流程步骤

1. **老师生成邀请**：切 `dev-teacher` 打开 `http://localhost:10086/` → 自动跳老师端 → 班级管理 → 进三年级A班 → 点「生成邀请」。
   ⚠️ **「生成邀请」按钮别用 `find text`**——会命中页面提示文案。用 eval 找 `taro-button-core` 按 textContent click：

   ```js
   [...document.querySelectorAll('taro-button-core')]
     .find(b => b.textContent.includes('生成邀请'))?.click()
   ```

2. **拿邀请 token**（UI 上是分享入口，直接查库最快）：

   ```bash
   sqlite3 server/data/app.db "SELECT token FROM class_invites ORDER BY rowid DESC LIMIT 1;"
   ```

3. **新家长注册**：切 `dev-new` 打开 `http://localhost:10086/#/pages/join/index?invite=<token>` → 班级预览 → 填中文名/英文名/手机号（11 位）→ 确认加入 → 回 index 变为等待页（pending）。
   照片上传（chooseImage）浏览器里难自动化，用 curl 冒烟代替：

   ```bash
   TOKEN=$(curl -s -X POST http://localhost:5177/api/wx/login -H 'Content-Type: application/json' -d '{"code":"mock:dev-new"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
   curl -F 'photo=@x.png' -H "Authorization: Bearer $TOKEN" http://localhost:5177/api/wx/upload/photo
   ```

4. **老师关联**：切回 `dev-teacher` 刷新班级页 → 待处理队列点「关联到学生」→ 选学生 → Taro showModal 确认弹窗用 `find text "确定"` + click。

5. **家长验收**：切 `dev-new` 刷新 → 应直接进 recap 首页，本人所在组高亮。

## 断言

```bash
sqlite3 -header -column server/data/app.db \
  "SELECT status, linked_student_id FROM join_requests ORDER BY rowid DESC LIMIT 3;
   SELECT student_id, wechat_account_id FROM student_wechat_bindings;"
```

预期：join_request `status=linked` 且 `linked_student_id` 指向所选学生；bindings 新增一行。关联时服务端会回填 student 的空字段（photo/en_name/parent_phone），不覆盖已有值。
