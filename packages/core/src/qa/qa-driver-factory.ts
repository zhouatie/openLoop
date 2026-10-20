import { QaDriver, QaPlatform } from './qa-driver';
import { WebPlaywrightDriver } from './drivers/web-driver';
import { AndroidDriver } from './drivers/android-driver';

export class QaDriverFactory {
  static createDriver(platform: QaPlatform): QaDriver {
    switch (platform) {
      case 'web':
        return new WebPlaywrightDriver();
      case 'android':
        return new AndroidDriver();
      default:
        // 不静默降级为浏览器驱动，否则会产出不可信的结果
        throw new Error(`暂不支持的测试平台: ${String(platform)}`);
    }
  }
}
