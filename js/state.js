import { FALLBACK_LOCATION, HOURLY_FORECAST_HOURS } from './config.js';

export const state = {
  useCelsius: localStorage.getItem('useCelsius') === 'true',
  lastWeatherFetchAt: null,
  lastHourlyPeriods: [],
  lastOpenMeteoData: null,
  cachedWeatherPayload: null,
  hourlyDisplayHours: HOURLY_FORECAST_HOURS,
  favoritesLastRefreshAt: 0,
  favorites: [],
  currentLat: FALLBACK_LOCATION.lat,
  currentLon: FALLBACK_LOCATION.lon,
  currentLocationName: FALLBACK_LOCATION.name,
  lastSunrise: null,
  lastSunset: null,
  weatherRequestId: 0,
  seenAlertIds: new Set(),
  notificationsReady: false,
  currentAlerts: [],
  dismissedAlertIds: new Set(),
  mainCardContext: null,
  lightningStrikes: [],
  activeRefreshTimeout: null
};
