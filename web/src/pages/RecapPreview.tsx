import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toBlob, toPng } from 'html-to-image';
import { RecapCard } from '../components/RecapCard';
import { useToast } from '../components/Toast';
import { api, type ClassDetail, type Recap } from '../lib/api';
import { dateLabel } from '../lib/recapCard';
import { GREEN } from '../lib/theme';

// Recap 预览页（从上课记录新标签页打开）：左侧移动端预览，右侧下载/复制/推送操作。

const PREVIEW_W = 390;
const SNAP_OPTS = { pixelRatio: 2, backgroundColor: '#faf7f0' };

export function RecapPreview() {
  const { id = '', sid = '' } = useParams();
  const toast = useToast();
  const [d, setD] = useState<ClassDetail | null>(null);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copying, setCopying] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([api.classDetail(id), api.getSessionRecap(sid)])
      .then(([detail, r]) => {
        setD(detail);
        setRecap(r);
      })
      .catch(() => setFailed(true));
  }, [id, sid]);

  const year = d?.sessions.find((s) => s.id === sid)?.year ?? null;
  const fileName = () => `课堂战报-${d?.name ?? ''}-${dateLabel(year, recap?.date ?? '')}.png`;

  async function download() {
    if (!cardRef.current || downloading) return;
    setDownloading(true);
    try {
      const url = await toPng(cardRef.current, SNAP_OPTS);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName();
      a.click();
      toast('图片已开始下载');
    } catch {
      toast('图片生成失败，请重试', 'error');
    } finally {
      setDownloading(false);
    }
  }

  async function copyImage() {
    if (!cardRef.current || copying) return;
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      toast('当前浏览器不支持复制图片，请使用下载', 'error');
      return;
    }
    setCopying(true);
    try {
      const blob = await toBlob(cardRef.current, SNAP_OPTS);
      if (!blob) throw new Error('empty blob');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('图片已复制到剪贴板');
    } catch {
      toast('复制失败，请重试或改用下载', 'error');
    } finally {
      setCopying(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f2f0ea', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 26px',
          background: '#fff',
          borderBottom: '1px solid #e7e9ee',
        }}
      >
        <Link
          to={`/classes/${id}?tab=sessions`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: '#7a828f',
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span style={{ fontSize: 14 }}>←</span>返回上课记录
        </Link>
        <div style={{ fontWeight: 700, fontSize: 15.5, color: '#1e2430' }}>课堂战报预览{d ? ` · ${d.name}` : ''}</div>
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          gap: 40,
          padding: '36px 26px 64px',
          flexWrap: 'wrap',
        }}
      >
        {/* 左：移动端预览 */}
        <div
          style={{
            width: PREVIEW_W + 24,
            padding: 12,
            background: '#1e2430',
            borderRadius: 40,
            boxShadow: '0 24px 60px rgba(20,28,45,.28)',
            flexShrink: 0,
          }}
        >
          <div style={{ borderRadius: 28, overflow: 'hidden', background: '#faf7f0', minHeight: 320 }}>
            {failed ? (
              <div style={{ padding: '80px 20px', textAlign: 'center', color: '#9aa1ac', fontSize: 13.5 }}>
                回顾加载失败，请刷新重试
              </div>
            ) : !recap || !d ? (
              <div style={{ padding: '80px 20px', textAlign: 'center', color: '#9aa1ac', fontSize: 13.5 }}>加载中…</div>
            ) : (
              // 截图只取战报本体（ref 在此层），不带手机边框
              <div ref={cardRef}>
                <RecapCard recap={recap} className={d.name} year={year} />
              </div>
            )}
          </div>
        </div>

        {/* 右：操作面板 */}
        <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: '#1e2430' }}>分享操作</div>
          <div style={{ fontSize: 12.5, color: '#8a929e', lineHeight: 1.7, marginTop: -4 }}>
            左侧即家长在手机上看到的课堂战报（全班版，不含个人表现）。可导出为图片发到班级群。
          </div>
          <button style={actionBtn(true)} disabled={!recap || downloading} onClick={download}>
            ⬇️ {downloading ? '生成图片中…' : '下载图片'}
          </button>
          <button style={actionBtn(false)} disabled={!recap || copying} onClick={copyImage}>
            📋 {copying ? '复制中…' : '复制图片'}
          </button>
          <button
            style={{ ...actionBtn(false), color: '#a6adb8', cursor: 'default' }}
            onClick={() => toast('推送全班功能即将上线')}
          >
            📣 推送全班
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                fontWeight: 600,
                color: '#a6adb8',
                background: '#f0f2f5',
                padding: '2px 8px',
                borderRadius: 999,
              }}
            >
              即将上线
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

const actionBtn = (primary: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 44,
  padding: '0 16px',
  background: primary ? GREEN : '#fff',
  color: primary ? '#fff' : '#3c4451',
  border: primary ? 'none' : '1px solid #e2e5ea',
  borderRadius: 10,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  boxShadow: primary ? '0 3px 10px rgba(47,180,87,.24)' : 'none',
  textAlign: 'left',
});
