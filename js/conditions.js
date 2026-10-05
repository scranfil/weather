import { LIGHTNING_NEAR_KM, LIGHTNING_STORM_KM, MAX_OBS_AGE_MIN } from './config.js';
import { state } from './state.js';

export function haversineKm(lat1, lon1, lat2, lon2) {
  const radius = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isDaytimeAt(date = new Date()) {
  const time = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (state.lastSunrise && state.lastSunset) {
    return time >= state.lastSunrise.getTime() && time <= state.lastSunset.getTime();
  }
  const hour = new Date(time).getHours();
  return hour >= 6 && hour < 20;
}

export function isCurrentlyDaytime() {
  return isDaytimeAt(new Date());
}

export function getConditionSeverity(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('tornado')) return 100;
  if (t.includes('thunder') || t.includes('lightning')) return 80;
  if (t.includes('storm')) return 70;
  if (t.includes('hail')) return 65;
  if (t.includes('rain') || t.includes('shower') || t.includes('drizzle')) return 50;
  if (t.includes('snow') || t.includes('sleet') || t.includes('ice')) return 45;
  if (t.includes('fog') || t.includes('mist')) return 20;
  if (t.includes('overcast') || t.includes('cloud')) return 15;
  if (t.includes('partly')) return 10;
  if (t.includes('mostly clear') || t.includes('clear') || t.includes('sunny')) return 5;
  return 0;
}

export function getCurrentHourlyPeriod(hourlyPeriods, now = new Date()) {
  if (!hourlyPeriods?.length) return null;
  const nowMs = now.getTime();
  for (let i = 0; i < hourlyPeriods.length; i++) {
    const start = new Date(hourlyPeriods[i].startTime).getTime();
    const end = i < hourlyPeriods.length - 1
      ? new Date(hourlyPeriods[i + 1].startTime).getTime()
      : start + 3600000;
    if (nowMs >= start && nowMs < end) return hourlyPeriods[i];
  }
  return hourlyPeriods[0];
}

export function isObservationStale(observation, maxAgeMinutes = MAX_OBS_AGE_MIN) {
  const ts = observation?.timestamp;
  if (!ts) return true;
  return (Date.now() - new Date(ts).getTime()) > maxAgeMinutes * 60000;
}

export function getObservationPrecipMm(observation) {
  const lastHour = observation?.precipitationLastHour?.value;
  const last3 = observation?.precipitationLast3Hours?.value;
  if (Number.isFinite(lastHour) && lastHour > 0) return lastHour;
  if (Number.isFinite(last3) && last3 > 0) return last3 / 3;
  return 0;
}

export function getTodayLowTemp(periods) {
  const now = new Date();
  const todayKey = now.toDateString();
  const todayPeriods = periods.filter(p => new Date(p.startTime).toDateString() === todayKey);
  const nightTemps = todayPeriods
    .filter(p => !p.isDaytime)
    .map(p => p.temperature)
    .filter(t => Number.isFinite(t));
  if (nightTemps.length) return Math.min(...nightTemps);

  const tonight = periods.find(p =>
    p.name === 'Tonight' && Number.isFinite(p.temperature)
    && new Date(p.startTime).toDateString() === todayKey
  );
  if (tonight) return tonight.temperature;

  const temps = todayPeriods.map(p => p.temperature).filter(t => Number.isFinite(t));
  return temps.length ? Math.min(...temps) : null;
}

export function getYesterdayTempAtSameTime(openMeteoHourly, now = new Date()) {
  const times = openMeteoHourly?.time;
  const temps = openMeteoHourly?.temperature_2m;
  if (!times?.length || !temps?.length) return null;

  const yesterdayMs = now.getTime() - 86400000;
  const yesterdayKey = new Date(yesterdayMs).toDateString();
  let bestTemp = null;
  let bestDiff = Infinity;

  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]);
    if (t.toDateString() !== yesterdayKey) continue;
    const diff = Math.abs(t.getTime() - yesterdayMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestTemp = temps[i];
    }
  }

  if (!Number.isFinite(bestTemp) || bestDiff > 90 * 60000) return null;
  return bestTemp;
}

export function formatPrecipInsightWhen(period, isCurrentHour, now = new Date()) {
  if (isCurrentHour) return 'now';
  const start = new Date(period.startTime);
  const timeLabel = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const todayKey = now.toDateString();
  if (start.toDateString() === todayKey) return `around ${timeLabel}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (start.toDateString() === tomorrow.toDateString()) return `tomorrow around ${timeLabel}`;
  const dayName = start.toLocaleDateString('en-US', { weekday: 'long' });
  return `${dayName} around ${timeLabel}`;
}

export function isUpcomingHourlyPeriod(period, now = new Date()) {
  const startMs = new Date(period.startTime).getTime();
  return startMs + 3600000 > now.getTime();
}

export function describeHourlyPrecipInsight(period, isCurrentHour, now = new Date()) {
  const chance = period.probabilityOfPrecipitation?.value || 0;
  const fc = (period.shortForecast || '').toLowerCase();
  const isStorm = /thunder|storm/.test(fc);
  const isRainy = chance >= 20 || /rain|shower|drizzle/.test(fc) || isStorm;
  if (!isRainy) return null;

  if (isStorm) {
    if (chance < 15) return null;
    if (chance < 30) {
      const when = isCurrentHour ? 'this hour' : formatPrecipInsightWhen(period, false, now);
      return { text: `Slight chance of storms ${when} (${chance}% chance).`, severity: 'info' };
    }
    const when = formatPrecipInsightWhen(period, isCurrentHour, now);
    return {
      text: `Storms possible ${when} (${chance}% chance).`,
      severity: chance >= 50 ? 'storm' : 'info'
    };
  }

  if (chance < 30) return null;
  const when = formatPrecipInsightWhen(period, isCurrentHour, now);
  return { text: `Rain likely ${when} (${chance}% chance).`, severity: 'rain' };
}

export function getTodayDayPeriod(periods) {
  const todayKey = new Date().toDateString();
  const todayDay = periods.find(p => p.isDaytime && new Date(p.startTime).toDateString() === todayKey);
  if (todayDay) return todayDay;
  if (!isCurrentlyDaytime()) {
    const pastTodayDay = [...periods].reverse().find(p =>
      p.isDaytime && new Date(p.startTime).toDateString() === todayKey
    );
    if (pastTodayDay) return pastTodayDay;
    return null;
  }
  return periods.find(p => p.isDaytime && new Date(p.startTime) >= new Date()) || null;
}

export function getTodayHighFromHourly(hourlyPeriods) {
  const todayKey = new Date().toDateString();
  const temps = (hourlyPeriods || [])
    .filter(p => new Date(p.startTime).toDateString() === todayKey)
    .map(p => p.temperature)
    .filter(Number.isFinite);
  return temps.length ? Math.max(...temps) : null;
}

export function getTonightLowFallback(allPeriods) {
  const tonight = allPeriods.find(p => p.name === 'Tonight' && Number.isFinite(p.temperature));
  if (tonight) return tonight.temperature;
  const night = allPeriods.find(p => !p.isDaytime && Number.isFinite(p.temperature));
  return night?.temperature ?? null;
}

export function getForecastContextPeriod(allPeriods, hourlyPeriods) {
  const hourlyNow = getCurrentHourlyPeriod(hourlyPeriods);
  if (hourlyNow?.shortForecast) {
    return {
      shortForecast: hourlyNow.shortForecast,
      temperature: hourlyNow.temperature,
      name: hourlyNow.shortForecast
    };
  }
  if (!isCurrentlyDaytime()) {
    const tonight = allPeriods.find(p => p.name === 'Tonight');
    if (tonight) return tonight;
  }
  return allPeriods[0] || { shortForecast: '', temperature: null };
}

export function parseNwsWindMph(windSpeedText) {
  const match = String(windSpeedText || '').match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

export function observationWindMph(observation) {
  const wind = observation?.windSpeed;
  if (!wind || !Number.isFinite(wind.value)) return null;
  const unit = wind.unitCode || '';
  if (unit.includes('km_h')) return wind.value * 0.621371;
  if (unit.includes('m_s')) return wind.value * 2.236936;
  if (unit.includes('mi_h') || unit.includes('[mi_i]')) return wind.value;
  return null;
}

export function getDisplayWindMph(observation, hourlyPeriods) {
  const obsMph = observationWindMph(observation);
  if (Number.isFinite(obsMph)) return Math.round(obsMph);

  const hourlyMph = parseNwsWindMph(getCurrentHourlyPeriod(hourlyPeriods)?.windSpeed);
  return Number.isFinite(hourlyMph) ? hourlyMph : '--';
}

export function getOpenMeteoHourlyIndex(hourly, now = new Date()) {
  if (!hourly?.time?.length) return -1;
  const nowMs = now.getTime();
  let bestIdx = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < hourly.time.length; i++) {
    const diff = Math.abs(new Date(hourly.time[i]).getTime() - nowMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestDiff <= 90 * 60000 ? bestIdx : -1;
}

export function getMinutelyPrecipCondition(minutelyData) {
  if (!minutelyData?.time?.length) return null;
  const now = Date.now();
  for (let i = 0; i < minutelyData.time.length; i++) {
    const slotTime = new Date(minutelyData.time[i]).getTime();
    const precip = minutelyData.precipitation?.[i] || 0;
    const chance = minutelyData.precipitation_probability?.[i] || 0;
    const minutesAway = (slotTime - now) / 60000;
    if (minutesAway <= 15 && minutesAway >= -15 && (precip >= 0.1 || chance >= 50)) {
      return precip >= 1.0 || chance >= 70 ? 'Rain' : 'Light Rain';
    }
  }
  return null;
}

export function getAlertCondition(alerts) {
  if (!alerts?.length) return null;
  const priority = [
    'Tornado Warning', 'Severe Thunderstorm Warning', 'Flash Flood Warning',
    'Thunderstorm Warning', 'Flood Warning', 'Special Weather Statement'
  ];
  for (const name of priority) {
    const match = alerts.find(a => (a.properties?.event || '').includes(name));
    if (match) return match.properties.event;
  }
  const severe = alerts.find(a => {
    const eventName = (a.properties?.event || '').toLowerCase();
    return eventName.includes('thunder') || eventName.includes('storm') || eventName.includes('tornado') || eventName.includes('flood');
  });
  return severe?.properties?.event || alerts[0]?.properties?.event || null;
}

function parseGridInterval(validTime) {
  const [startStr, durationStr] = validTime.split('/');
  const start = new Date(startStr);
  let endMs = start.getTime() + 3600000;
  const hourMatch = durationStr?.match(/PT(\d+)H/);
  if (hourMatch) endMs = start.getTime() + parseInt(hourMatch[1], 10) * 3600000;
  return { start: start.getTime(), end: endMs };
}

function getCurrentGridValue(values, now = Date.now()) {
  if (!values?.length) return null;
  for (const entry of values) {
    const { start, end } = parseGridInterval(entry.validTime);
    if (now >= start && now < end) return entry.value;
  }
  return null;
}

function formatGridWeatherCondition(weatherArray) {
  if (!weatherArray?.length) return null;
  const items = weatherArray.filter(w => w?.weather);
  if (!items.length) return null;

  const thunder = items.find(w => String(w.weather).includes('thunder'));
  if (thunder) {
    const coverage = (thunder.coverage || 'possible').replace(/_/g, ' ');
    return coverage.replace(/\b\w/g, c => c.toUpperCase()) + ' Thunderstorms';
  }

  const rain = items.find(w => {
    const weather = String(w.weather);
    return weather.includes('rain') || weather.includes('shower');
  });
  if (rain) {
    const parts = [rain.coverage, rain.intensity, rain.weather]
      .filter(Boolean)
      .map(s => String(s).replace(/_/g, ' '));
    return parts.join(' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  const first = items[0];
  return String(first.weather).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function getGridWeatherCandidate(gridData) {
  const weatherValues = gridData?.properties?.weather?.values;
  const currentWeather = getCurrentGridValue(weatherValues);
  const text = formatGridWeatherCondition(currentWeather);
  if (!text) return null;

  let severity = getConditionSeverity(text);
  const thunderProb = getCurrentGridValue(gridData?.properties?.probabilityOfThunder?.values);
  if (Number.isFinite(thunderProb) && thunderProb >= 15) severity += Math.min(25, Math.round(thunderProb / 2));

  const coverage = currentWeather?.find(w => w?.weather)?.coverage;
  if (coverage === 'likely' || coverage === 'definite' || coverage === 'occasional') severity += 20;
  else if (coverage === 'chance') severity += 12;
  else if (coverage === 'slight_chance' || coverage === 'isolated') severity += 6;

  return { text, severity, source: 'grid' };
}

export function getNearbyLightningCondition(lat, lon, maxKm = LIGHTNING_NEAR_KM, maxAgeMinutes = 30) {
  const cutoff = Date.now() - maxAgeMinutes * 60000;
  const recent = state.lightningStrikes.filter(s =>
    s.time >= cutoff && haversineKm(lat, lon, s.lat, s.lon) <= maxKm
  );
  if (!recent.length) return null;
  const closest = Math.min(...recent.map(s => haversineKm(lat, lon, s.lat, s.lon)));
  return closest <= LIGHTNING_STORM_KM ? 'Thunderstorms' : 'Thunderstorms Nearby';
}

export function resolveCurrentCondition(observation, hourlyPeriods, forecastPeriod, options = {}) {
  const { alerts = [], minutelyData = null, gridData = null, radarPrecip = null, lat = null, lon = null } = options;
  const hourlyNow = getCurrentHourlyPeriod(hourlyPeriods);
  const candidates = [];

  const obsText = observation?.textDescription;
  if (obsText) {
    candidates.push({ text: obsText, severity: getConditionSeverity(obsText), source: 'observation' });
  }

  const precipMm = getObservationPrecipMm(observation);
  if (precipMm > 0) {
    const precipText = precipMm >= 2.5 ? 'Rain' : 'Light Rain';
    candidates.push({ text: precipText, severity: getConditionSeverity(precipText) + 10, source: 'precip-obs' });
  }

  if (hourlyNow?.shortForecast) {
    const hourlyText = hourlyNow.shortForecast;
    let severity = getConditionSeverity(hourlyText);
    const precipChance = hourlyNow.probabilityOfPrecipitation?.value || 0;
    if (precipChance >= 50) severity += 15;
    else if (precipChance >= 30) severity += 5;
    candidates.push({ text: hourlyText, severity, source: 'hourly' });
  }

  const gridCandidate = getGridWeatherCandidate(gridData);
  if (gridCandidate) candidates.push(gridCandidate);

  const alertCond = getAlertCondition(alerts);
  if (alertCond) {
    candidates.push({ text: alertCond, severity: 90, source: 'alert' });
  }

  const minutelyCond = getMinutelyPrecipCondition(minutelyData);
  if (minutelyCond) {
    candidates.push({ text: minutelyCond, severity: getConditionSeverity(minutelyCond) + 15, source: 'minutely' });
  }

  if (radarPrecip?.text) {
    candidates.push({ text: radarPrecip.text, severity: radarPrecip.severity || 60, source: 'radar' });
  }

  if (lat !== null && lon !== null) {
    const lightningCond = getNearbyLightningCondition(lat, lon);
    if (lightningCond) {
      candidates.push({ text: lightningCond, severity: 75, source: 'lightning' });
    }
  }

  if (forecastPeriod?.shortForecast) {
    candidates.push({
      text: forecastPeriod.shortForecast,
      severity: getConditionSeverity(forecastPeriod.shortForecast) - 5,
      source: 'period'
    });
  }

  if (!candidates.length) return 'Unknown';

  const obsCandidate = candidates.find(c => c.source === 'observation');
  const best = candidates.reduce((a, b) => (b.severity > a.severity ? b : a));

  if (obsCandidate && !isObservationStale(observation)) {
    const skyOnly = !/rain|drizzle|shower|snow|sleet|thunder|storm|hail|freezing|ice/.test(obsCandidate.text.toLowerCase());
    if (best.source === 'alert' || best.source === 'precip-obs' || best.source === 'lightning') return best.text;
    if (best.source === 'radar' && (!skyOnly || best.severity >= 74)) return best.text;
    if (!skyOnly && best.severity >= obsCandidate.severity + 25) return best.text;
    if (!skyOnly && best.source === 'grid' && best.severity >= 55 && obsCandidate.severity < 35) return best.text;
    if (!skyOnly && best.source === 'hourly' && best.severity >= 50 && obsCandidate.severity < 30) return best.text;
    if (!skyOnly && best.source === 'minutely' && best.severity >= 50) return best.text;
    return obsCandidate.text;
  }

  return best.text;
}

export function isForecastPrecipCondition(text, precipChance = null) {
  if (!text) return false;
  const t = text.toLowerCase();
  if (!/rain|shower|drizzle|thunder|storm/.test(t)) return false;
  if (/^(heavy |light )?(rain|snow|sleet)\b/.test(t)) return false;
  if (/^thunderstorms?\b/.test(t) && !/chance|possible|slight|isolated|scattered/.test(t)) return false;
  if (Number.isFinite(precipChance) && precipChance >= 50) return false;
  return /chance|possible|slight|isolated|scattered/.test(t)
    || (Number.isFinite(precipChance) && precipChance < 50);
}

export function resolveMainCardCondition(observation, hourlyPeriods, forecastPeriod, options = {}) {
  const resolved = resolveCurrentCondition(observation, hourlyPeriods, forecastPeriod, options);
  const hourlyNow = getCurrentHourlyPeriod(hourlyPeriods);
  const precipChance = hourlyNow?.probabilityOfPrecipitation?.value ?? null;

  if (!isForecastPrecipCondition(resolved, precipChance)) return resolved;

  const obsText = observation?.textDescription?.trim();
  if (obsText && !isObservationStale(observation)) return obsText;

  const hourlyText = hourlyNow?.shortForecast || forecastPeriod?.shortForecast || '';
  const baseSky = hourlyText.split(/\s+then\s+/i)[0]?.trim();
  if (baseSky && !isForecastPrecipCondition(baseSky, precipChance)) return baseSky;

  return resolved;
}

export function shouldSuppressPrecipSummary(observation, hourlyPeriods, forecastPeriod, options = {}) {
  const resolved = resolveCurrentCondition(observation, hourlyPeriods, forecastPeriod, options);
  const hourlyNow = getCurrentHourlyPeriod(hourlyPeriods);
  const precipChance = hourlyNow?.probabilityOfPrecipitation?.value ?? null;
  const mainCard = resolveMainCardCondition(observation, hourlyPeriods, forecastPeriod, options);
  return isForecastPrecipCondition(resolved, precipChance) || mainCard !== resolved;
}

export function buildWeatherSummary(condition, windMph, tempF, options = {}) {
  const { suppressPrecipMessaging = false } = options;
  let summary = suppressPrecipMessaging ? '' : `${condition}. `;

  if (windMph < 8) summary += 'Light winds. ';
  else if (windMph < 15) summary += 'Gentle breeze. ';
  else summary += 'Breezy conditions. ';

  if (!suppressPrecipMessaging) {
    const condLower = (condition || '').toLowerCase();
    if (condLower.includes('thunder') || condLower.includes('tornado') || condLower.includes('storm')) {
      summary += 'Take shelter if storms approach.';
    } else if (condLower.includes('rain') || condLower.includes('shower') || condLower.includes('drizzle')) {
      summary += 'Wet conditions — bring an umbrella.';
    } else if (typeof tempF === 'number') {
      if (tempF >= 75) summary += 'Warm and pleasant.';
      else if (tempF >= 60) summary += 'Comfortable temperatures.';
      else if (tempF >= 45) summary += 'Cool and crisp.';
      else summary += 'Chilly conditions.';
    }
  } else if (typeof tempF === 'number') {
    if (tempF >= 75) summary += 'Warm and pleasant.';
    else if (tempF >= 60) summary += 'Comfortable temperatures.';
    else if (tempF >= 45) summary += 'Cool and crisp.';
    else summary += 'Chilly conditions.';
  }
  return summary.trim();
}

export function getFeelsLikeF(observation, tempF, cToF) {
  const heatC = observation?.heatIndex?.value;
  const chillC = observation?.windChill?.value;
  const tempC = observation?.temperature?.value;
  if (Number.isFinite(heatC) && Number.isFinite(tempC) && tempC >= 26.67) return cToF(heatC);
  if (Number.isFinite(chillC) && Number.isFinite(tempC) && tempC <= 10 && tempC >= -57) return cToF(chillC);
  return Number.isFinite(tempF) ? tempF : null;
}

export function aqiLabel(aqi) {
  if (!Number.isFinite(aqi)) return '--';
  if (aqi <= 50) return `${Math.round(aqi)} Good`;
  if (aqi <= 100) return `${Math.round(aqi)} Moderate`;
  if (aqi <= 150) return `${Math.round(aqi)} Unhealthy (sensitive)`;
  if (aqi <= 200) return `${Math.round(aqi)} Unhealthy`;
  return `${Math.round(aqi)} Very unhealthy`;
}

export function getMoonPhaseInfo(date = new Date()) {
  const synodic = 29.53058867;
  const ref = new Date('2000-01-06T18:14:00Z');
  const days = (date - ref) / 86400000;
  const phase = ((days % synodic) + synodic) % synodic;
  const illumination = Math.round((1 - Math.cos((2 * Math.PI * phase) / synodic)) * 50);
  const names = [
    'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
    'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'
  ];
  const index = Math.floor(((phase / synodic) + 0.0625) * 8) % 8;
  return { name: names[index], illumination, phase };
}

export function weatherBackgroundClass(condition, isDay = true) {
  const text = (condition || '').toLowerCase();
  if (text.includes('thunder') || text.includes('storm')) return 'weather-bg-storm';
  if (text.includes('snow') || text.includes('sleet') || text.includes('ice') || text.includes('blizzard')) return 'weather-bg-snow';
  if (text.includes('rain') || text.includes('shower') || text.includes('drizzle')) return 'weather-bg-rain';
  if (text.includes('cloud') || text.includes('overcast') || text.includes('fog') || text.includes('mist')) return 'weather-bg-cloudy';
  if (!isDay) return 'weather-bg-clear-night';
  return 'weather-bg-clear-day';
}
