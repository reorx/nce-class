import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useState } from 'react';
import RecapView from '../../components/RecapView';
import { getMe, getRecap, type MePayload, type ParentRecap } from '../../lib/api';
import { currentChild, setCurrent, type ChildrenState } from '../../lib/children';
import { loadChildren, saveChildren } from '../../lib/childrenStore';
import './index.scss';

export default function Index() {
  const [st, setSt] = useState<ChildrenState>({ children: [], currentToken: null });
  const [me, setMe] = useState<MePayload | null>(null);
  const [recap, setRecap] = useState<ParentRecap | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh(state: ChildrenState) {
    setSt(state);
    const child = currentChild(state);
    if (!child) {
      setMe(null);
      setRecap(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const m = await getMe(child.token);
      setMe(m);
      setRecap(m.latestSessionId ? await getRecap(child.token, m.latestSessionId) : null);
    } catch (e: any) {
      Taro.showToast({ title: e?.message ?? '加载失败', icon: 'none' });
    }
    setLoading(false);
  }

  // 从 join 页回来时会重新进入，读最新的孩子列表
  useDidShow(() => {
    refresh(loadChildren());
  });

  function switchChild(token: string) {
    const next = setCurrent(st, token);
    saveChildren(next);
    refresh(next);
  }

  const child = currentChild(st);

  if (!loading && !child) {
    return (
      <View className="page empty">
        <View className="hero">
          <View className="big">👋</View>
          <View className="l2">欢迎来到 NCE 课堂</View>
          <View className="l3">加入班级后，这里会展示孩子每节课的课堂回顾</View>
        </View>
        <Button className="cta" onClick={() => Taro.navigateTo({ url: '/pages/join/index' })}>
          输入邀请码加入班级
        </Button>
      </View>
    );
  }

  return (
    <View className="page">
      <View className="childbar">
        {st.children.map((c) => (
          <Text
            key={c.token}
            className={`chip${c.token === st.currentToken ? ' on' : ''}`}
            onClick={() => switchChild(c.token)}
          >
            {c.name}
          </Text>
        ))}
        <Text className="chip add" onClick={() => Taro.navigateTo({ url: '/pages/join/index' })}>
          ＋
        </Text>
      </View>

      {loading && <View className="hint">加载中…</View>}

      {!loading && me && recap && child && <RecapView recap={recap} childName={child.name} className={me.class.name} />}

      {!loading && me && !recap && <View className="hint">还没有课堂回顾，上完第一节课再来看看吧</View>}

      {!loading && me && me.sessions.length > 1 && (
        <View className="history">
          <View className="h">历史课堂</View>
          {me.sessions.slice(1).map((s) => (
            <View
              key={s.id}
              className="hrow"
              onClick={() => Taro.navigateTo({ url: `/pages/recap/index?sid=${s.id}` })}
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
