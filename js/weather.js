import { AUTO_REFRESH_ACTIVE_MS, AUTO_REFRESH_MS } from './config.js';
import {
  fetchActiveAlerts,
  isAlertDismissed,
  loadDismissedAlertIds,
  presentAlerts
} from './alerts.js';
import {
  getForecastContextPeriod,
  getNearbyLightningCondition,
  getTodayDayPeriod,
  isCurrentlyDaytime
} from './conditions.js';
import { noteFavoriteObservation, refreshFavoritesTemps } from './favorites.js';
import { fetchWithTimeout } from './net.js';
import {
  fetchOpenMeteoExtras,
  fetchSunTimes,
  fetchTodayStationHighF,
  getPointsData,
  pickBestObservationStation
} from './nws.js';
import { syncLocationToServiceWorker } from './pwa.js';
import { primeRadarForLocation, resetLocationScopedUI, sampleRadarPrecipAt, updateRadarMap } from './radar.js';
import { state } from './state.js';
import {
  setOfflineState,
  setSectionError,
  showToast,
  updateCurrentWeather,
  updateDailyForecast,
  updateExtrasFromOpenMeteo,
  updateHourlyForecast,
  updateMoonPhase,
  updateRightNowInsight,
  updateStaleBanner,
  updateSunCard,
  updateUnitToggleButton
} from './ui.js';

export function renderWeatherView(payload) {
  state.currentLat = payload.lat;
  state.currentLon = payload.lon;
  state.currentLocationName = payload.locationName || state.currentLocationName;
  state.lastHourlyPeriods = payload.hourlyPeriods || [];
  state.lastOpenMeteoData = payload.openMeteoData || null;

  updateCurrentWeather(
    payload.observation,
    payload.forecastContextPeriod || payload.forecastPeriod,
    payload.locationName,
    payload.periods,
    payload.hourlyPeriods,
    payload.conditionOptions
  );
  updateHourlyForecast(payload.hourlyPeriods, state.hourlyDisplayHours);
  updateDailyForecast(payload.periods);
  updateMoonPhase();

  const currentTempF = parseInt(document.getElementById('current-temp')?.dataset?.tempF, 10);
  if (payload.openMeteoData) updateExtrasFromOpenMeteo(payload.openMeteoData, currentTempF);
  updateRightNowInsight({
    ...(payload.insightContext || {}),
    hourlyPeriods: payload.hourlyPeriods || payload.insightContext?.hourlyPeriods,
    currentTempF
  });
  document.querySelectorAll('.temp-unit-label').forEach(el => {
    el.textContent = state.useCelsius ? '°C' : '°F';
  });
  presentAlerts(payload.conditionOptions?.alerts || []);
  return currentTempF;
}

export function cacheWeatherPayload(payload) {
  state.cachedWeatherPayload = payload;
  state.lastWeatherFetchAt = Date.now();
  try {
    localStorage.setItem('weatherCache', JSON.stringify({ ...payload, savedAt: state.lastWeatherFetchAt }));
  } catch (error) {
    // ignore quota failures
  }
  updateStaleBanner();
  syncLocationToServiceWorker(payload.lat, payload.lon);
}

function coordsMatch(latA, lonA, latB, lonB, epsilon = 0.02) {
  return Math.abs(latA - latB) < epsilon && Math.abs(lonA - lonB) < epsilon;
}

export function applyCachedWeatherUI() {
  const payload = state.cachedWeatherPayload;
  if (!payload) return;
  primeRadarForLocation(payload.lat, payload.lon);
  renderWeatherView(payload);
  updateStaleBanner();
}

export function loadCachedWeather(lat = null, lon = null) {
  try {
    const raw = localStorage.getItem('weatherCache');
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data?.periods) return false;
    if (lat !== null && lon !== null && !coordsMatch(data.lat, data.lon, lat, lon)) return false;
    state.cachedWeatherPayload = data;
    state.lastWeatherFetchAt = data.savedAt || null;
    applyCachedWeatherUI();
    return true;
  } catch (error) {
    return false;
  }
}

function scheduleActiveRefresh(alerts, radarPrecip) {
  if (state.activeRefreshTimeout) clearTimeout(state.activeRefreshTimeout);
  const hasStorms = (alerts || []).length > 0 || radarPrecip || getNearbyLightningCondition(state.currentLat, state.currentLon);
  if (!hasStorms || document.hidden) return;
  state.activeRefreshTimeout = setTimeout(() => {
    if (!document.hidden && state.currentLat != null) {
      fetchWeather(state.currentLat, state.currentLon, state.currentLocationName, { silent: true });
    }
  }, AUTO_REFRESH_ACTIVE_MS);
}

async function fetchAndUpdateSunData(lat, lon, requestId = null) {
  try {
    const { sunrise, sunset } = await fetchSunTimes(lat, lon);
    if (requestId !== null && requestId !== state.weatherRequestId) return;
    updateSunCard(sunrise, sunset);
  } catch (error) {
    if (requestId !== null && requestId !== state.weatherRequestId) return;
    updateSunCard(null, null);
  }
}

export async function fetchWeather(lat, lon, locationName = null, options = {}) {
  const { silent = false } = options;
  const requestId = ++state.weatherRequestId;

  if (!silent) {
    state.currentLat = lat;
    state.currentLon = lon;
    if (locationName) state.currentLocationName = locationName;
    const nameEl = document.getElementById('location-name');
    if (nameEl) nameEl.textContent = state.currentLocationName;
    const card = document.getElementById('current-weather');
    if (card) card.style.opacity = '0.6';
    resetLocationScopedUI();
    primeRadarForLocation(lat, lon);
  }

  if (!navigator.onLine) {
    setOfflineState(true);
    if (!loadCachedWeather(lat, lon) && !silent) {
      showToast('Offline — no saved weather for this location.', 'warning');
    }
    const card = document.getElementById('current-weather');
    if (card) card.style.opacity = '1';
    return null;
  }
  setOfflineState(false);
  setSectionError('hourly-error', null);
  setSectionError('radar-error', null);

  try {
    const pointsData = await getPointsData(lat, lon);
    if (requestId !== state.weatherRequestId) return null;

    const nwsPlace = pointsData.properties?.relativeLocation?.properties;
    if (nwsPlace?.city && (!locationName || locationName === 'Getting your location...')) {
      const nwsName = nwsPlace.state ? `${nwsPlace.city}, ${nwsPlace.state}` : nwsPlace.city;
      locationName = nwsName;
      state.currentLocationName = nwsName;
    }

    const forecastUrl = pointsData.properties.forecast;
    const forecastHourlyUrl = pointsData.properties.forecastHourly;
    const forecastGridUrl = pointsData.properties.forecastGridData;
    const stationUrl = pointsData.properties.observationStations;

    const stationsResponse = await fetchWithTimeout(stationUrl, {}, 10000);
    if (!stationsResponse.ok) throw new Error('Failed to load observation stations');

    const [stationsData, forecastRes, hourlyRes, gridRes, openMeteoData, alertFeatures] = await Promise.all([
      stationsResponse.json(),
      fetchWithTimeout(forecastUrl, {}, 10000),
      fetchWithTimeout(forecastHourlyUrl, {}, 10000),
      fetchWithTimeout(forecastGridUrl, {}, 10000),
      fetchOpenMeteoExtras(lat, lon),
      fetchActiveAlerts(lat, lon)
    ]);

    if (!forecastRes.ok) throw new Error('Failed to load forecast');
    if (!hourlyRes.ok) throw new Error('Failed to load hourly forecast');

    const observationResult = await pickBestObservationStation(stationsData, lat, lon);
    const observationProps = observationResult?.props || {};
    const stationId = observationResult?.stationId || null;
    const forecastData = await forecastRes.json();
    const hourlyData = await hourlyRes.json();
    const gridData = gridRes.ok ? await gridRes.json() : null;
    if (requestId !== state.weatherRequestId) return null;

    state.currentLat = lat;
    state.currentLon = lon;
    if (locationName) state.currentLocationName = locationName;

    const periods = forecastData.properties.periods;
    const hourlyPeriods = hourlyData.properties.periods;
    const dayPeriod = getTodayDayPeriod(periods);
    const observedHighF = (!dayPeriod?.temperature && !isCurrentlyDaytime())
      ? await fetchTodayStationHighF(stationId)
      : null;

    let radarPrecip = null;
    try {
      await updateRadarMap(lat, lon, { resetZoom: !silent });
      radarPrecip = await sampleRadarPrecipAt(lat, lon);
    } catch (radarErr) {
      setSectionError('radar-error', 'Radar could not be loaded.');
    }
    if (requestId !== state.weatherRequestId) return null;

    const visibleAlerts = (alertFeatures || []).filter(feature => !isAlertDismissed(feature));
    const conditionOptions = {
      alerts: visibleAlerts,
      minutelyData: openMeteoData?.minutely_15 || null,
      gridData,
      radarPrecip,
      observedHighF,
      lat,
      lon
    };
    const forecastContextPeriod = getForecastContextPeriod(periods, hourlyPeriods);
    const payload = {
      lat,
      lon,
      locationName: locationName || state.currentLocationName,
      observation: observationProps || {},
      forecastPeriod: periods[0],
      forecastContextPeriod,
      periods,
      hourlyPeriods,
      conditionOptions,
      openMeteoData,
      insightContext: {
        hourlyPeriods,
        minutelyData: openMeteoData?.minutely_15,
        openMeteoHourly: openMeteoData?.hourly,
        radarPrecip
      }
    };

    const currentTempF = renderWeatherView(payload);
    payload.insightContext.currentTempF = currentTempF;
    const card = document.getElementById('current-weather');
    if (card) card.style.opacity = '1';
    const lastEl = document.getElementById('last-updated');
    if (lastEl) lastEl.textContent = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    cacheWeatherPayload(payload);
    noteFavoriteObservation(lat, lon, currentTempF);
    await refreshFavoritesTemps({ silent });
    scheduleActiveRefresh(visibleAlerts, radarPrecip);
    fetchAndUpdateSunData(lat, lon, requestId);
    return payload;
  } catch (error) {
    if (requestId !== state.weatherRequestId) return null;
    console.error('Weather loading error:', error);
    const card = document.getElementById('current-weather');
    if (card) card.style.opacity = '1';
    if (!loadCachedWeather(lat, lon)) {
      setSectionError('hourly-error', error.message || 'Weather data could not be loaded.');
    }
    if (!silent) showToast(error.message || "Weather data couldn't be loaded. Please try again.", 'error');
    return null;
  }
}

export async function manualRefresh() {
  const icon = document.getElementById('refresh-btn-icon');
  if (icon) icon.classList.add('fa-spin');
  try {
    await fetchWeather(state.currentLat, state.currentLon, state.currentLocationName);
  } finally {
    if (icon) icon.classList.remove('fa-spin');
  }
}

export function toggleTempUnit() {
  state.useCelsius = !state.useCelsius;
  localStorage.setItem('useCelsius', state.useCelsius ? 'true' : 'false');
  updateUnitToggleButton();
  if (state.cachedWeatherPayload) applyCachedWeatherUI();
  else if (state.currentLat != null) fetchWeather(state.currentLat, state.currentLon, state.currentLocationName, { silent: true });
  document.dispatchEvent(new CustomEvent('weather:favorites-changed'));
}

export function startAutoRefresh() {
  setInterval(async () => {
    if (document.hidden) return;
    const indicator = document.getElementById('refresh-indicator');
    if (indicator) indicator.classList.remove('hidden');
    await fetchWeather(state.currentLat, state.currentLon, state.currentLocationName, { silent: true });
    if (indicator) setTimeout(() => indicator.classList.add('hidden'), 1500);
  }, AUTO_REFRESH_MS);
}

export function initializeAlertDismissals() {
  loadDismissedAlertIds();
}
