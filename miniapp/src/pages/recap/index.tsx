import { View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import RecapView from '../../components/RecapView';
import { getMe, getRecap, type MePayload, type ParentRecap } from '../../lib/api';
import { currentChild, type Child } from '../../lib/children';
import { loadChildren } from '../../lib/childrenStore';
import './index.scss';

// 单堂历史 recap：?sid=<sessionId>，凭当前孩子的 token 拉取。
export default function Recap() {
  const router = useRouter();
  const [child, setChild] = useState<Child | null>(null);
  const [me, setMe] = useState<MePayload | null>(null);
  const [recap, setRecap] = useState<ParentRecap | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sid = router.params.sid;
    const c = currentChild(loadChildren());
    if (!sid || !c) {
      Taro.reLaunch({ url: '/pages/index/index' });
      return;
    }
    setChild(c);
    (async () => {
      try {
        const [m, r] = await Promise.all([getMe(c.token), getRecap(c.token, sid)]);
        setMe(m);
        setRecap(r);
      } catch (e: any) {
        Taro.showToast({ title: e?.message ?? '加载失败', icon: 'none' });
      }
      setLoading(false);
    })();
  }, [router.params.sid]);

  return (
    <View className="page">
      {loading && <View className="hint">加载中…</View>}
      {!loading && recap && child && me && <RecapView recap={recap} childName={child.name} className={me.class.name} />}
    </View>
  );
}
