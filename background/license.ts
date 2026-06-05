// License periodic verification via chrome.alarms.
import { MESSAGE_TYPES, LICENSE_CHECK_INTERVAL } from '../shared/constants';
import { periodicLicenseCheck } from '../shared/license';
import { broadcastToPopup } from './utils';

const LICENSE_ALARM_NAME = 'license-periodic-check';

export function initLicenseAlarm(): void {
  chrome.alarms.get(LICENSE_ALARM_NAME, (alarm) => {
    if (!alarm) {
      chrome.alarms.create(LICENSE_ALARM_NAME, {
        periodInMinutes: LICENSE_CHECK_INTERVAL / 60000,
      });
    }
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== LICENSE_ALARM_NAME) return;
    const result = await periodicLicenseCheck();
    // `periodicLicenseCheck` may return either { isPro: false } or full ProUserInfo.
    // Forward whatever fields exist; `plan`/`status` may be undefined for the
    // never-licensed case, which is fine for the broadcast payload.
    broadcastToPopup({
      type: MESSAGE_TYPES.LICENSE_STATUS_CHANGED,
      isPro: result.isPro,
      plan: 'plan' in result ? result.plan : undefined,
      status: 'status' in result ? result.status : undefined,
    });
  });
}
