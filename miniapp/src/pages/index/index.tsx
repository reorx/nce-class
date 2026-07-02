import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useState } from 'react';
import RecapView from '../../components/RecapView';
import { getStudentHome, getStudentRecap, type ParentRecap, type StudentHome, type WxMe } from '../../lib/api';
import { pickChild, routeForMe } from '../../lib/flow';
import { ensureLogin, loadCurrentChildId, saveCurrentChildId } from '../../lib/wxAuth';
import './index.scss';

// 登录引导 + 分流：teacher → 老师端班级页；有孩子 → recap 首页（多孩 chips）；
// 有 pending 申请 → 等待确认页；否则欢迎页（通过群邀请卡片进入）。
export default function Index() {
  const [me, setMe] = useState<WxMe | null>(null);
  const [home, setHome] = useState<StudentHome | null>(null);
  const [recap, setRecap] = useState<ParentRecap | null>(null);
  const [childId, setChildId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadChild(m: WxMe, id: string | null) {
    const child = pickChild(m.children, id);
    if (!child) return;
    setChildId(child.studentId);
    saveCurrentChildId(child.studentId);
    const h = await getStudentHome(child.studentId);
    setHome(h);
    setRecap(h.latestSessionId ? await getStudentRecap(child.studentId, h.latestSessionId) : null);
  }

  async function refresh() {
    setLoading(true);
    try {
      const m = await ensureLogin();
      setMe(m);
      if (routeForMe(m) === 'teacher') {
        Taro.redirectTo({ url: '/pages/teacher/classes/index' });
        return;
      }
      await loadChild(m, loadCurrentChildId());
    } catch (e: any) {
      Taro.showToast({ title: e?.message ?? '加载失败', icon: 'none' });
    }
    setLoading(false);
  }

  // join / bind 页回来时重新进入，拉最新 me
  useDidShow(() => {
    refresh();
  });

  async function switchChild(id: string) {
    if (!me || id === childId) return;
    setLoading(true);
    try {
      await loadChild(me, id);
    } catch (e: any) {
      Taro.showToast({ title: e?.message ?? '加载失败', icon: 'none' });
    }
    setLoading(false);
  }

  if (!me) {
    return (
      <View className="page">
        <View className="hint">加载中…</View>
      </View>
    );
  }

  const route = routeForMe(me);

  if (route === 'welcome') {
    return (
      <View className="page empty">
        <View className="hero">
          <View className="big">👋</View>
          <View className="l2">欢迎来到 NCE 课堂</View>
          <View className="l3">请通过老师分享到班级群的邀请卡片加入班级，加入后这里会展示孩子每节课的课堂回顾</View>
        </View>
        <View className="teacher-entry" onClick={() => Taro.navigateTo({ url: '/pages/bind/index' })}>
          我是老师，绑定账号 ›
        </View>
      </View>
    );
  }

  if (route === 'pending') {
    const p = me.pending[0];
    return (
      <View className="page empty">
        <View className="hero">
          <View className="big">⏳</View>
          <View className="l2">已提交，等待老师确认</View>
          <View className="l3">
            {p.cnName} 加入「{p.className}」的申请已提交，老师确认后即可查看课堂回顾
          </View>
        </View>
        <Button className="cta" loading={loading} onClick={refresh}>
          刷新
        </Button>
      </View>
    );
  }

  return (
    <View className="page">
      <View className="childbar">
        {me.children.map((c) => (
          <Text
            key={c.studentId}
            className={`chip${c.studentId === childId ? ' on' : ''}`}
            onClick={() => switchChild(c.studentId)}
          >
            {c.name}
          </Text>
        ))}
      </View>

      {loading && <View className="hint">加载中…</View>}

      {!loading && home && recap && (
        <RecapView recap={recap} childName={home.student.name} className={home.class.name} />
      )}

      {!loading && home && !recap && <View className="hint">还没有课堂回顾，上完第一节课再来看看吧</View>}

      {!loading && home && home.sessions.length > 1 && (
        <View className="history">
          <View className="h">历史课堂</View>
          {home.sessions.slice(1).map((s) => (
            <View
              key={s.id}
              className="hrow"
              onClick={() => Taro.navigateTo({ url: `/pages/recap/index?sid=${s.id}&student=${childId}` })}
            >
              <Text className="date">
                {s.date} {s.weekday}
              </Text>
              <Text className="title">
                {s.lessonNumber ? `第${s.lessonNumber}课` : ''}
                {s.lessonTitle ? ` ${s.lessonTitle}` : ''}
              </Text>
              <Text className="arrow">›</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
