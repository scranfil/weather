/** Shared configuration for the weather PWA. */
export const APP_USER_AGENT = 'WeatherPWA/1.0 (https://github.com/scranfil/weather; contact: weather-app@users.noreply.github.com)';
export const NOMINATIM_EMAIL = 'weather-app@users.noreply.github.com';
export const CARTO_BASEMAP_KEY = 'cb1_4agh_1_c0cfb0544e369e3f6f334bc9';

export const AUTO_REFRESH_MS = 10 * 60 * 1000;
export const AUTO_REFRESH_ACTIVE_MS = 3 * 60 * 1000;
export const STALE_DATA_MS = 20 * 60 * 1000;
export const FAVORITES_STALE_MS = 10 * 60 * 1000;
export const POINTS_CACHE_MS = 30 * 60 * 1000;
export const HOURLY_FORECAST_HOURS = 24;
export const LIGHTNING_NEAR_KM = 40;
export const LIGHTNING_STORM_KM = 15;
export const LIGHTNING_MAX_AGE_MS = 45 * 60 * 1000;
export const MAX_OBS_AGE_MIN = 90;

export const FALLBACK_LOCATION = {
  lat: 39.8913,
  lon: -85.9677,
  name: 'Indianapolis, IN'
};

export const RADAR_DEFAULT_ZOOM = 9;
export const RADAR_LOCAL_ZOOM = 10;
export const RADAR_TILE_MAX_ZOOM = 7;
export const RADAR_TILE_SIZE = 512;
export const RADAR_COLOR_SCHEME = 6;
export const RADAR_ZOOM_OFFSET = -1;

export const BLITZORTUNG_SERVERS = [
  'wss://ws1.blitzortung.org',
  'wss://ws2.blitzortung.org',
  'wss://ws3.blitzortung.org'
];

export const DISMISSED_ALERTS_KEY = 'dismissedWeatherAlerts';
