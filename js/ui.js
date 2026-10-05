import { HOURLY_FORECAST_HOURS, STALE_DATA_MS } from './config.js';
import {
  aqiLabel,
  buildWeatherSummary,
  describeHourlyPrecipInsight,
  getCurrentHourlyPeriod,
  getConditionSeverity,
  getDisplayWindMph,
  getFeelsLikeF,
  getMoonPhaseInfo,
  getOpenMeteoHourlyIndex,
  getTodayDayPeriod,
  getTodayLowTemp,
  getTonightLowFallback,
  getYesterdayTempAtSameTime,
  isCurrentlyDaytime,
  isDaytimeAt,
  isUpcomingHourlyPeriod,
  resolveCurrentCondition,
  resolveMainCardCondition,
  shouldSuppressPrecipSummary,
  weatherBackgroundClass
} from './conditions.js';
import { cToF, formatDate, formatDuration, formatTempF, formatTempLabel, tempUnit } from './format.js';
import { resolveTodayHighF } from './nws.js';
import { state } from './state.js';

export function showToast(message, type = 'info', duration = 2200) {
  const styles = {
    success: 'bg-emerald-600',
    error: 'bg-rose-600',
    warning: 'bg-amber-500',
    info: 'bg-blue-600'
  };
  const icons = {
    success: 'fa-check',
    error: 'fa-triangle-exclamation',
    warning: 'fa-circle-exclamation',
    info: 'fa-circle-info'
  };

  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-[min(90vw,360px)] pointer-events-none';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  const textClass = type === 'warning' ? 'text-zinc-900' : 'text-white';
  toast.className = `${styles[type] || styles.info} ${textClass} px-4 py-2.5 rounded-2xl text-sm flex items-center gap-x-2 shadow-xl border border-white/10 pointer-events-auto`;
  const iconEl = document.createElement('i');
  iconEl.className = `fa-solid ${icons[type] || icons.info}`;
  iconEl.setAttribute('aria-hidden', 'true');
  const msgSpan = document.createElement('span');
  msgSpan.textContent = message;
  toast.append(iconEl, msgSpan);
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'all 0.3s';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(12px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

export function setOfflineState(isOffline) {
  document.getElementById('offline-banner')?.classList.toggle('hidden', !isOffline);
}

export function updateStaleBanner() {
  const el = document.getElementById('stale-banner');
  const text = document.getElementById('stale-banner-text');
  if (!el || !state.lastWeatherFetchAt) {
    el?.classList.add('hidden');
    return;
  }
  const age = Date.now() - state.lastWeatherFetchAt;
  if (age < STALE_DATA_MS) {
    el.classList.add('hidden');
    return;
  }
  const when = new Date(state.lastWeatherFetchAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  text.textContent = `Showing data from ${when} — pull to refresh or tap the refresh button.`;
  el.classList.remove('hidden');
}

export function updateUnitToggleButton() {
  const btn = document.getElementById('unit-toggle-btn');
  if (btn) btn.textContent = state.useCelsius ? '°C' : '°F';
}

export function setSectionError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.replaceChildren();
  if (!message) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.append(document.createTextNode(`${message} `));
  const button = document.createElement('button');
  button.className = 'underline ml-1';
  button.type = 'button';
  button.textContent = 'Retry';
  button.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('weather:refresh'));
  });
  el.append(button);
}

export function getWeatherIcon(condition, isDay = true) {
  const iconEl = document.createElement('i');
  iconEl.setAttribute('aria-hidden', 'true');
  if (!condition) {
    iconEl.className = 'fa-solid fa-cloud text-zinc-300';
    return iconEl;
  }
  const text = condition.toLowerCase();
  if (text.includes('thunder') || text.includes('storm')) {
    iconEl.className = 'fa-solid fa-cloud-bolt text-yellow-400';
  } else if (text.includes('snow') || text.includes('sleet') || text.includes('blizzard') || text.includes('ice')) {
    iconEl.className = 'fa-solid fa-snowflake text-sky-300';
  } else if (text.includes('rain') || text.includes('shower') || text.includes('drizzle')) {
    iconEl.className = 'fa-solid fa-cloud-rain text-blue-400';
  } else if (text.includes('fog') || text.includes('mist') || text.includes('haze')) {
    iconEl.className = 'fa-solid fa-smog text-zinc-400';
  } else if (text.includes('partly') || text.includes('mostly sunny') || text.includes('mostly clear')) {
    iconEl.className = isDay ? 'fa-solid fa-cloud-sun text-blue-300' : 'fa-solid fa-cloud-moon text-indigo-300';
  } else if (text.includes('mostly cloudy') || text.includes('overcast') || text.includes('cloudy')) {
    iconEl.className = 'fa-solid fa-cloud text-zinc-300';
  } else if (text.includes('sunny') || text.includes('clear') || text.includes('fair')) {
    iconEl.className = isDay ? 'fa-solid fa-sun text-yellow-300' : 'fa-solid fa-moon text-indigo-300';
  } else {
    iconEl.className = isDay ? 'fa-solid fa-cloud-sun text-blue-300' : 'fa-solid fa-cloud-moon text-indigo-300';
  }
  return iconEl;
}

export function updateCurrentWeatherIcon() {
  const iconContainer = document.getElementById('current-icon');
  const condition = document.getElementById('current-condition')?.textContent;
  if (!iconContainer || !condition) return;
  iconContainer.replaceChildren(getWeatherIcon(condition, isCurrentlyDaytime()));
}

export function applyWeatherBackground(condition, isDay = true) {
  const card = document.getElementById('current-weather');
  if (!card) return;
  const classes = ['weather-bg-clear-day', 'weather-bg-clear-night', 'weather-bg-cloudy', 'weather-bg-rain', 'weather-bg-storm', 'weather-bg-snow'];
  card.classList.remove(...classes);
  card.classList.add(weatherBackgroundClass(condition, isDay));
}

export function refreshMainCardCondition(force = false) {
  if (!state.mainCardContext) return;
  const { observation, hourlyPeriods, forecastPeriod, options } = state.mainCardContext;
  const resolved = resolveCurrentCondition(observation, hourlyPeriods, forecastPeriod, options);
  const condition = resolveMainCardCondition(observation, hourlyPeriods, forecastPeriod, options);
  const currentSeverity = getConditionSeverity(document.getElementById('current-condition')?.textContent);
  if (!force && getConditionSeverity(resolved) <= currentSeverity) return;

  document.getElementById('current-condition').textContent = condition;
  const windMph = getDisplayWindMph(observation, hourlyPeriods);
  const tempF = parseInt(document.getElementById('current-temp')?.dataset?.tempF, 10);
  document.getElementById('weather-summary').textContent = buildWeatherSummary(
    condition,
    windMph,
    Number.isFinite(tempF) ? tempF : null,
    { suppressPrecipMessaging: shouldSuppressPrecipSummary(observation, hourlyPeriods, forecastPeriod, options) }
  );
  applyWeatherBackground(condition, isCurrentlyDaytime());
  updateCurrentWeatherIcon();
}

export function updateCurrentWeather(observation, forecastPeriod, locationName, allPeriods = [], hourlyPeriods = [], conditionOptions = {}) {
  document.getElementById('location-name').textContent = locationName;
  document.getElementById('current-date').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });

  const currentTempC = observation.temperature?.value;
  let currentTempF = null;
  if (Number.isFinite(currentTempC)) {
    currentTempF = cToF(currentTempC);
  } else {
    const hourlyNow = getCurrentHourlyPeriod(hourlyPeriods);
    console.warn('Observation temperature missing or invalid, falling back to hourly forecast temperature');
    currentTempF = hourlyNow?.temperature ?? forecastPeriod.temperature ?? '--';
  }
  const currentCondition = resolveMainCardCondition(observation, hourlyPeriods, forecastPeriod, conditionOptions);
  const windMph = getDisplayWindMph(observation, hourlyPeriods);
  const suppressPrecipSummary = shouldSuppressPrecipSummary(
    observation, hourlyPeriods, forecastPeriod, conditionOptions
  );

  state.mainCardContext = { observation, hourlyPeriods, forecastPeriod, options: conditionOptions };

  const tempEl = document.getElementById('current-temp');
  tempEl.textContent = typeof currentTempF === 'number' ? formatTempF(currentTempF) : currentTempF;
  if (typeof currentTempF === 'number') tempEl.dataset.tempF = String(currentTempF);
  document.querySelectorAll('.temp-unit-label').forEach(el => { el.textContent = tempUnit(); });
  document.getElementById('current-condition').textContent = currentCondition;
  document.getElementById('weather-summary').textContent = buildWeatherSummary(
    currentCondition,
    windMph,
    typeof currentTempF === 'number' ? currentTempF : null,
    { suppressPrecipMessaging: suppressPrecipSummary }
  );

  const todayLow = getTodayLowTemp(allPeriods);
  const dayPeriod = getTodayDayPeriod(allPeriods);
  const highF = resolveTodayHighF({
    dayPeriod,
    hourlyPeriods,
    observationTempF: typeof currentTempF === 'number' ? currentTempF : null,
    observedHighF: conditionOptions.observedHighF,
    lat: conditionOptions.lat ?? state.currentLat,
    lon: conditionOptions.lon ?? state.currentLon
  });
  const lowF = todayLow ?? getTonightLowFallback(allPeriods);
  document.getElementById('high-temp').textContent = Number.isFinite(highF) ? formatTempF(highF) + tempUnit() : '--';
  document.getElementById('low-temp').textContent = Number.isFinite(lowF) ? formatTempF(lowF) + tempUnit() : '--';

  applyWeatherBackground(currentCondition, isCurrentlyDaytime());

  const feelsF = getFeelsLikeF(observation, typeof currentTempF === 'number' ? currentTempF : null, cToF);
  document.getElementById('feels-like').textContent = Number.isFinite(feelsF) ? formatTempF(feelsF) : '--';

  document.getElementById('wind-speed').textContent = (windMph === '--') ? '--' : (windMph + ' mph');
  document.getElementById('humidity').textContent = observation.relativeHumidity && Number.isFinite(observation.relativeHumidity.value) ? Math.round(observation.relativeHumidity.value) + '%' : '--';
  document.getElementById('visibility').textContent = observation.visibility && Number.isFinite(observation.visibility.value) ? (observation.visibility.value / 1609).toFixed(1) + ' mi' : '--';

  updateCurrentWeatherIcon();
}

function formatHourlyWind(period) {
  const speed = (period.windSpeed || '').trim();
  const dir = (period.windDirection || '').trim();
  if (!speed && !dir) return '--';
  if (speed && dir) return `${speed} ${dir}`;
  return speed || dir;
}

export function updateHourlyForecast(periods, hours = HOURLY_FORECAST_HOURS) {
  const container = document.getElementById('hourly-forecast');
  if (!container) return;
  container.replaceChildren();

  (periods || []).slice(0, hours).forEach(period => {
    const time = new Date(period.startTime).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }).replace(':00', '');
    const div = document.createElement('div');
    div.className = 'hourly-card glass rounded-3xl p-4 text-center weather-card';

    const timeEl = document.createElement('div');
    timeEl.className = 'text-xs text-zinc-400 mb-1';
    timeEl.textContent = time;

    const iconWrap = document.createElement('div');
    iconWrap.className = 'text-4xl mb-3';
    iconWrap.appendChild(getWeatherIcon(period.shortForecast, isDaytimeAt(period.startTime)));

    const tempEl = document.createElement('div');
    tempEl.className = 'font-semibold text-2xl';
    tempEl.textContent = Number.isFinite(period.temperature) ? formatTempF(period.temperature) + tempUnit() : '--';

    const statsRow = document.createElement('div');
    statsRow.className = 'flex items-center justify-center gap-2.5 mt-2 text-[11px] leading-tight';

    const precipWrap = document.createElement('div');
    precipWrap.className = 'flex items-center gap-1 text-blue-300';
    precipWrap.title = 'Precipitation chance';
    const precipIcon = document.createElement('i');
    precipIcon.className = 'fa-solid fa-droplet text-[10px] opacity-90';
    precipIcon.setAttribute('aria-hidden', 'true');
    const precipVal = document.createElement('span');
    precipVal.textContent = `${period.probabilityOfPrecipitation?.value || 0}%`;
    precipWrap.append(precipIcon, precipVal);

    const windWrap = document.createElement('div');
    windWrap.className = 'flex items-center gap-1 text-zinc-400';
    windWrap.title = 'Wind';
    const windIcon = document.createElement('i');
    windIcon.className = 'fa-solid fa-wind text-[10px] opacity-90';
    windIcon.setAttribute('aria-hidden', 'true');
    const windVal = document.createElement('span');
    windVal.textContent = formatHourlyWind(period);
    windWrap.append(windIcon, windVal);

    statsRow.append(precipWrap, windWrap);
    div.append(timeEl, iconWrap, tempEl, statsRow);
    container.appendChild(div);
  });
}

export function updateDailyForecast(periods) {
  const container = document.getElementById('daily-forecast');
  if (!container) return;
  container.replaceChildren();

  const days = [];
  (periods || []).forEach(p => {
    const key = new Date(p.startTime).toDateString();
    if (!days.length || days[days.length - 1].dateKey !== key) {
      days.push({ dateKey: key, periods: [p] });
    } else {
      days[days.length - 1].periods.push(p);
    }
  });

  days.slice(0, 7).forEach(day => {
    const dayPeriod = day.periods.find(p => p.isDaytime) || day.periods[0];
    const nightPeriod = day.periods.find(p => !p.isDaytime) || day.periods[1] || day.periods[0];
    const temps = [Number(dayPeriod.temperature), Number(nightPeriod.temperature)].filter(t => Number.isFinite(t));
    const high = temps.length ? Math.max(...temps) : '--';
    const low = temps.length ? Math.min(...temps) : '--';
    const date = formatDate(dayPeriod.startTime);
    const condition = (dayPeriod && dayPeriod.shortForecast) || (nightPeriod && nightPeriod.shortForecast) || 'N/A';

    const div = document.createElement('div');
    div.className = 'daily-card glass rounded-3xl p-5 weather-card cursor-pointer hover:bg-white/5 transition-colors';

    const top = document.createElement('div');
    top.className = 'daily-card-top flex justify-between items-start';
    const left = document.createElement('div');
    const dateEl = document.createElement('div');
    dateEl.className = 'font-semibold leading-tight';
    dateEl.textContent = date;
    const nameEl = document.createElement('div');
    nameEl.className = 'text-xs text-zinc-400 mt-0.5';
    nameEl.textContent = dayPeriod.name || '';
    left.append(dateEl, nameEl);

    const right = document.createElement('div');
    right.className = 'text-right flex-shrink-0 ml-2';
    const highEl = document.createElement('div');
    highEl.className = 'text-4xl font-bold text-white leading-none';
    highEl.textContent = (high === '--') ? '--' : formatTempF(high) + tempUnit();
    const lowEl = document.createElement('div');
    lowEl.className = 'text-xs text-zinc-500 mt-1';
    lowEl.textContent = (low === '--') ? '--' : formatTempF(low) + tempUnit();
    right.append(highEl, lowEl);
    top.append(left, right);

    const bottom = document.createElement('div');
    bottom.className = 'daily-card-bottom';
    const iconWrap = document.createElement('div');
    iconWrap.className = 'daily-card-icon';
    iconWrap.appendChild(getWeatherIcon(condition, dayPeriod.isDaytime !== false));
    const info = document.createElement('div');
    info.className = 'daily-card-info';
    const condEl = document.createElement('div');
    condEl.className = 'daily-card-condition';
    condEl.textContent = condition;
    const precipEl = document.createElement('div');
    precipEl.className = 'daily-card-precip';
    precipEl.textContent = `${dayPeriod.probabilityOfPrecipitation?.value || 10}% chance`;
    info.append(condEl, precipEl);
    bottom.append(iconWrap, info);
    div.append(top, bottom);
    div.addEventListener('click', () => showForecastDetails(dayPeriod, nightPeriod));
    container.appendChild(div);
  });
}

function labeledStat(label, value) {
  const div = document.createElement('div');
  const span = document.createElement('span');
  span.className = 'text-zinc-400';
  span.textContent = label;
  div.append(span, document.createTextNode(` ${value}`));
  return div;
}

export function showForecastDetails(dayPeriod, nightPeriod) {
  const modal = document.getElementById('forecast-modal');
  const modalDate = document.getElementById('modal-date');
  const modalContent = document.getElementById('modal-content');
  modalDate.textContent = formatDate(dayPeriod.startTime);

  const dayDetails = dayPeriod.detailedForecast || dayPeriod.shortForecast || 'No details available.';
  const nightDetails = nightPeriod.detailedForecast || nightPeriod.shortForecast || 'No details available.';
  const dayPrecip = dayPeriod.probabilityOfPrecipitation?.value || 0;
  const nightPrecip = nightPeriod.probabilityOfPrecipitation?.value || 0;
  const dayWind = dayPeriod.windSpeed ? `${dayPeriod.windSpeed} ${dayPeriod.windDirection || ''}`.trim() : 'N/A';
  const nightWind = nightPeriod.windSpeed ? `${nightPeriod.windSpeed} ${nightPeriod.windDirection || ''}`.trim() : 'N/A';

  modalContent.replaceChildren();
  const daySection = document.createElement('div');
  daySection.className = 'border-b border-white/10 pb-3 mb-3';
  const dayTitle = document.createElement('div');
  dayTitle.className = 'text-sm font-medium text-amber-300 mb-1';
  dayTitle.textContent = 'Daytime';
  const dayText = document.createElement('div');
  dayText.className = 'text-xs text-zinc-300 mb-2';
  dayText.textContent = dayDetails;
  const dayGrid = document.createElement('div');
  dayGrid.className = 'grid grid-cols-2 gap-2 text-xs';
  dayGrid.append(
    labeledStat('High:', `${dayPeriod.temperature || '--'}°`),
    labeledStat('Precip:', `${dayPrecip}%`),
    labeledStat('Wind:', dayWind)
  );
  daySection.append(dayTitle, dayText, dayGrid);

  const nightSection = document.createElement('div');
  const nightTitle = document.createElement('div');
  nightTitle.className = 'text-sm font-medium text-indigo-300 mb-1';
  nightTitle.textContent = 'Nighttime';
  const nightText = document.createElement('div');
  nightText.className = 'text-xs text-zinc-300 mb-2';
  nightText.textContent = nightDetails;
  const nightGrid = document.createElement('div');
  nightGrid.className = 'grid grid-cols-2 gap-2 text-xs';
  nightGrid.append(
    labeledStat('Low:', `${nightPeriod.temperature || '--'}°`),
    labeledStat('Precip:', `${nightPrecip}%`),
    labeledStat('Wind:', nightWind)
  );
  nightSection.append(nightTitle, nightText, nightGrid);
  modalContent.append(daySection, nightSection);
  modal.classList.remove('hidden');
}

export function closeForecastModal() {
  document.getElementById('forecast-modal')?.classList.add('hidden');
}

export function updateRightNowInsight(ctx = {}) {
  const section = document.getElementById('right-now-insight');
  const textEl = document.getElementById('right-now-insight-text');
  const iconEl = document.getElementById('right-now-insight-icon');
  if (!section || !textEl) return;

  const lines = [];
  let severity = 'info';
  const { hourlyPeriods = [], minutelyData = null, currentTempF = null, openMeteoHourly = null, radarPrecip = null } = ctx;

  if (radarPrecip?.text) {
    lines.push(`Radar shows ${radarPrecip.text.toLowerCase()} at your location.`);
    severity = radarPrecip.text.toLowerCase().includes('thunder') ? 'storm' : 'rain';
  }

  if (minutelyData?.time?.length) {
    const now = Date.now();
    for (let i = 0; i < minutelyData.time.length; i++) {
      const slotTime = new Date(minutelyData.time[i]).getTime();
      const precip = minutelyData.precipitation?.[i] || 0;
      const chance = minutelyData.precipitation_probability?.[i] || 0;
      const minutesAway = Math.round((slotTime - now) / 60000);
      if (minutesAway <= 0 && (precip >= 0.1 || chance >= 55)) {
        lines.push('Precipitation detected in the next 15 minutes.');
        severity = 'rain';
        break;
      }
      if (minutesAway >= 0 && minutesAway <= 120 && (precip >= 0.1 || chance >= 55)) {
        lines.push(`Rain may start in about ${minutesAway} min.`);
        severity = 'rain';
        break;
      }
    }
  }

  const currentHour = getCurrentHourlyPeriod(hourlyPeriods);
  let precipInsight = currentHour ? describeHourlyPrecipInsight(currentHour, true) : null;

  if (!precipInsight) {
    const now = new Date();
    for (const period of (hourlyPeriods || []).slice(0, 24)) {
      if (!isUpcomingHourlyPeriod(period, now)) continue;
      if (currentHour && period.startTime === currentHour.startTime) continue;
      precipInsight = describeHourlyPrecipInsight(period, false, now);
      if (precipInsight) break;
    }
  }

  if (precipInsight) {
    lines.push(precipInsight.text);
    if (precipInsight.severity === 'storm' || (precipInsight.severity === 'rain' && severity === 'info')) {
      severity = precipInsight.severity;
    }
  } else if (!lines.length) {
    lines.push('No significant rain expected in the next 24 hours.');
  }

  if (Number.isFinite(currentTempF) && openMeteoHourly) {
    const yesterdayTemp = getYesterdayTempAtSameTime(openMeteoHourly);
    if (Number.isFinite(yesterdayTemp)) {
      const diff = Math.round(currentTempF - yesterdayTemp);
      if (Math.abs(diff) >= 2) {
        lines.push(diff > 0
          ? `${Math.abs(diff)}${tempUnit()} warmer than yesterday at this time.`
          : `${Math.abs(diff)}${tempUnit()} cooler than yesterday at this time.`);
      }
    }
  }

  section.classList.remove('hidden', 'rain-active', 'storm-active');
  if (severity === 'storm') {
    section.classList.add('storm-active');
    iconEl.className = 'fa-solid fa-cloud-bolt text-amber-200';
  } else if (severity === 'rain') {
    section.classList.add('rain-active');
    iconEl.className = 'fa-solid fa-cloud-rain text-blue-200';
  } else {
    iconEl.className = 'fa-solid fa-circle-info text-blue-200';
  }
  textEl.textContent = lines.slice(0, 2).join(' ');
}

export function updateExtrasFromOpenMeteo(openMeteoData, currentTempF) {
  const uvEl = document.getElementById('uv-index');
  const dewEl = document.getElementById('dew-point');
  const aqiEl = document.getElementById('air-quality');
  const current = openMeteoData?.current || {};
  const hourly = openMeteoData?.hourly || {};
  const hourIdx = getOpenMeteoHourlyIndex(hourly);
  const pickHourly = (key) => (hourIdx >= 0 ? hourly[key]?.[hourIdx] : undefined);

  if (uvEl) {
    const uv = current.uv_index ?? pickHourly('uv_index');
    uvEl.textContent = Number.isFinite(uv) ? Math.round(uv) : '--';
  }
  if (dewEl) {
    const dew = current.dew_point_2m ?? pickHourly('dew_point_2m');
    dewEl.textContent = Number.isFinite(dew) ? formatTempLabel(dew) : '--';
  }
  if (aqiEl) {
    const aqi = current.us_aqi ?? pickHourly('us_aqi');
    aqiEl.textContent = aqiLabel(aqi);
  }
}

export function updateMoonPhase(date = new Date()) {
  const info = getMoonPhaseInfo(date);
  const nameEl = document.getElementById('moon-phase-name');
  const detailEl = document.getElementById('moon-phase-detail');
  if (nameEl) nameEl.textContent = info.name;
  if (detailEl) detailEl.textContent = `${info.illumination}% lit`;
}

export function updateSunCard(sunrise, sunset) {
  const sunriseEl = document.getElementById('sunrise-time');
  const sunsetEl = document.getElementById('sunset-time');
  const lengthEl = document.getElementById('daylight-length');
  const remainingEl = document.getElementById('daylight-remaining');
  const progressEl = document.getElementById('daylight-progress');

  state.lastSunrise = sunrise;
  state.lastSunset = sunset;

  if (!sunrise || !sunset || Number.isNaN(sunrise.getTime()) || Number.isNaN(sunset.getTime())) {
    if (sunriseEl) sunriseEl.textContent = '--:--';
    if (sunsetEl) sunsetEl.textContent = '--:--';
    if (lengthEl) lengthEl.textContent = '--';
    if (remainingEl) remainingEl.textContent = 'Unavailable';
    if (progressEl) progressEl.style.width = '0%';
    return;
  }

  sunriseEl.textContent = sunrise.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  sunsetEl.textContent = sunset.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const daylightMs = Math.max(0, sunset.getTime() - sunrise.getTime());
  lengthEl.textContent = formatDuration(daylightMs);

  const now = Date.now();
  let progress = 0;
  if (now > sunrise.getTime() && daylightMs > 0) {
    progress = Math.min(1, (now - sunrise.getTime()) / daylightMs);
  }
  progressEl.style.width = `${Math.round(progress * 100)}%`;

  if (now < sunrise.getTime()) {
    remainingEl.textContent = `Sunrise in ${formatDuration(sunrise.getTime() - now)}`;
  } else if (now <= sunset.getTime()) {
    remainingEl.textContent = `${formatDuration(sunset.getTime() - now)} of daylight left`;
  } else {
    remainingEl.textContent = 'Daylight ended';
  }

  const condition = document.getElementById('current-condition')?.textContent;
  if (condition) {
    applyWeatherBackground(condition, isCurrentlyDaytime());
    updateCurrentWeatherIcon();
  }
}
