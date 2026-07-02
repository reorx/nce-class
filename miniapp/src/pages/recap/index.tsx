import { View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import RecapView from '../../components/RecapView';
import { getStudentHome, getStudentRecap, type ParentRecap, type StudentHome } from '../../lib/api';
import { ensureLogin } from '../../lib/wxAuth';
import './index.scss';

// 单堂历史 recap：?sid=<sessionId>&student=<studentId>，binding 守卫在服务端。
export default function Recap() {
  const router = useRouter();
  const [home, setHome] = useState<StudentHome | null>(null);
  const [recap, setRecap] = useState<ParentRecap | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { sid, student } = router.params;
    if (!sid || !student) {
      Taro.reLaunch({ url: '/pages/index/index' });
      return;
    }
    (async () => {
      try {
        await ensureLogin();
        const [h, r] = await Promise.all([getStudentHome(student), getStudentRecap(student, sid)]);
        setHome(h);
        setRecap(r);
      } catch (e: any) {
        Taro.showToast({ title: e?.message ?? '加载失败', icon: 'none' });
      }
      setLoading(false);
    })();
  }, [router.params.sid, router.params.student]);

  return (
    <View className="page">
      {loading && <View className="hint">加载中…</View>}
      {!loading && recap && home && (
        <RecapView recap={recap} childName={home.student.name} className={home.class.name} />
      )}
    </View>
  );
}
