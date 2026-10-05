import { MAX_OBS_AGE_MIN, POINTS_CACHE_MS } from './config.js';
import {
  getCurrentHourlyPeriod,
  getObservationPrecipMm,
  getTodayHighFromHourly,
  haversineKm
} from './conditions.js';
import { cToF } from './format.js';
import { fetchWithTimeout } from './net.js';

const pointsCache = new Map();

export async function getPointsData(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = pointsCache.get(key);
  if (cached && (Date.now() - cached.at) < POINTS_CACHE_MS) return cached.data;

  const pointsRes = await fetchWithTimeout(`https://api.weather.gov/points/${lat},${lon}`, {}, 8000);
  if (!pointsRes.ok) {
    if (pointsRes.status === 404) throw new Error('NWS only covers US locations. Try a US city or ZIP.');
    throw new Error('Failed to get location data');
  }
  const pointsData = await pointsRes.json();
  pointsCache.set(key, { at: Date.now(), data: pointsData });
  return pointsData;
}

export async function pickBestObservationStation(stationsData, lat, lon) {
  const features = (stationsData?.features || []).slice(0, 5);
  if (!features.length) return null;

  const observations = await Promise.all(features.map(async (feature) => {
    const id = feature.id.split('/').pop();
    try {
      const res = await fetchWithTimeout(`https://api.weather.gov/stations/${id}/observations/latest`, {}, 8000);
      if (!res.ok) return null;
      const data = await res.json();
      const props = data.properties || {};
      let dist = feature.properties?.distance?.value;
      if (!Number.isFinite(dist) && feature.geometry?.coordinates?.length >= 2) {
        const [slon, slat] = feature.geometry.coordinates;
        dist = haversineKm(lat, lon, slat, slon) * 1000;
      }
      if (!Number.isFinite(dist)) dist = Infinity;
      const precip = getObservationPrecipMm(props);
      const ts = props.timestamp ? new Date(props.timestamp).getTime() : 0;
      const ageMin = ts ? (Date.now() - ts) / 60000 : 9999;
      const hasTemp = Number.isFinite(props.temperature?.value);
      return { props, dist, precip, ageMin, hasTemp, stationId: id, isFresh: ageMin <= MAX_OBS_AGE_MIN };
    } catch (error) {
      return null;
    }
  }));

  const valid = observations.filter(Boolean);
  if (!valid.length) return null;

  valid.sort((a, b) => a.dist - b.dist);
  const withTemp = valid.filter(o => o.hasTemp);
  if (!withTemp.length) return { props: valid[0].props, stationId: valid[0].stationId };

  const fresh = withTemp.filter(o => o.isFresh);
  const pool = fresh.length ? fresh : withTemp;
  const closest = pool[0];

  const precipCandidate = pool.find(o => o.precip > 0 && o.dist <= closest.dist * 2.5);
  if (precipCandidate && closest.precip === 0 && precipCandidate.dist > closest.dist) {
    return { props: precipCandidate.props, stationId: precipCandidate.stationId };
  }

  return { props: closest.props, stationId: closest.stationId };
}

export async function fetchTodayStationHighF(stationId) {
  if (!stationId) return null;
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  try {
    const url = `https://api.weather.gov/stations/${stationId}/observations?start=${start.toISOString()}&end=${now.toISOString()}`;
    const res = await fetchWithTimeout(url, {}, 10000);
    if (!res.ok) return null;
    const data = await res.json();
    const temps = (data.features || [])
      .map(f => f.properties?.temperature?.value)
      .filter(Number.isFinite)
      .map(cToF);
    return temps.length ? Math.max(...temps) : null;
  } catch (error) {
    return null;
  }
}

function dailyHighCacheKey(lat, lon) {
  return `weatherDailyHigh_${lat.toFixed(3)}_${lon.toFixed(3)}_${new Date().toDateString()}`;
}

function loadDailyHighCache(lat, lon) {
  try {
    const raw = localStorage.getItem(dailyHighCacheKey(lat, lon));
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    return null;
  }
}

function saveDailyHighCache(lat, lon, highF) {
  if (!Number.isFinite(highF) || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  try {
    localStorage.setItem(dailyHighCacheKey(lat, lon), String(highF));
  } catch (error) {
    // ignore quota failures
  }
}

export function resolveTodayHighF({ dayPeriod, hourlyPeriods, observationTempF, observedHighF, lat, lon }) {
  if (Number.isFinite(dayPeriod?.temperature)) {
    saveDailyHighCache(lat, lon, dayPeriod.temperature);
    return dayPeriod.temperature;
  }

  let cached = loadDailyHighCache(lat, lon);
  if (Number.isFinite(observationTempF)) {
    if (!Number.isFinite(cached) || observationTempF > cached) {
      cached = observationTempF;
      saveDailyHighCache(lat, lon, cached);
    }
  }

  const hourlyHigh = getTodayHighFromHourly(hourlyPeriods);
  if (Number.isFinite(hourlyHigh)) {
    const todayKey = new Date().toDateString();
    const todayHourCount = (hourlyPeriods || [])
      .filter(p => new Date(p.startTime).toDateString() === todayKey).length;
    if (todayHourCount >= 6 && (!Number.isFinite(cached) || hourlyHigh > cached)) {
      cached = hourlyHigh;
      saveDailyHighCache(lat, lon, cached);
    }
  }

  if (Number.isFinite(cached)) return cached;

  if (Number.isFinite(observedHighF)) {
    saveDailyHighCache(lat, lon, observedHighF);
    return observedHighF;
  }

  return hourlyHigh ?? null;
}

export async function fetchOpenMeteoExtras(lat, lon) {
  try {
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + '&current=uv_index,dew_point_2m,precipitation,weather_code'
      + '&minutely_15=precipitation,precipitation_probability'
      + '&hourly=temperature_2m,uv_index,dew_point_2m,precipitation_probability'
      + '&past_days=1&forecast_minutely_15=16&forecast_days=3'
      + '&temperature_unit=fahrenheit&timezone=auto';
    const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}`
      + '&current=us_aqi&hourly=us_aqi&timezone=auto&forecast_days=3';

    const [forecastRes, aqiRes] = await Promise.all([
      fetchWithTimeout(forecastUrl, {}, 8000),
      fetchWithTimeout(aqiUrl, {}, 8000)
    ]);
    if (!forecastRes.ok) return null;

    const data = await forecastRes.json();
    if (aqiRes.ok) {
      const aqiData = await aqiRes.json();
      const aqiCurrent = aqiData.current?.us_aqi;
      if (Number.isFinite(aqiCurrent)) {
        data.current = { ...(data.current || {}), us_aqi: aqiCurrent };
      }
      if (aqiData.hourly?.us_aqi?.length) {
        data.hourly = { ...(data.hourly || {}), us_aqi: aqiData.hourly.us_aqi };
      }
    }
    return data;
  } catch (error) {
    return null;
  }
}

export async function fetchSunTimes(lat, lon) {
  const res = await fetchWithTimeout(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&formatted=0`, {}, 8000);
  if (!res.ok) throw new Error('Sun data failed');
  const data = await res.json();
  if (!data.results) throw new Error('No sun results');
  return {
    sunrise: new Date(data.results.sunrise),
    sunset: new Date(data.results.sunset)
  };
}
