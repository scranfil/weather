import { FALLBACK_LOCATION, FAVORITES_STALE_MS } from './config.js';
import { getCurrentHourlyPeriod } from './conditions.js';
import { cToF, formatTempF, tempUnit } from './format.js';
import { fetchWithTimeout } from './net.js';
import { getPointsData, pickBestObservationStation } from './nws.js';
import { state } from './state.js';
import { showToast } from './ui.js';

const FAVORITE_REFRESH_CONCURRENCY = 3;

function isValidFavorite(entry) {
  return entry
    && typeof entry === 'object'
    && typeof entry.name === 'string'
    && Number.isFinite(Number(entry.lat))
    && Number.isFinite(Number(entry.lon));
}

function normalizeFavorite(entry) {
  return {
    name: String(entry.name),
    lat: Number(entry.lat),
    lon: Number(entry.lon),
    isHome: Boolean(entry.isHome),
    temp: Number.isFinite(Number(entry.temp)) ? Number(entry.temp) : (entry.temp ?? null),
    tempUpdatedAt: Number.isFinite(Number(entry.tempUpdatedAt)) ? Number(entry.tempUpdatedAt) : undefined
  };
}

function defaultFavorites() {
  return [{
    name: FALLBACK_LOCATION.name,
    lat: FALLBACK_LOCATION.lat,
    lon: FALLBACK_LOCATION.lon,
    isHome: true
  }];
}

export function homeOrFallbackLocation() {
  const home = state.favorites.find(f => f.isHome && Number.isFinite(Number(f.lat)) && Number.isFinite(Number(f.lon)));
  if (!home) return FALLBACK_LOCATION;
  return { name: home.name, lat: Number(home.lat), lon: Number(home.lon) };
}

export function loadFavorites() {
  const saved = localStorage.getItem('weatherFavorites');
  if (!saved) {
    state.favorites = defaultFavorites();
    saveFavorites();
    return;
  }
  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) throw new Error('invalid favorites');
    const normalized = parsed.filter(isValidFavorite).map(normalizeFavorite);
    state.favorites = normalized.length ? normalized : defaultFavorites();
    if (normalized.length !== parsed.length) saveFavorites();
  } catch {
    state.favorites = defaultFavorites();
    saveFavorites();
  }
}

export function saveFavorites() {
  try {
    localStorage.setItem('weatherFavorites', JSON.stringify(state.favorites));
  } catch {
    // ignore quota failures
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

export function renderFavorites() {
  const container = document.getElementById('favorites-bar');
  if (!container) return;
  container.replaceChildren();

  const sorted = [...state.favorites].sort((a, b) => (b.isHome ? 1 : 0) - (a.isHome ? 1 : 0));

  sorted.forEach((fav) => {
    const index = state.favorites.indexOf(fav);
    const pill = document.createElement('div');
    pill.className = `favorite-pill flex-shrink-0 snap-start flex items-center gap-x-2 bg-zinc-900 hover:bg-zinc-800 border border-white/10 px-4 py-2 rounded-3xl text-sm cursor-pointer${fav.isHome ? ' is-home' : ''}`;
    pill.setAttribute('role', 'button');
    pill.tabIndex = 0;

    const left = document.createElement('div');
    left.className = 'flex items-center gap-x-2';
    const iconEl = document.createElement('i');
    iconEl.className = fav.isHome ? 'fa-solid fa-home text-emerald-400' : 'fa-solid fa-map-marker-alt text-blue-400';
    iconEl.setAttribute('aria-hidden', 'true');
    const nameWrap = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.className = 'font-medium text-white';
    nameEl.textContent = fav.name;
    const subRow = document.createElement('div');
    subRow.className = 'flex items-center gap-x-1 text-xs';
    const tempSpan = document.createElement('span');
    tempSpan.className = 'font-semibold text-orange-400';
    tempSpan.textContent = Number.isFinite(fav.temp) ? formatTempF(fav.temp) + tempUnit() : '--';
    subRow.appendChild(tempSpan);
    nameWrap.append(nameEl, subRow);
    left.append(iconEl, nameWrap);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ml-1 w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-red-400 transition-colors';
    btn.setAttribute('aria-label', `Remove ${fav.name}`);
    const timesIcon = document.createElement('i');
    timesIcon.className = 'fa-solid fa-times text-xs';
    timesIcon.setAttribute('aria-hidden', 'true');
    btn.appendChild(timesIcon);
    btn.onclick = (event) => { event.stopImmediatePropagation(); removeFavorite(index); };
    pill.append(left, btn);
    const openFavorite = () => {
      document.dispatchEvent(new CustomEvent('weather:open-location', {
        detail: { lat: fav.lat, lon: fav.lon, name: fav.name }
      }));
    };
    pill.onclick = openFavorite;
    pill.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openFavorite();
      }
    });
    container.appendChild(pill);
  });

  const addBtn = document.createElement('div');
  addBtn.className = 'flex-shrink-0 snap-start flex items-center justify-center bg-zinc-900 hover:bg-zinc-800 border border-white/10 px-4 py-2 rounded-3xl text-sm cursor-pointer text-blue-400';
  addBtn.setAttribute('role', 'button');
  addBtn.tabIndex = 0;
  addBtn.setAttribute('aria-label', 'Add current location to favorites');
  const addInner = document.createElement('div');
  addInner.className = 'flex items-center gap-x-2';
  const plusIcon = document.createElement('i');
  plusIcon.className = 'fa-solid fa-plus';
  plusIcon.setAttribute('aria-hidden', 'true');
  const addText = document.createElement('span');
  addText.className = 'font-medium';
  addText.textContent = 'Add';
  addInner.append(plusIcon, addText);
  addBtn.appendChild(addInner);
  addBtn.onclick = () => addCurrentToFavorites();
  addBtn.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      addCurrentToFavorites();
    }
  });
  container.appendChild(addBtn);
}

export function noteFavoriteObservation(lat, lon, tempF) {
  if (!Number.isFinite(tempF)) return;
  const fav = state.favorites.find(f => Math.abs(f.lat - lat) < 0.01 && Math.abs(f.lon - lon) < 0.01);
  if (!fav) return;
  fav.temp = tempF;
  fav.tempUpdatedAt = Date.now();
  saveFavorites();
}

async function refreshOneFavoriteTemp(fav, force) {
  if (!force && fav.tempUpdatedAt && (Date.now() - fav.tempUpdatedAt) < FAVORITES_STALE_MS) return;
  try {
    const pointsData = await getPointsData(fav.lat, fav.lon);
    const stationUrl = pointsData.properties.observationStations;
    if (stationUrl) {
      const stationsRes = await fetchWithTimeout(stationUrl, {}, 8000);
      if (stationsRes.ok) {
        const stationsData = await stationsRes.json();
        const obsResult = await pickBestObservationStation(stationsData, fav.lat, fav.lon);
        const tempC = obsResult?.props?.temperature?.value;
        if (Number.isFinite(tempC)) {
          fav.temp = cToF(tempC);
          fav.tempUpdatedAt = Date.now();
          return;
        }
      }
    }
    const hourlyUrl = pointsData.properties.forecastHourly;
    if (hourlyUrl) {
      const hourlyRes = await fetchWithTimeout(hourlyUrl, {}, 8000);
      if (hourlyRes.ok) {
        const hourlyData = await hourlyRes.json();
        const nowPeriod = getCurrentHourlyPeriod(hourlyData.properties?.periods || []);
        if (nowPeriod && Number.isFinite(nowPeriod.temperature)) {
          fav.temp = nowPeriod.temperature;
          fav.tempUpdatedAt = Date.now();
          return;
        }
      }
    }
    fav.temp = null;
  } catch {
    fav.temp = null;
  }
}

export async function refreshFavoritesTemps(options = {}) {
  const { force = false, silent = false } = options;
  if (!state.favorites?.length) return;
  if (!force && silent && (Date.now() - state.favoritesLastRefreshAt) < FAVORITES_STALE_MS) {
    renderFavorites();
    return;
  }

  await mapWithConcurrency(state.favorites, FAVORITE_REFRESH_CONCURRENCY, (fav) => refreshOneFavoriteTemp(fav, force));

  state.favoritesLastRefreshAt = Date.now();
  saveFavorites();
  renderFavorites();
}

export function goHome() {
  const home = state.favorites.find(f => f.isHome);
  if (home) {
    document.dispatchEvent(new CustomEvent('weather:open-location', {
      detail: { lat: home.lat, lon: home.lon, name: home.name }
    }));
  } else {
    showToast('Set a Home location first.', 'warning');
  }
}

export function removeFavorite(index) {
  if (state.favorites[index].isHome) {
    if (!confirm('Remove your Home location?')) return;
  }
  state.favorites.splice(index, 1);
  saveFavorites();
  renderFavorites();
}

export function setHomeFromCurrent() {
  if (!state.currentLocationName || state.currentLocationName === 'Getting your location...') {
    showToast('Wait for your location to load first.', 'warning');
    return;
  }

  let snapTemp = '--';
  const tempF = parseInt(document.getElementById('current-temp')?.dataset?.tempF, 10);
  if (Number.isFinite(tempF)) snapTemp = tempF;

  const entry = {
    name: state.currentLocationName,
    lat: state.currentLat,
    lon: state.currentLon,
    isHome: true,
    temp: snapTemp
  };

  const homeIndex = state.favorites.findIndex(f => f.isHome);
  if (homeIndex >= 0) {
    state.favorites[homeIndex] = entry;
  } else {
    state.favorites.unshift(entry);
  }

  saveFavorites();
  renderFavorites();
  refreshFavoritesTemps().catch(() => {});
  showToast('Home location updated', 'success', 1500);
}

export function addCurrentToFavorites() {
  const exists = state.favorites.find(f =>
    Math.abs(f.lat - state.currentLat) < 0.01 && Math.abs(f.lon - state.currentLon) < 0.01
  );
  if (exists) {
    showToast('This location is already in your favorites.', 'warning');
    return;
  }

  let snapTemp = null;
  const tempF = parseInt(document.getElementById('current-temp')?.dataset?.tempF, 10);
  if (Number.isFinite(tempF)) snapTemp = tempF;

  state.favorites.push({
    name: state.currentLocationName,
    lat: state.currentLat,
    lon: state.currentLon,
    isHome: false,
    temp: snapTemp !== null ? snapTemp : '--'
  });

  saveFavorites();
  renderFavorites();
  refreshFavoritesTemps().catch(() => {});
  showToast('Added to favorites', 'success', 1500);
}

export function maybePromptSetHome() {
  if (localStorage.getItem('homePromptDismissed')) return;
  const onlyDefaultHome = state.favorites.length === 1 && state.favorites[0].isHome
    && Math.abs(state.favorites[0].lat - FALLBACK_LOCATION.lat) < 0.01;
  if (!onlyDefaultHome) return;
  showToast('Tip: tap Set Home to save your current location.', 'info', 3200);
  localStorage.setItem('homePromptDismissed', '1');
}
