import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDeviceSync,
  formatDeviceLabel,
  getInstallStrategy,
} from '../pwa-install.js';

describe('detectDeviceSync', () => {
  it('разпознава iPhone Safari', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';
    const d = detectDeviceSync(ua);
    assert.equal(d.os, 'ios');
    assert.equal(d.browser.id, 'safari');
    assert.equal(d.isIPhone, true);
    assert.equal(d.inApp, null);
  });

  it('разпознава iPhone Chrome (без native PWA)', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.6778.73 Mobile/15E148 Safari/604.1';
    const d = detectDeviceSync(ua);
    assert.equal(d.browser.id, 'chrome-ios');
    assert.equal(d.isSafari, false);
  });

  it('разпознава Android Chrome с модел', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36';
    const d = detectDeviceSync(ua);
    assert.equal(d.os, 'android');
    assert.equal(d.browser.id, 'chrome');
    assert.match(d.model, /Pixel 9 Pro/i);
    assert.equal(d.osVersion, '15');
  });

  it('разпознава Samsung Internet', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/120.0.0.0 Mobile Safari/537.36';
    const d = detectDeviceSync(ua);
    assert.equal(d.browser.id, 'samsung');
    assert.match(d.model, /SM-S928B/);
  });

  it('разпознава Instagram in-app браузър', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 380.0.0.0.0';
    const d = detectDeviceSync(ua);
    assert.equal(d.inApp?.id, 'instagram');
    assert.equal(d.inApp?.name, 'Instagram');
  });

  it('ползва Client Hints model когато е наличен', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36';
    const d = detectDeviceSync(ua, { model: 'SM-A556B', platformVersion: '14.0.0' });
    assert.equal(d.model, 'SM-A556B');
    assert.equal(d.osVersion, '14');
  });
});

describe('getInstallStrategy', () => {
  it('native prompt на Android Chrome', () => {
    const device = detectDeviceSync('Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36');
    const s = getInstallStrategy(device, { hasNativePrompt: true });
    assert.equal(s.mode, 'native');
    assert.equal(s.canAutoInstall, true);
  });

  it('in-app → отвори в браузър', () => {
    const device = detectDeviceSync('Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 380.0.0.0.0');
    const s = getInstallStrategy(device);
    assert.equal(s.mode, 'in-app');
    assert.equal(s.canAutoInstall, false);
    assert.ok(s.steps[0].includes('Instagram'));
  });

  it('iOS Safari → ръчни стъпки', () => {
    const device = detectDeviceSync('Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1');
    const s = getInstallStrategy(device);
    assert.equal(s.mode, 'ios-safari');
    assert.ok(s.steps.some((step) => /Add to Home Screen/i.test(step)));
  });

  it('iOS Chrome → отвори Safari', () => {
    const device = detectDeviceSync('Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.6778.73 Mobile/15E148 Safari/604.1');
    const s = getInstallStrategy(device);
    assert.equal(s.mode, 'ios-open-safari');
    assert.equal(s.secondaryLabel, 'Отвори в Safari');
  });
});

describe('formatDeviceLabel', () => {
  it('форматира iOS етикет', () => {
    const device = detectDeviceSync('Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1');
    const label = formatDeviceLabel(device);
    assert.match(label, /iOS/);
    assert.match(label, /Safari/);
  });
});
