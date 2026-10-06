import { useCallback } from 'react';
import { useBackgroundErrorNotifier } from '../queries/background-errors';
import { useToast } from './Toast';

/** 挂在 ToastProvider 里一次：后台刷新失败统一弹一条错误 Toast（内容保留在页面上）。 */
export function BackgroundErrorToasts() {
  const toast = useToast();
  useBackgroundErrorNotifier(useCallback((message: string) => toast(message, 'error'), [toast]));
  return null;
}
