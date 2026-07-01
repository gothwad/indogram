import { safeSessionStorage } from '../StorageService';

export const sessionService = {
  // Synchronize dynamic client login session metadata locally
  registerActiveSession: async (userId: string, currentSettings: any): Promise<void> => {
    if (!userId) return;

    // 1. Generate or fetch current active session ID
    let sessId = safeSessionStorage.getItem('grix_current_session_id');
    if (!sessId) {
      sessId = 'sess_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
      safeSessionStorage.setItem('grix_current_session_id', sessId);
    }

    // 2. Resolve client device environment labels (Tizen TV, Android TV, Windows, iOS, etc.)
    const ua = navigator.userAgent;
    let deviceType = "Desktop PC";
    if (/mobile/i.test(ua)) deviceType = "Mobile Device";
    else if (/tablet/i.test(ua)) deviceType = "Tablet";
    else if (/smart-tv|smarttv|google-tv|appl-tv|hbbtv|netcast|tizen/i.test(ua)) deviceType = "Smart TV Browser";

    let browser = "Browser";
    if (/chrome|crios/i.test(ua) && !/edge|edg/i.test(ua) && !/opr|opera/i.test(ua)) browser = "Chrome";
    else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) browser = "Safari";
    else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
    else if (/edge|edg/i.test(ua)) browser = "Edge";
    else if (/opr|opera/i.test(ua)) browser = "Opera";

    let os = "System";
    if (/windows/i.test(ua)) os = "Windows";
    else if (/macintosh|mac os x/i.test(ua)) os = "macOS";
    else if (/android/i.test(ua)) os = "Android";
    else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
    else if (/linux/i.test(ua)) os = "Linux";
    else if (/tizen/i.test(ua)) os = "Tizen TV";
    else if (/webos/i.test(ua)) os = "webOS";

    const deviceName = `${deviceType} (${browser} on ${os})`;

    // 3. Dynamic client geo IP fetch (keep simulated for client speed / sandbox access)
    let ip = '103.88.22.41';
    let locationLabel = 'Mumbai, India';

    try {
      const ipRes = await fetch('https://ipapi.co/json/');
      if (ipRes.ok) {
        const geoData = await ipRes.json();
        ip = geoData.ip || ip;
        if (geoData.city && geoData.country_name) {
          locationLabel = `${geoData.city}, ${geoData.country_name}`;
        } else if (geoData.country_name) {
          locationLabel = geoData.country_name;
        }
      }
    } catch (_) {}

    // 4. Update settings session schema locally
    const settings = currentSettings || {};
    const activeSessions = Array.isArray(settings.active_sessions) ? [...settings.active_sessions] : [];

    const existingSession = activeSessions.find((s: any) => s.id === sessId);
    if (!existingSession) {
      if (activeSessions.length >= 15) {
        activeSessions.shift();
      }
      activeSessions.push({
        id: sessId,
        device_name: deviceName,
        ip_address: ip,
        location: locationLabel,
        login_time: new Date().toISOString(),
        last_active: new Date().toISOString()
      });
    } else {
      existingSession.last_active = new Date().toISOString();
    }
  }
};
