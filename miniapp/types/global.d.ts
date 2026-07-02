/// <reference types="@tarojs/taro" />

declare module '*.png';
declare module '*.gif';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.svg';
declare module '*.css';
declare module '*.scss';

declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production';
    /** 当前构建的平台 */
    TARO_ENV: 'weapp' | 'h5';
    TARO_APP_ID: string;
  }
}
