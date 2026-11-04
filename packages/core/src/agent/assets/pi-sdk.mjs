/**
 * pi SDK 的 ESM 桥
 *
 * core 编译成 CommonJS，而 @earendil-works/pi-coding-agent 只声明了 import 条件，
 * CJS 直接 require 裸包名会报 ERR_PACKAGE_PATH_NOT_EXPORTED。
 * 这里用 ESM 承接一次，CJS 侧按路径 require 本文件即可（Node >= 22.12 的 require(esm)）。
 */
export * from '@earendil-works/pi-coding-agent';
