const tg = (): any => (window as any).Telegram?.WebApp;

/** Signed user data when the page is open as a Telegram Mini App, else ''. */
const readInitData = (): string => {
  try {
    const fromSdk = tg()?.initData;
    if (fromSdk) return fromSdk;
    // Telegram opens Mini Apps with #tgWebAppData=<initData>&tgWebAppVersion=…
    return new URLSearchParams(window.location.hash.slice(1)).get('tgWebAppData') || '';
  } catch {
    return '';
  }
};

/** True as soon as the page loads inside a Telegram webview, before the SDK script finishes. */
export const inTelegram = (): boolean => {
  try {
    return Boolean(tg()) || /tgWebApp/i.test(window.location.hash || '') || /Telegram/i.test(navigator.userAgent || '');
  } catch {
    return false;
  }
};

/** telegram-web-app.js loads async: poll briefly for initData. */
export const waitForInitData = (timeoutMs = 2500): Promise<string> =>
  new Promise((resolve) => {
    const now = readInitData();
    if (now || !inTelegram()) return resolve(now);
    const started = Date.now();
    const tick = () => {
      const d = readInitData();
      if (d || Date.now() - started > timeoutMs) resolve(d);
      else setTimeout(tick, 100);
    };
    tick();
  });

export const setupTelegramShell = () => {
  try {
    const w = tg();
    w?.ready?.();
    w?.expand?.();
    w?.disableVerticalSwipes?.();
    w?.setHeaderColor?.('#F7F9FC');
    w?.setBackgroundColor?.('#F7F9FC');
    w?.setBottomBarColor?.('#F7F9FC');
  } catch {}
};

export const haptic = (kind: 'light' | 'success' | 'error' = 'light') => {
  try {
    const h = tg()?.HapticFeedback;
    if (kind === 'light') h?.impactOccurred?.('light');
    else h?.notificationOccurred?.(kind);
  } catch {}
};

/** Name and photo of the Telegram user, when opened as a Mini App. */
export const telegramProfile = (): { name: string; photo: string } => {
  try {
    const u = tg()?.initDataUnsafe?.user;
    return { name: [u?.first_name, u?.last_name].filter(Boolean).join(' '), photo: u?.photo_url || '' };
  } catch {
    return { name: '', photo: '' };
  }
};
