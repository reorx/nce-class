import { Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useState } from 'react';
import { getTeacherClasses, type WxMe } from '../../../lib/api';
import { ensureLogin } from '../../../lib/wxAuth';
import './index.scss';

// 老师端首页：导航中枢，各功能页从这里进。班级管理卡带全校待处理申请角标。
export default function TeacherHome() {
  const [me, setMe] = useState<WxMe | null>(null);
  const [pendingTotal, setPendingTotal] = useState(0);

  useDidShow(() => {
    (async () => {
      try {
        const m = await ensureLogin();
        if (!m.teacher) {
          Taro.redirectTo({ url: '/pages/index/index' });
          return;
        }
        setMe(m);
        const classes = await getTeacherClasses();
        setPendingTotal(classes.reduce((n, c) => n + c.pendingCount, 0));
      } catch (e: any) {
        Taro.showToast({ title: e?.message ?? '加载失败', icon: 'none' });
      }
    })();
  });

  if (!me) {
    return (
      <View className="page">
        <View className="hint">加载中…</View>
      </View>
    );
  }

  const nav = [
    {
      icon: '🏫',
      name: '班级管理',
      sub: '生成邀请 · 处理加入申请',
      badge: pendingTotal > 0 ? `${pendingTotal} 条申请` : null,
      url: '/pages/teacher/classes/index',
    },
    {
      icon: '📖',
      name: '上课记录',
      sub: '最近课堂与作业布置情况',
      badge: null,
      url: '/pages/teacher/sessions/index',
    },
  ];

  return (
    <View className="page">
      <View className="head">
        <View className="org">{me.teacher!.orgName}</View>
        <View className="who">{me.teacher!.name} 老师</View>
      </View>
      {nav.map((item) => (
        <View key={item.url} className="nav-card" onClick={() => Taro.navigateTo({ url: item.url })}>
          <View className="icon">{item.icon}</View>
          <View className="main">
            <View className="name">{item.name}</View>
            <View className="sub">{item.sub}</View>
          </View>
          {item.badge && <Text className="badge">{item.badge}</Text>}
          <Text className="arrow">›</Text>
        </View>
      ))}
    </View>
  );
}
