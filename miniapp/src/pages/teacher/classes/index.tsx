import { Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useState } from 'react';
import { getTeacherClasses, type TeacherClass, type WxMe } from '../../../lib/api';
import { ensureLogin } from '../../../lib/wxAuth';
import './index.scss';

// 老师端班级列表：邀请队列数角标；点进班级详情生成邀请 / 处理队列。
export default function TeacherClasses() {
  const [me, setMe] = useState<WxMe | null>(null);
  const [classes, setClasses] = useState<TeacherClass[] | null>(null);

  useDidShow(() => {
    (async () => {
      try {
        const m = await ensureLogin();
        if (!m.teacher) {
          Taro.redirectTo({ url: '/pages/index/index' });
          return;
        }
        setMe(m);
        setClasses(await getTeacherClasses());
      } catch (e: any) {
        Taro.showToast({ title: e?.message ?? '加载失败', icon: 'none' });
      }
    })();
  });

  if (!me || !classes) {
    return (
      <View className="page">
        <View className="hint">加载中…</View>
      </View>
    );
  }

  return (
    <View className="page">
      <View className="head">
        <View className="org">{me.teacher!.orgName}</View>
        <View className="who">{me.teacher!.name} 老师</View>
      </View>
      {classes.map((c) => (
        <View
          key={c.id}
          className="card"
          onClick={() =>
            Taro.navigateTo({ url: `/pages/teacher/class/index?id=${c.id}&name=${encodeURIComponent(c.name)}` })
          }
        >
          <View className="main">
            <View className="name">{c.name}</View>
            <View className="sub">{c.studentCount} 名学生</View>
          </View>
          {c.pendingCount > 0 && <Text className="badge">{c.pendingCount} 条申请</Text>}
          <Text className="arrow">›</Text>
        </View>
      ))}
      {classes.length === 0 && <View className="hint">还没有班级，请先在管理后台建班</View>}
    </View>
  );
}
