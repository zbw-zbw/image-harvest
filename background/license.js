// License periodic verification via chrome.alarms
import { MESSAGE_TYPES, LICENSE_CHECK_INTERVAL } from '../shared/constants.mjs';
import { periodicLicenseCheck } from '../shared/license.mjs';
import { broadcastToPopup } from './utils.js';

const LICENSE_ALARM_NAME = 'license-periodic-check';

export function initLicenseAlarm() {
  chrome.alarms.get(LICENSE_ALARM_NAME, (alarm) => {
    if (!alarm) {
      chrome.alarms.create(LICENSE_ALARM_NAME, {
        periodInMinutes: LICENSE_CHECK_INTERVAL / 60000
      });
    }
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === LICENSE_ALARM_NAME) {
      console.log('[License] Periodic license check triggered');
      const result = await periodicLicenseCheck();
      broadcastToPopup({
        type: MESSAGE_TYPES.LICENSE_STATUS_CHANGED,
        isPro: result.isPro,
        plan: result.plan,
        status: result.status
      });
    }
  });
}
