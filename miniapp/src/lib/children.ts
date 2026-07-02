// 本地「我的孩子」列表模型 — 纯函数，不碰 Taro API（storage 粘合在
// childrenStore.ts），方便 vitest 直接测。一个孩子 = 一个 recapToken。

export interface Child {
  token: string;
  studentId: string;
  name: string;
  className: string;
}

export interface ChildrenState {
  children: Child[];
  currentToken: string | null;
}

export const emptyState = (): ChildrenState => ({ children: [], currentToken: null });

/** 解析持久化 JSON；坏数据一律回退空状态。 */
export function parseState(raw: unknown): ChildrenState {
  if (typeof raw !== 'string' || !raw) return emptyState();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  if (!data || !Array.isArray(data.children)) return emptyState();
  const children: Child[] = data.children.filter(
    (c: any) => c && typeof c.token === 'string' && typeof c.name === 'string',
  );
  const currentToken = children.some((c) => c.token === data.currentToken)
    ? data.currentToken
    : (children[0]?.token ?? null);
  return { children, currentToken };
}

/** 加入孩子：同 token 覆盖旧记录，并把它设为当前。 */
export function addChild(state: ChildrenState, child: Child): ChildrenState {
  const children = [...state.children.filter((c) => c.token !== child.token), child];
  return { children, currentToken: child.token };
}

export function removeChild(state: ChildrenState, token: string): ChildrenState {
  const children = state.children.filter((c) => c.token !== token);
  const currentToken = state.currentToken === token ? (children[0]?.token ?? null) : state.currentToken;
  return { children, currentToken };
}

export function setCurrent(state: ChildrenState, token: string): ChildrenState {
  if (!state.children.some((c) => c.token === token)) return state;
  return { ...state, currentToken: token };
}

export function currentChild(state: ChildrenState): Child | null {
  return state.children.find((c) => c.token === state.currentToken) ?? null;
}
