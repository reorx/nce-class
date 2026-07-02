import Taro from '@tarojs/taro';
import { parseState, type ChildrenState } from './children';

// Taro storage 粘合层（weapp / h5 通吃）。纯逻辑都在 children.ts。
const KEY = 'nce.children';

export function loadChildren(): ChildrenState {
  return parseState(Taro.getStorageSync(KEY));
}

export function saveChildren(state: ChildrenState): void {
  Taro.setStorageSync(KEY, JSON.stringify(state));
}
