import { state } from './state.js';
import { showToast } from './ui.js';

export function syncLocationToServiceWorker(lat, lon) {
  if (!navigator.serviceWorker?.controller) return;
  navigator.serviceWorker.controller.postMessage({ type: 'SET_LOCATION', lat, lon });
}

export async function registerBackgroundAlertSync() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) {
      await reg.periodicSync.register('weather-alerts', { minInterval: 15 * 60 * 1000 });
    }
  } catch {
    // unsupported
  }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { type: 'module' }).catch(err => {
      console.error('Service worker registration failed:', err);
    });
  });
}

export function getAppShareUrl() {
  const path = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/?$/, '/');
  return `${window.location.origin}${path}`;
}

export function getAppShareText() {
  const url = getAppShareUrl();
  const temp = document.getElementById('current-temp')?.textContent;
  const condition = document.getElementById('current-condition')?.textContent;
  const location = state.currentLocationName;

  if (temp && condition && location && location !== 'Getting your location...') {
    return `Right now in ${location}: ${temp}° and ${condition}.\n\nCheck out this weather app for live forecasts, radar, and alerts:\n${url}`;
  }
  return `Check out this weather app for live forecasts, radar, and alerts:\n${url}`;
}

export async function shareApp() {
  const text = getAppShareText();

  if (navigator.share) {
    try {
      await navigator.share({ title: 'Weather App', text });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }

  const isMobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
  if (isMobile) {
    window.location.href = `sms:?&body=${encodeURIComponent(text)}`;
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied — paste into a text message to share.', 'success', 2800);
  } catch {
    showToast(text, 'info', 5000);
  }
}

let deferredInstallPrompt = null;

/** True when launched as an installed PWA (fullscreen, standalone, or iOS home screen). */
export function isInstalledApp() {
  return window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches
    || window.navigator.standalone === true;
}

function showInstallButton() {
  const installBtn = document.getElementById('install-btn');
  if (installBtn) {
    installBtn.classList.remove('hidden');
    installBtn.classList.add('flex');
  }
}

function hideInstallButton() {
  const installBtn = document.getElementById('install-btn');
  if (installBtn) {
    installBtn.classList.add('hidden');
    installBtn.classList.remove('flex');
  }
}

function markInstalledShell() {
  document.documentElement.classList.add('pwa-installed');
  document.body?.classList.add('pwa-installed');
}

export function bindInstallPrompt() {
  const installBtn = document.getElementById('install-btn');
  if (isInstalledApp()) {
    markInstalledShell();
    hideInstallButton();
  } else {
    const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (isiOS && isSafari) showInstallButton();
  }

  window.matchMedia('(display-mode: fullscreen)').addEventListener('change', (event) => {
    if (event.matches) markInstalledShell();
  });
  window.matchMedia('(display-mode: standalone)').addEventListener('change', (event) => {
    if (event.matches) markInstalledShell();
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (!isInstalledApp()) showInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    hideInstallButton();
    markInstalledShell();
    showToast('Weather installed — opens fullscreen from your home screen.', 'success', 2800);
  });

  installBtn?.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      hideInstallButton();
      return;
    }
    const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isiOS && !isInstalledApp()) {
      showToast('Tap Share, then Add to Home Screen for fullscreen', 'info', 2800);
    }
  });
}
