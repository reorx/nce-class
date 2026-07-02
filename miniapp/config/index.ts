import { defineConfig, type UserConfigExport } from '@tarojs/cli';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';
import devConfig from './dev';
import prodConfig from './prod';

// https://taro-docs.jd.com/docs/next/config#defineconfig-辅助函数
export default defineConfig<'webpack5'>(async (merge) => {
  const baseConfig: UserConfigExport<'webpack5'> = {
    projectName: 'nce-class-miniapp',
    date: '2026-7-2',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2,
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    plugins: [],
    defineConstants: {},
    copy: { patterns: [], options: {} },
    framework: 'react',
    // prebundle 在 dev 模式下与 webpack-virtual-modules 不兼容（Taro 已知问题），关闭
    compiler: { type: 'webpack5', prebundle: { enable: false } },
    cache: { enable: false },
    mini: {
      postcss: {
        pxtransform: { enable: true, config: {} },
        cssModules: { enable: false },
      },
      webpackChain(chain) {
        chain.resolve.plugin('tsconfig-paths').use(TsconfigPathsPlugin);
      },
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      output: {
        filename: 'js/[name].[hash:8].js',
        chunkFilename: 'js/[name].[chunkhash:8].js',
      },
      miniCssExtractPluginOption: {
        ignoreOrder: true,
        filename: 'css/[name].[hash].css',
        chunkFilename: 'css/[name].[chunkhash].css',
      },
      postcss: {
        autoprefixer: { enable: true, config: {} },
        cssModules: { enable: false },
      },
      // 本地开发直连本仓库 server（:5177），照片走 /uploads 静态目录
      devServer: {
        port: 10086,
        proxy: [{ context: ['/api', '/uploads'], target: 'http://localhost:5177', changeOrigin: true }],
      },
      webpackChain(chain) {
        chain.resolve.plugin('tsconfig-paths').use(TsconfigPathsPlugin);
      },
    },
  };

  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, devConfig);
  }
  return merge({}, baseConfig, prodConfig);
});
