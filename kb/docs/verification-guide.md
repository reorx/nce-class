---
created: 2026-09-28
tags:
  - testing
  - e2e
  - agent-browser
  - miniapp
  - runbook
---

# 验证手册

写给改完代码要做端到端验证的人：接口冒烟、老师端 Web 的浏览器流程、小程序的 h5 与开发者工具验证各怎么做，有哪些已知的坑。

前置：`pnpm dev` 已启动（server :5177，web :5173），seed 老师 `wangli` / `demo1234`。

## 接口冒烟与数据库断言

```bash
# 登录拿 cookie jar，之后带 -b 访问
CJ=/tmp/nce_cookies.txt
curl -s -c $CJ -X POST http://localhost:5177/api/auth/login -H 'Content-Type: application/json' -d '{"username":"wangli","password":"demo1234"}' >/dev/null
curl -s -b $CJ http://localhost:5177/api/sessions/sess-c1-7/recap | python3 -m json.tool

# 数据库断言
sqlite3 -header -column server/data/app.db "SELECT id,org_id,name,teacher_id FROM classes WHERE id='c1';"
```

## 老师端 Web

用 `agent-browser`：`open` → `snapshot -i` 拿 `@e` 引用 → `fill` / `click`。先过登录墙；DOM 变了要重新 snapshot；用完 `close`。

**课堂全流程**：课前配置 → 开始课堂 → 各视图操作 → 结束课堂（确认式）→ 落地 session 详情页，然后用 sqlite3 断言 `class_sessions` 有新行。

清掉本地进行中的课堂：

```js
localStorage.removeItem('nce.classroom.c1')
```

### 坑：拖拽

分组页和课堂调组用的是 HTML5 拖拽，`agent-browser drag` 发的是鼠标手势，页面收不到。用 `eval` 手动派发事件，**分两次**，中间等 500ms 让 React 提交状态：

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

### 坑：弹窗表单

收款编辑等弹窗里，输入会触发重渲染并往 DOM 里插入提示条，`@e` 引用随之失效，接下来的点击可能落在遮罩上，把弹窗静默关掉。弹窗表单一律用 `eval`：

```js
(() => {
  const input = document.querySelector('<选择器>');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '120');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()
```

按钮同样用 `eval` 找到后 `.click()`。排班日历连续点多天时，每次点击之间 `wait 250`。

## 小程序 h5

h5 是 weapp 的可自动化替身。需要另起 `pnpm dev:miniapp`（:10086，代理到 server），视口设为 390×844。

h5 没有微信登录，身份由 storage 里的 mock 名决定。切角色 = 改 mock 名、删 token、reload。注意 Taro h5 的 storage 值带 `{"data":<值>}` 包装：

```js
localStorage.setItem('nce.mockUser', JSON.stringify({ data: 'dev-teacher' }));  // dev-teacher | dev-parent | dev-new
localStorage.removeItem('nce.wxToken'); localStorage.removeItem('nce.currentChild');
```

完整的三角色流程（生成邀请 → 注册 → 关联 → 看战报，含按钮定位的坑与断言 SQL）见 `kb/docs/miniapp-h5-three-role-e2e.md`。

## 微信开发者工具

h5 验证不了分享卡片、授权、选图和原生组件，改过这些要在开发者工具里人工过一遍。

1. `pnpm --filter miniapp dev:weapp` 启动 watch 编译。
2. 打开项目，导入的是 `miniapp/` 而不是 `dist/`：

   ```bash
   /Applications/wechatwebdevtools.app/Contents/MacOS/cli open --project <repo>/miniapp
   ```

   需要先在工具里扫码登录，并在设置里打开「服务端口」。
3. 模拟器里 mock 登录：在 Console 执行下面两行，然后点「编译」。

   ```js
   wx.setStorageSync('nce.mockUser', 'dev-teacher')
   wx.removeStorageSync('nce.wxToken')
   ```

真机预览与上传见 `kb/docs/deploy-and-ops.md`。

## 收尾

验证完运行 `mac-dev-cleanup` 释放 agent-browser 会话。截图归档到 `tmp/<日期>-<任务名>/`。
