import { FALLBACK_LOCATION, FAVORITES_STALE_MS } from './config.js';
import { getCurrentHourlyPeriod } from './conditions.js';
import { cToF, formatTempF, tempUnit } from './format.js';
import { fetchWithTimeout } from './net.js';
import { getPointsData, pickBestObservationStation } from './nws.js';
import { state } from './state.js';
import { showToast } from './ui.js';

export function homeOrFallbackLocation() {
  const home = state.favorites.find(f => f.isHome && Number.isFinite(Number(f.lat)) && Number.isFinite(Number(f.lon)));
  if (!home) return FALLBACK_LOCATION;
  return { name: home.name, lat: Number(home.lat), lon: Number(home.lon) };
}

export function loadFavorites() {
  const saved = localStorage.getItem('weatherFavorites');
  if (saved) {
    state.favorites = JSON.parse(saved);
  } else {
    state.favorites = [{
      name: FALLBACK_LOCATION.name,
      lat: FALLBACK_LOCATION.lat,
      lon: FALLBACK_LOCATION.lon,
      isHome: true
    }];
    saveFavorites();
  }
}

export function saveFavorites() {
  localStorage.setItem('weatherFavorites', JSON.stringify(state.favorites));
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

    const left = document.createElement('div');
    left.className = 'flex items-center gap-x-2';
    const iconEl = document.createElement('i');
    iconEl.className = fav.isHome ? 'fa-solid fa-home text-emerald-400' : 'fa-solid fa-map-marker-alt text-blue-400';
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
    btn.innerHTML = '<i class="fa-solid fa-times text-xs"></i>';
    btn.onclick = (event) => { event.stopImmediatePropagation(); removeFavorite(index); };
    pill.append(left, btn);
    pill.onclick = () => {
      document.dispatchEvent(new CustomEvent('weather:open-location', {
        detail: { lat: fav.lat, lon: fav.lon, name: fav.name }
      }));
    };
    container.appendChild(pill);
  });

  const addBtn = document.createElement('div');
  addBtn.className = 'flex-shrink-0 snap-start flex items-center justify-center bg-zinc-900 hover:bg-zinc-800 border border-white/10 px-4 py-2 rounded-3xl text-sm cursor-pointer text-blue-400';
  const addInner = document.createElement('div');
  addInner.className = 'flex items-center gap-x-2';
  const plusIcon = document.createElement('i');
  plusIcon.className = 'fa-solid fa-plus';
  const addText = document.createElement('span');
  addText.className = 'font-medium';
  addText.textContent = 'Add';
  addInner.append(plusIcon, addText);
  addBtn.appendChild(addInner);
  addBtn.onclick = () => addCurrentToFavorites();
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

export async function refreshFavoritesTemps(options = {}) {
  const { force = false, silent = false } = options;
  if (!state.favorites?.length) return;
  if (!force && silent && (Date.now() - state.favoritesLastRefreshAt) < FAVORITES_STALE_MS) {
    renderFavorites();
    return;
  }

  await Promise.all(state.favorites.map(async (fav) => {
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
    } catch (error) {
      fav.temp = null;
    }
  }));

  state.favoritesLastRefreshAt = Date.now();
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
