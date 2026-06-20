// Detects "in-app browsers" — the embedded WebViews used by social apps when you
// open a link inside them (Instagram, Facebook, TikTok, …). These WebViews commonly
// block geolocation (GPS) and OAuth popups, so the app can't fix that from inside;
// the only real remedy is to send the user out to their normal browser. This helper
// just identifies the situation so the UI can guide them.

export interface InAppInfo {
  inApp: boolean;   // true if running inside a known social in-app browser
  name: string;     // friendly app name (e.g. "Instagram"), "" when not in-app
  isIOS: boolean;
  isAndroid: boolean;
}

export function detectInAppBrowser(): InAppInfo {
  if (typeof navigator === 'undefined') {
    return { inApp: false, name: '', isIOS: false, isAndroid: false };
  }
  const ua = navigator.userAgent || (navigator as any).vendor || (window as any).opera || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  // Order matters a little (Messenger UA also contains "FB*"), so check the more
  // specific tokens first. These tokens appear only inside the respective WebViews,
  // never in real Safari/Chrome, so false positives are unlikely.
  let name = '';
  if (/Instagram/i.test(ua)) name = 'Instagram';
  else if (/Messenger|MessengerForiOS/i.test(ua)) name = 'Messenger';
  else if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua)) name = 'Facebook';
  else if (/LinkedInApp/i.test(ua)) name = 'LinkedIn';
  else if (/(BytedanceWebview|musical_ly|TikTok)/i.test(ua)) name = 'TikTok';
  else if (/Snapchat/i.test(ua)) name = 'Snapchat';
  else if (/Pinterest/i.test(ua)) name = 'Pinterest';
  else if (/\bTwitter\b/i.test(ua)) name = 'X';
  else if (/MicroMessenger/i.test(ua)) name = 'WeChat';
  else if (/\bLine\//i.test(ua)) name = 'LINE';

  return { inApp: name !== '', name, isIOS, isAndroid };
}
