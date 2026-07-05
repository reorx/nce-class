import { Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useState } from 'react';
import { getTeacherSessions, type TeacherSessionBrief } from '../../../lib/api';
import { ensureLogin } from '../../../lib/wxAuth';
import './index.scss';

// 老师端上课记录：org 级全部课堂倒序一览（课后处理/recap 分享将来挂在行上）。
export default function TeacherSessions() {
  const [sessions, setSessions] = useState<TeacherSessionBrief[] | null>(null);

  useDidShow(() => {
    (async () => {
      try {
        const m = await ensureLogin();
        if (!m.teacher) {
          Taro.redirectTo({ url: '/pages/index/index' });
          return;
        }
        setSessions(await getTeacherSessions());
      } catch (e: any) {
        Taro.showToast({ title: e?.message ?? '加载失败', icon: 'none' });
      }
    })();
  });

  if (!sessions) {
    return (
      <View className="page">
        <View className="hint">加载中…</View>
      </View>
    );
  }

  return (
    <View className="page">
      {sessions.map((s) => (
        <View key={s.id} className="row">
          <View className="when">
            <View className="date">{s.date}</View>
            <View className="wd">{s.weekday}</View>
          </View>
          <View className="main">
            <View className="cls">{s.className}</View>
            <View className="lesson">
              {s.lessonNumber ? `第${s.lessonNumber}课` : '未填写课次'}
              {s.lessonTitle ? ` · ${s.lessonTitle}` : ''}
            </View>
          </View>
          <Text className={`hw${s.hasHomework ? ' on' : ''}`}>{s.hasHomework ? '已布置作业' : '未布置作业'}</Text>
        </View>
      ))}
      {sessions.length === 0 && <View className="hint">还没有上课记录，结束第一节课后这里会出现</View>}
    </View>
  );
}
