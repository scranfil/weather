import { DISMISSED_ALERTS_KEY } from './config.js';
import { fetchWithTimeout } from './net.js';
import { updateAlertPolygons } from './radar.js';
import { state } from './state.js';

export function loadDismissedAlertIds() {
  try {
    const saved = localStorage.getItem(DISMISSED_ALERTS_KEY);
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      state.dismissedAlertIds = new Set(parsed.filter(Boolean));
    }
  } catch (error) {
    state.dismissedAlertIds = new Set();
  }
}

function persistDismissedAlertIds() {
  try {
    localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify([...state.dismissedAlertIds]));
  } catch (error) {
    // ignore persistence failures
  }
}

export function isAlertDismissed(feature) {
  const id = feature?.id || feature?.properties?.id || feature?.properties?.event;
  return Boolean(id && state.dismissedAlertIds.has(id));
}

export function updateMainAlertStrip(alerts) {
  const strip = document.getElementById('main-alert-strip');
  const text = document.getElementById('main-alert-strip-text');
  if (!strip || !text) return;
  const visible = (alerts || []).filter(alert => {
    const eventName = (alert.properties?.event || '').toLowerCase();
    return !isAlertDismissed(alert) && (eventName.includes('warning') || eventName.includes('tornado') || eventName.includes('severe'));
  });
  if (!visible.length) {
    strip.classList.add('hidden');
    return;
  }
  const top = visible[0].properties;
  text.textContent = `${top.event || 'Alert'}: ${top.headline || top.description || 'Check details below.'}`;
  strip.classList.remove('hidden');
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    state.notificationsReady = true;
  } else if (Notification.permission !== 'denied') {
    const perm = await Notification.requestPermission();
    state.notificationsReady = perm === 'granted';
  }
}

async function fireAlertNotification(eventName, headline) {
  if (!state.notificationsReady) return;

  const title = `⚠️ ${eventName}`;
  const options = {
    body: headline,
    icon: 'icon.svg',
    badge: 'icon.svg',
    tag: eventName,
    renotify: true
  };

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      if (registration?.showNotification) {
        await registration.showNotification(title, options);
        return;
      }
    }
  } catch (error) {
    // Fall back to the legacy constructor if the service worker path is unavailable.
  }

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); n.close(); };
  }
}

export function updateAlerts(features) {
  const section = document.getElementById('alerts-section');
  const list = document.getElementById('alerts-list');
  if (!section || !list) return;
  list.replaceChildren();

  const visibleFeatures = (features || []).filter(feature => !isAlertDismissed(feature));
  if (!visibleFeatures.length) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  visibleFeatures.slice(0, 3).forEach((feature, idx) => {
    const props = feature.properties || {};
    const severity = (props.severity || 'Unknown').toLowerCase();
    const eventName = props.event || 'Weather Alert';
    const headline = props.headline || props.description || 'Stay weather-aware in your area.';
    const effective = props.effective ? new Date(props.effective) : null;
    const description = props.description || '';
    const areaDesc = props.areaDesc || '';
    const expires = props.expires ? new Date(props.expires) : null;

    const card = document.createElement('div');
    const variant = severity.includes('moderate') ? 'warning' : severity.includes('minor') ? 'watch' : '';
    card.className = `alert-card ${variant} rounded-2xl p-4 cursor-pointer select-none`;

    const timeText = effective
      ? effective.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : 'Now';
    const expiresText = expires
      ? expires.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
      : '';

    const detailId = `alert-detail-${idx}`;

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between gap-3 mb-1';
    const eventEl = document.createElement('div');
    eventEl.className = 'text-sm font-semibold text-orange-100';
    eventEl.textContent = eventName;
    const rightHeader = document.createElement('div');
    rightHeader.className = 'flex items-center gap-2';
    const sevEl = document.createElement('div');
    sevEl.className = 'text-[11px] uppercase tracking-wide text-zinc-300';
    sevEl.textContent = severity;
    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'text-zinc-400 hover:text-white transition-colors';
    dismissBtn.setAttribute('aria-label', `Dismiss ${eventName}`);
    dismissBtn.innerHTML = '<i class="fa-solid fa-xmark text-xs"></i>';
    dismissBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      dismissAlert(feature);
    });
    const chevron = document.createElement('i');
    chevron.className = 'fa-solid fa-chevron-down text-zinc-400 text-xs transition-transform duration-300 alert-chevron';
    rightHeader.append(sevEl, dismissBtn, chevron);
    header.append(eventEl, rightHeader);

    const headLineEl = document.createElement('div');
    headLineEl.className = 'text-sm text-zinc-200 leading-snug mb-2';
    headLineEl.textContent = headline;

    const issuedEl = document.createElement('div');
    issuedEl.className = 'text-[11px] text-zinc-400';
    issuedEl.textContent = `Issued ${timeText}${expiresText ? ` — Expires ${expiresText}` : ''}`;

    const detailWrap = document.createElement('div');
    detailWrap.id = detailId;
    detailWrap.className = 'alert-detail overflow-hidden max-h-0 transition-all duration-300 ease-in-out';
    const inner = document.createElement('div');
    inner.className = 'mt-3 pt-3 border-t border-white/10 space-y-3';

    if (areaDesc) {
      const areaBlock = document.createElement('div');
      const areaTitle = document.createElement('div');
      areaTitle.className = 'text-[11px] uppercase tracking-wide text-zinc-400 mb-1';
      areaTitle.textContent = 'Affected Areas';
      const areaText = document.createElement('div');
      areaText.className = 'text-xs text-zinc-300 leading-relaxed';
      areaText.textContent = areaDesc;
      areaBlock.append(areaTitle, areaText);
      inner.appendChild(areaBlock);
    }
    if (description) {
      const descBlock = document.createElement('div');
      const descTitle = document.createElement('div');
      descTitle.className = 'text-[11px] uppercase tracking-wide text-zinc-400 mb-1';
      descTitle.textContent = 'Details';
      const descText = document.createElement('div');
      descText.className = 'text-xs text-zinc-300 leading-relaxed whitespace-pre-line';
      descText.textContent = description;
      descBlock.append(descTitle, descText);
      inner.appendChild(descBlock);
    }

    detailWrap.appendChild(inner);
    card.append(header, headLineEl, issuedEl, detailWrap);

    card.addEventListener('click', () => {
      const detail = document.getElementById(detailId);
      const chevronIcon = card.querySelector('.alert-chevron');
      const isOpen = detail.style.maxHeight && detail.style.maxHeight !== '0px';
      if (isOpen) {
        detail.style.maxHeight = '0px';
        chevronIcon.style.transform = '';
      } else {
        detail.style.maxHeight = detail.scrollHeight + 'px';
        chevronIcon.style.transform = 'rotate(180deg)';
      }
    });

    list.appendChild(card);
  });
}

export function dismissAlert(feature) {
  const id = feature?.id || feature?.properties?.id || feature?.properties?.event;
  if (!id) return;
  state.dismissedAlertIds.add(id);
  persistDismissedAlertIds();
  state.currentAlerts = state.currentAlerts.filter(alert => {
    const alertId = alert?.id || alert?.properties?.id || alert?.properties?.event;
    return alertId !== id;
  });
  updateMainAlertStrip(state.currentAlerts);
  updateAlerts(state.currentAlerts);
}

export async function fetchActiveAlerts(lat, lon) {
  try {
    const res = await fetchWithTimeout(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, {}, 8000);
    if (!res.ok) return [];
    const data = await res.json();
    return data.features || [];
  } catch (error) {
    return [];
  }
}

export function presentAlerts(features, requestId = null) {
  if (requestId !== null && requestId !== state.weatherRequestId) return;
  const visibleFeatures = (features || []).filter(feature => !isAlertDismissed(feature));
  state.currentAlerts = visibleFeatures;
  updateMainAlertStrip(visibleFeatures);

  visibleFeatures.forEach(feature => {
    const id = feature.id || feature.properties?.id || feature.properties?.event;
    if (id && !state.seenAlertIds.has(id)) {
      state.seenAlertIds.add(id);
      const props = feature.properties || {};
      const eventName = props.event || 'Weather Alert';
      const headline = props.headline || props.description || 'Check the weather app for details.';
      fireAlertNotification(eventName, headline);
    }
  });

  updateAlerts(visibleFeatures);
  updateAlertPolygons(visibleFeatures);
}
