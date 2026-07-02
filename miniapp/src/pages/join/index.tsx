import { Button, Image, Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import { getJoinPreview, joinClass, uploadPhoto, type ClassPreview } from '../../lib/api';
import { addChild } from '../../lib/children';
import { loadChildren, saveChildren } from '../../lib/childrenStore';
import './index.scss';

const toastErr = (e: any) => Taro.showToast({ title: e?.message ?? '出错了', icon: 'none' });

export default function Join() {
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<ClassPreview | null>(null);
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<{ key: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup() {
    const c = code.trim().toLowerCase();
    if (!c) return Taro.showToast({ title: '请输入邀请码', icon: 'none' });
    setBusy(true);
    try {
      setPreview(await getJoinPreview(c));
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  }

  async function pickPhoto() {
    const res = await Taro.chooseImage({ count: 1, sizeType: ['compressed'] });
    const filePath = res.tempFilePaths[0];
    if (!filePath) return;
    setBusy(true);
    try {
      setPhoto(await uploadPhoto(code.trim().toLowerCase(), filePath));
    } catch (e) {
      toastErr(e);
    }
    setBusy(false);
  }

  async function join() {
    if (!name.trim()) return Taro.showToast({ title: '请填写孩子的名字', icon: 'none' });
    setBusy(true);
    try {
      const r = await joinClass(code.trim().toLowerCase(), {
        name: name.trim(),
        ...(photo ? { photoKey: photo.key } : {}),
      });
      saveChildren(
        addChild(loadChildren(), {
          token: r.recapToken,
          studentId: r.studentId,
          name: r.name,
          className: r.className,
        }),
      );
      await Taro.showToast({ title: '加入成功', icon: 'success' });
      Taro.reLaunch({ url: '/pages/index/index' });
    } catch (e) {
      toastErr(e);
      setBusy(false);
    }
  }

  if (!preview) {
    return (
      <View className="page code-step">
        <View className="hero">
          <View className="l1">🏫 加入班级</View>
          <View className="l3">向老师索取班级邀请码，输入后加入</View>
        </View>
        <Input
          className="field-input"
          placeholder="请输入班级邀请码"
          value={code}
          onInput={(e) => setCode(e.detail.value)}
        />
        <Button className="cta" loading={busy} onClick={lookup}>
          查看班级
        </Button>
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
        <View className="fl">学生名字</View>
        <Input
          className="field-input"
          placeholder="请输入孩子的名字"
          value={name}
          onInput={(e) => setName(e.detail.value)}
        />
      </View>
      <Button className="cta" loading={busy} onClick={join}>
        确认加入班级
      </Button>
      <View className="ftip">加入后可随时查看每节课的课堂回顾</View>
    </View>
  );
}
