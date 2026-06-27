/** Shared configuration for the weather PWA (loaded before inline app logic). */
export const WeatherConfig = {
  APP_USER_AGENT: 'WeatherPWA/1.0 (https://github.com/scranfil/weather; contact: weather-app@users.noreply.github.com)',
  NOMINATIM_EMAIL: 'weather-app@users.noreply.github.com',
  AUTO_REFRESH_MS: 10 * 60 * 1000,
  AUTO_REFRESH_ACTIVE_MS: 3 * 60 * 1000,
  STALE_DATA_MS: 20 * 60 * 1000,
  FAVORITES_STALE_MS: 10 * 60 * 1000,
  HOURLY_FORECAST_HOURS: 24,
  LIGHTNING_NEAR_KM: 40,
  LIGHTNING_STORM_KM: 15
};