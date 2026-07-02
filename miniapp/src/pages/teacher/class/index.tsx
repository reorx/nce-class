import { Button, Image, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter, useShareAppMessage } from '@tarojs/taro';
import { useState } from 'react';
import {
  createInvite,
  dismissJoinRequest,
  getClassStudents,
  getJoinRequests,
  linkJoinRequest,
  type InviteResult,
  type JoinRequestItem,
  type LinkableStudent,
} from '../../../lib/api';
import { ensureLogin } from '../../../lib/wxAuth';
import './index.scss';

const toastErr = (e: any) => Taro.showToast({ title: e?.message ?? '出错了', icon: 'none' });

// 班级详情：生成邀请（weapp 分享卡片 / h5 复制链接）+ 邀请队列（关联到学生 / 忽略）。
export default function TeacherClass() {
  const router = useRouter();
  const classId = router.params.id ?? '';
  const className = decodeURIComponent(router.params.name ?? '');
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [requests, setRequests] = useState<JoinRequestItem[] | null>(null);
  const [students, setStudents] = useState<LinkableStudent[] | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setRequests(await getJoinRequests(classId));
  }

  useDidShow(() => {
    (async () => {
      try {
        await ensureLogin();
        await refresh();
      } catch (e) {
        toastErr(e);
      }
    })();
  });

  // weapp：分享卡片直达 join 页（带 invite token）
  useShareAppMessage(() => ({
    title: `邀请你的孩子加入「${className}」`,
    path: invite ? invite.sharePath : 'pages/index/index',
  }));

  async function genInvite() {
    setBusy(true);
    try {
      setInvite(await createInvite(classId));
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  }

  async function copyLink() {
    if (!invite) return;
    const data =
      process.env.TARO_ENV === 'h5'
        ? `${window.location.origin}/#/pages/join/index?invite=${invite.token}`
        : invite.sharePath;
    await Taro.setClipboardData({ data });
  }

  async function toggleLink(reqId: string) {
    setLinkingId(reqId === linkingId ? null : reqId);
    if (!students) {
      try {
        setStudents(await getClassStudents(classId));
      } catch (e) {
        toastErr(e);
      }
    }
  }

  async function doLink(req: JoinRequestItem, s: LinkableStudent) {
    const c = await Taro.showModal({
      title: '确认关联',
      content: `把「${req.cnName}」的申请关联到学生「${s.name}」？关联后家长即可查看该学生的课堂回顾。`,
    });
    if (!c.confirm) return;
    try {
      await linkJoinRequest(req.id, s.id);
      Taro.showToast({ title: '已关联', icon: 'success' });
      setLinkingId(null);
      setStudents(null); // 关联状态变了，下次展开重新拉
      await refresh();
    } catch (e) {
      toastErr(e);
    }
  }

  async function doDismiss(req: JoinRequestItem) {
    const c = await Taro.showModal({ title: '忽略申请', content: `忽略「${req.cnName}」的加入申请？对方可重新提交。` });
    if (!c.confirm) return;
    try {
      await dismissJoinRequest(req.id);
      await refresh();
    } catch (e) {
      toastErr(e);
    }
  }

  return (
    <View className="page">
      <View className="head">{className}</View>

      <View className="invite-card">
        {!invite && (
          <>
            <View className="tip">生成邀请后分享到班级群，家长点卡片填信息，回到这里确认关联</View>
            <Button className="cta" loading={busy} onClick={genInvite}>
              生成邀请
            </Button>
          </>
        )}
        {invite && (
          <>
            <View className="tip">邀请已生成，7 天内有效</View>
            <View className="token">{invite.token}</View>
            {process.env.TARO_ENV === 'weapp' ? (
              <Button className="cta" openType="share">
                分享到微信群
              </Button>
            ) : (
              <Button className="cta" onClick={copyLink}>
                复制邀请链接
              </Button>
            )}
            <View className="regen" onClick={genInvite}>
              重新生成 ›
            </View>
          </>
        )}
      </View>

      <View className="queue">
        <View className="h">邀请队列{requests ? `（${requests.length}）` : ''}</View>
        {requests && requests.length === 0 && <View className="hint">暂无待确认的申请</View>}
        {(requests ?? []).map((r) => (
          <View key={r.id} className="req">
            <View className="row">
              {r.photoUrl ? (
                <Image className="avatar" src={r.photoUrl} mode="aspectFill" />
              ) : (
                <View className="avatar ph">🧒</View>
              )}
              <View className="info">
                <View className="name">
                  {r.cnName}
                  {r.enName ? <Text className="en"> {r.enName}</Text> : null}
                </View>
                <View className="sub">
                  {r.parentPhone ? `${r.parentPhone} · ` : ''}
                  微信：{r.nickname ?? '—'}
                </View>
              </View>
            </View>
            <View className="acts">
              <Text className="act link" onClick={() => toggleLink(r.id)}>
                {linkingId === r.id ? '收起' : '关联到学生'}
              </Text>
              <Text className="act" onClick={() => doDismiss(r)}>
                忽略
              </Text>
            </View>
            {linkingId === r.id && (
              <View className="picker">
                {!students && <View className="hint">加载学生…</View>}
                {students?.map((s) => (
                  <Text key={s.id} className={`stu${s.linked ? ' linked' : ''}`} onClick={() => doLink(r, s)}>
                    {s.name}
                    {s.linked ? ' ✓' : ''}
                  </Text>
                ))}
              </View>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}
