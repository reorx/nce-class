import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogoutMutation } from '../queries/auth';

// 退出登录放在 App 层（不随页面卸载）：退出成功、缓存清空后跳到干净的登录页，
// 下一个账号从首页开始，而不是回到上一个账号停留的页面。失败时 reject，由调用方提示。

interface SignOut {
  signOut: () => Promise<void>;
  pending: boolean;
}

const SignOutCtx = createContext<SignOut>({ signOut: async () => {}, pending: false });

export function SignOutProvider({ children }: { children: ReactNode }) {
  const logout = useLogoutMutation();
  const navigate = useNavigate();
  const { mutateAsync } = logout;
  const signOut = useCallback(async () => {
    await mutateAsync();
    navigate('/login', { replace: true });
  }, [mutateAsync, navigate]);
  return <SignOutCtx.Provider value={{ signOut, pending: logout.isPending }}>{children}</SignOutCtx.Provider>;
}

export const useSignOut = () => useContext(SignOutCtx);
