import { STALE_DATA_MS } from './config.js';
import { requestNotificationPermission } from './alerts.js';
import {
  addCurrentToFavorites,
  goHome,
  homeOrFallbackLocation,
  loadFavorites,
  maybePromptSetHome,
  renderFavorites,
  setHomeFromCurrent
} from './favorites.js';
import { bindSearchAutocomplete, searchLocation, useCurrentLocation } from './geocode.js';
import { bindInstallPrompt, registerBackgroundAlertSync, registerServiceWorker, shareApp } from './pwa.js';
import { bindRadarControls, pruneLightningStrikes, renderLightningStrikes, startPassiveLightningFeed } from './radar.js';
import { state } from './state.js';
import { closeForecastModal, updateHourlyForecast, updateUnitToggleButton } from './ui.js';
import { fetchWeather, initializeAlertDismissals, manualRefresh, startAutoRefresh, toggleTempUnit } from './weather.js';

async function loadDefaultWeather() {
  const nameEl = document.getElementById('location-name');
  if (nameEl) nameEl.textContent = 'Getting your location...';
  const located = await useCurrentLocation({ silent: true });
  if (!located) {
    const place = homeOrFallbackLocation();
    state.currentLat = place.lat;
    state.currentLon = place.lon;
    state.currentLocationName = place.name;
    await fetchWeather(state.currentLat, state.currentLon, state.currentLocationName);
  } else {
    maybePromptSetHome();
  }
}

function initializeWeatherApp() {
  requestNotificationPermission();
  registerBackgroundAlertSync();
  updateUnitToggleButton();
  loadFavorites();
  renderFavorites();
  startPassiveLightningFeed();
  loadDefaultWeather();

  window.addEventListener('online', () => { setOfflineFromApp(false); manualRefresh(); });
  window.addEventListener('offline', () => setOfflineFromApp(true));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.lastWeatherFetchAt && (Date.now() - state.lastWeatherFetchAt) > STALE_DATA_MS) {
      fetchWeather(state.currentLat, state.currentLon, state.currentLocationName, { silent: true });
    }
  });

  let touchStartY = 0;
  document.addEventListener('touchstart', (event) => { touchStartY = event.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchend', (event) => {
    if (window.scrollY > 10) return;
    const dy = event.changedTouches[0].clientY - touchStartY;
    if (dy > 90) manualRefresh();
  }, { passive: true });

  document.getElementById('search-btn')?.addEventListener('click', searchLocation);
  document.getElementById('location-btn')?.addEventListener('click', () => useCurrentLocation());
  document.getElementById('refresh-btn')?.addEventListener('click', manualRefresh);
  document.getElementById('unit-toggle-btn')?.addEventListener('click', toggleTempUnit);
  document.getElementById('go-home-btn')?.addEventListener('click', goHome);
  document.getElementById('set-home-btn')?.addEventListener('click', setHomeFromCurrent);
  document.getElementById('add-favorite-btn')?.addEventListener('click', addCurrentToFavorites);
  document.getElementById('share-btn')?.addEventListener('click', shareApp);
  document.getElementById('hourly-expand-btn')?.addEventListener('click', () => {
    state.hourlyDisplayHours = state.hourlyDisplayHours >= 48 ? 24 : 48;
    const btn = document.getElementById('hourly-expand-btn');
    if (btn) btn.textContent = state.hourlyDisplayHours >= 48 ? 'Show 24 hours' : 'Show 48 hours';
    updateHourlyForecast(state.lastHourlyPeriods, state.hourlyDisplayHours);
  });

  document.getElementById('forecast-modal')?.addEventListener('click', closeForecastModal);
  document.getElementById('forecast-modal-card')?.addEventListener('click', (event) => event.stopPropagation());
  document.getElementById('forecast-modal-close')?.addEventListener('click', closeForecastModal);

  document.addEventListener('weather:refresh', () => { manualRefresh(); });
  document.addEventListener('weather:open-location', (event) => {
    const { lat, lon, name } = event.detail || {};
    if (Number.isFinite(lat) && Number.isFinite(lon)) fetchWeather(lat, lon, name);
  });
  document.addEventListener('weather:favorites-changed', () => renderFavorites());

  bindRadarControls();
  bindSearchAutocomplete();
}

function setOfflineFromApp(isOffline) {
  document.getElementById('offline-banner')?.classList.toggle('hidden', !isOffline);
}

initializeAlertDismissals();
bindInstallPrompt();
registerServiceWorker();
startAutoRefresh();

setInterval(() => {
  pruneLightningStrikes();
  renderLightningStrikes();
}, 60000);

if (document.readyState === 'complete') initializeWeatherApp();
else window.addEventListener('load', initializeWeatherApp);
