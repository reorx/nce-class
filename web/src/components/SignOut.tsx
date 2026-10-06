import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useLogoutMutation, useMeQuery } from '../queries/auth';

// 退出登录放在 App 层（不随页面卸载）。退出成功、缓存清空后，路由守卫把用户送到登录页；
// 主动退出时守卫不记「来处」，下一个账号从首页开始，而不是回到上一个账号停留的页面
// （会话过期等被动退出仍记来处，重新登录回原页面）。只有一次跳转，避免两次导航先后覆盖。
// 失败时 reject，由调用方提示。

interface SignOut {
  signOut: () => Promise<void>;
  pending: boolean;
  /** 当前的「未登录」是不是用户主动退出造成的。 */
  signedOutByUser: () => boolean;
}

const SignOutCtx = createContext<SignOut>({ signOut: async () => {}, pending: false, signedOutByUser: () => false });

export function SignOutProvider({ children }: { children: ReactNode }) {
  const logout = useLogoutMutation();
  const me = useMeQuery().data;
  const byUser = useRef(false);
  const { mutateAsync } = logout;

  // 重新登录后清掉标记。
  useEffect(() => {
    if (me) byUser.current = false;
  }, [me]);

  const signOut = useCallback(async () => {
    byUser.current = true;
    try {
      await mutateAsync();
    } catch (e) {
      byUser.current = false;
      throw e;
    }
  }, [mutateAsync]);

  const signedOutByUser = useCallback(() => byUser.current, []);

  return (
    <SignOutCtx.Provider value={{ signOut, pending: logout.isPending, signedOutByUser }}>{children}</SignOutCtx.Provider>
  );
}

export const useSignOut = () => useContext(SignOutCtx);
