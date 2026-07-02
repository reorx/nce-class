import { Button, Image, Input, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { getInvitePreview, joinByInvite, uploadPhoto, type ClassPreview } from '../../lib/api';
import { validateJoinForm } from '../../lib/flow';
import { ensureLogin } from '../../lib/wxAuth';
import './index.scss';

const toastErr = (e: any) => Taro.showToast({ title: e?.message ?? '出错了', icon: 'none' });

// 分享卡片落地页 ?invite=<token>：班级预览 + 中文名/英文名/家长手机号/头像
// → 提交 join_request（不建学生），回首页进入「等待老师确认」态。
export default function Join() {
  const router = useRouter();
  const invite = router.params.invite ?? '';
  const [preview, setPreview] = useState<ClassPreview | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [cnName, setCnName] = useState('');
  const [enName, setEnName] = useState('');
  const [phone, setPhone] = useState('');
  const [photo, setPhoto] = useState<{ key: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!invite) {
        setInvalid('请通过老师分享到班级群的邀请卡片进入');
        return;
      }
      try {
        await ensureLogin();
        setPreview(await getInvitePreview(invite));
      } catch (e: any) {
        setInvalid(e?.message ?? '邀请无效');
      }
    })();
  }, [invite]);

  async function pickPhoto() {
    const res = await Taro.chooseImage({ count: 1, sizeType: ['compressed'] });
    const filePath = res.tempFilePaths[0];
    if (!filePath) return;
    setBusy(true);
    try {
      setPhoto(await uploadPhoto(filePath));
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  }

  async function submit() {
    const err = validateJoinForm({ cnName, parentPhone: phone });
    if (err) return Taro.showToast({ title: err, icon: 'none' });
    setBusy(true);
    try {
      await joinByInvite(invite, {
        cnName: cnName.trim(),
        ...(enName.trim() ? { enName: enName.trim() } : {}),
        ...(phone.trim() ? { parentPhone: phone.trim() } : {}),
        ...(photo ? { photoKey: photo.key } : {}),
      });
      await Taro.showToast({ title: '已提交，等待老师确认', icon: 'success' });
      Taro.reLaunch({ url: '/pages/index/index' });
    } catch (e) {
      toastErr(e);
      setBusy(false);
    }
  }

  if (invalid) {
    return (
      <View className="page code-step">
        <View className="hero">
          <View className="l1">😥 无法加入</View>
          <View className="l3">{invalid}</View>
        </View>
        <Button className="cta" onClick={() => Taro.reLaunch({ url: '/pages/index/index' })}>
          回首页
        </Button>
      </View>
    );
  }

  if (!preview) {
    return (
      <View className="page code-step">
        <View className="hero">
          <View className="l3">加载中…</View>
        </View>
      </View>
    );
  }

  return (
    <View className="page form-step">
      <View className="hero">
        <View className="l1">👩‍🏫 {preview.teacherName}老师 邀请你加入</View>
        <View className="l2">{preview.className}</View>
        <View className="l3">
          {preview.orgName}
          {preview.level ? ` · ${preview.level}` : ''}
        </View>
      </View>
      <View className="upload" onClick={pickPhoto}>
        {photo ? (
          <Image className="upimg" src={photo.url} mode="aspectFill" />
        ) : (
          <>
            <Text className="ic">📷</Text>
            <Text>上传学生照片</Text>
          </>
        )}
      </View>
      <View className="uptip">课堂上展示，方便老师认人（可选）</View>
      <View className="field">
        <View className="fl">中文名</View>
        <Input
          className="field-input"
          placeholder="孩子的中文名（必填）"
          value={cnName}
          onInput={(e) => setCnName(e.detail.value)}
        />
      </View>
      <View className="field">
        <View className="fl">英文名</View>
        <Input
          className="field-input"
          placeholder="孩子的英文名（可选）"
          value={enName}
          onInput={(e) => setEnName(e.detail.value)}
        />
      </View>
      <View className="field">
        <View className="fl">家长手机号</View>
        <Input
          className="field-input"
          type="number"
          placeholder="11 位手机号（可选）"
          value={phone}
          onInput={(e) => setPhone(e.detail.value)}
        />
      </View>
      <Button className="cta" loading={busy} onClick={submit}>
        确认加入班级
      </Button>
      <View className="ftip">提交后由老师确认关联，即可查看每节课的课堂回顾</View>
    </View>
  );
}
