import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { setBackgroundErrorHandler } from './client';

/** 同一文案在这段时间内只通知一次：断网时多个查询同时刷新失败不刷屏。 */
export const BACKGROUND_ERROR_DEDUPE_MS = 4000;

export const backgroundErrorMessage = (error: Error) => `刷新失败：${error.message}（已保留当前内容）`;

/**
 * 把「已有缓存的后台刷新失败」接到通知（Toast）。QueryCache 每次失败的请求只上报一次，
 * 与观察者个数无关；取消不上报；首次读取失败由页面内联展示，不走这里。
 * notify 需是稳定引用（useToast 返回值即是）。
 */
export function useBackgroundErrorNotifier(notify: (message: string) => void) {
  const client = useQueryClient();
  useEffect(() => {
    let last: { message: string; at: number } | null = null;
    return setBackgroundErrorHandler(client, (error) => {
      const message = backgroundErrorMessage(error);
      const now = Date.now();
      if (last && last.message === message && now - last.at < BACKGROUND_ERROR_DEDUPE_MS) return;
      last = { message, at: now };
      notify(message);
    });
  }, [client, notify]);
}
