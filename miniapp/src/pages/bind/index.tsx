import { Button, Input, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import { bindTeacher } from '../../lib/api';
import { ensureLogin } from '../../lib/wxAuth';
import './index.scss';

// 老师一次性绑定：输 web 端用户名+密码，绑定后微信登录即老师身份。
export default function Bind() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!username.trim() || !password) {
      return Taro.showToast({ title: '请填写用户名和密码', icon: 'none' });
    }
    setBusy(true);
    try {
      await ensureLogin();
      await bindTeacher(username.trim(), password);
      await Taro.showToast({ title: '绑定成功', icon: 'success' });
      Taro.reLaunch({ url: '/pages/index/index' });
    } catch (e: any) {
      Taro.showToast({ title: e?.message ?? '绑定失败', icon: 'none' });
      setBusy(false);
    }
  }

  return (
    <View className="page">
      <View className="hero">
        <View className="big">🔗</View>
        <View className="l2">绑定老师账号</View>
        <View className="l3">输入 NCE 课堂管理后台的用户名和密码，只需绑定一次</View>
      </View>
      <View className="field">
        <View className="fl">用户名</View>
        <Input
          className="field-input"
          placeholder="管理后台用户名"
          value={username}
          onInput={(e) => setUsername(e.detail.value)}
        />
      </View>
      <View className="field">
        <View className="fl">密码</View>
        <Input
          className="field-input"
          password
          placeholder="管理后台密码"
          value={password}
          onInput={(e) => setPassword(e.detail.value)}
        />
      </View>
      <Button className="cta" loading={busy} onClick={submit}>
        绑定
      </Button>
    </View>
  );
}
