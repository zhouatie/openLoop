import { QaDriver, QaPlatform } from './qa-driver';
import { WebPlaywrightDriver } from './drivers/web-driver';
import { AndroidDriver } from './drivers/android-driver';

export class QaDriverFactory {
  static createDriver(platform: QaPlatform = 'web'): QaDriver {
    switch (platform) {
      case 'android':
        return new AndroidDriver();
      case 'web':
      default:
        return new WebPlaywrightDriver();
    }
  }
}
