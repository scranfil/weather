import {
  BLITZORTUNG_SERVERS,
  cartoBasemapKey,
  LIGHTNING_MAX_AGE_MS,
  RADAR_COLOR_SCHEME,
  RADAR_DEFAULT_ZOOM,
  RADAR_TILE_OPTIONS,
  RADAR_LOCAL_ZOOM,
  RADAR_TILE_MAX_ZOOM,
  RADAR_TILE_SIZE,
  RADAR_ZOOM_OFFSET
} from './config.js';
import { haversineKm } from './conditions.js';
import { fetchWithTimeout } from './net.js';
import { state } from './state.js';
import { refreshMainCardCondition, updateRightNowInsight } from './ui.js';

const L = globalThis.L;

let radarMap = null;
let radarFrames = [];
let radarCurrentFrame = 0;
let radarPlayInterval = null;
let radarLayers = {};
let radarPastCount = 0;
let radarLoopMode = 'all';
let radarSpeedMs = 600;
let radarLocationMarker = null;
let radarLastLat = null;
let radarLastLon = null;
let alertPolygonLayer = null;
let lightningLayerGroup = null;
let lightningEnabled = false;
let lightningSocket = null;
let lightningFeedActive = false;
let lightningServerIndex = 0;

function latLonToTileXY(lat, lon, zoom) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y, n };
}

function latLonToPixelInTile(lat, lon, zoom, tileX, tileY, tileSize = 512) {
  const n = 2 ** zoom;
  const xFloat = ((lon + 180) / 360) * n;
  const latRad = lat * Math.PI / 180;
  const yFloat = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  return {
    px: Math.max(0, Math.min(tileSize - 1, Math.floor((xFloat - tileX) * tileSize))),
    py: Math.max(0, Math.min(tileSize - 1, Math.floor((yFloat - tileY) * tileSize)))
  };
}

export function isDisplayedPrecip(r, g, b, a) {
  if (a < 40) return false;
  if (b > r + 12 && b > 60) return true;
  if (g > r + 20 && g > b && g > 70) return true;
  if (r > 160 && g > 70 && b < 110 && r > b + 40) return true;
  if (r > 160 && g < 110 && b < 110) return true;
  if (r > 90 && b > 90 && g < 110 && b > g + 20) return true;
  return false;
}

function interpretRadarPixel(r, g, b, a) {
  if (a < 120) return null;
  if (r > 140 && b > 120 && g < 100) return { text: 'Thunderstorms', severity: 85 };
  if (r > 180 && g < 90 && b < 90) return { text: 'Heavy Rain', severity: 74 };
  if (r > 180 && g > 140 && b < 80) return { text: 'Rain', severity: 64 };
  if (g > r + 40 && g > b + 30 && g > 90) return { text: 'Light Rain', severity: 52 };
  return null;
}

export function sampleRadarPrecipAt(lat, lon) {
  if (!radarFrames.length || radarPastCount < 1) return Promise.resolve(null);
  const frame = radarFrames[Math.max(0, radarPastCount - 1)];
  const z = RADAR_TILE_MAX_ZOOM;
  const { x, y } = latLonToTileXY(lat, lon, z);
  const { px, py } = latLonToPixelInTile(lat, lon, z, x, y, RADAR_TILE_SIZE);
  const url = `${frame.host}${frame.path}/${RADAR_TILE_SIZE}/${z}/${x}/${y}/${RADAR_COLOR_SCHEME}/${RADAR_TILE_OPTIONS}.png`;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, px - 4, py - 4, 8, 8, 0, 0, 8, 8);
        const data = ctx.getImageData(0, 0, 8, 8).data;
        let best = null;
        for (let i = 0; i < data.length; i += 4) {
          const hit = interpretRadarPixel(data[i], data[i + 1], data[i + 2], data[i + 3]);
          if (hit && (!best || hit.severity > best.severity)) best = hit;
        }
        resolve(best);
      } catch (error) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function decodeBlitzortungMessage(data) {
  const e = {};
  const d = [...data];
  let c = d[0];
  let f = c;
  const g = [c];
  let h = 256;
  let o = h;
  for (let i = 1; i < d.length; i++) {
    let a = d.charCodeAt(i);
    a = (h > a) ? d[i] : (e[a] ?? (f + c));
    g.push(a);
    c = a[0];
    e[o] = f + c;
    o++;
    f = a;
  }
  return g.join('');
}

function parseLightningStrike(raw) {
  try {
    const decoded = decodeBlitzortungMessage(raw);
    const payload = JSON.parse(decoded);
    if (Array.isArray(payload)) {
      const [, lat, lon] = payload;
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, time: Date.now() };
    }
    if (payload && Number.isFinite(payload.lat) && Number.isFinite(payload.lon)) {
      return { lat: payload.lat, lon: payload.lon, time: Date.now() };
    }
  } catch (error) {
    return null;
  }
  return null;
}

function isStrikeNearLocation(strike, lat, lon, maxKm = 80) {
  return haversineKm(lat, lon, strike.lat, strike.lon) <= maxKm;
}

export function pruneLightningStrikes() {
  const cutoff = Date.now() - LIGHTNING_MAX_AGE_MS;
  state.lightningStrikes = state.lightningStrikes.filter(s => s.time >= cutoff);
}

export function renderLightningStrikes() {
  if (!radarMap || !lightningLayerGroup || !lightningEnabled || !L) return;
  lightningLayerGroup.clearLayers();
  pruneLightningStrikes();
  state.lightningStrikes.forEach(strike => {
    const age = Date.now() - strike.time;
    const opacity = Math.max(0.25, 1 - (age / LIGHTNING_MAX_AGE_MS));
    L.circleMarker([strike.lat, strike.lon], {
      radius: 4,
      fillColor: '#fbbf24',
      color: '#ffffff',
      weight: 1,
      opacity,
      fillOpacity: opacity
    }).addTo(lightningLayerGroup);
  });
  const status = document.getElementById('lightning-status');
  if (status) status.textContent = state.lightningStrikes.length ? `${state.lightningStrikes.length} strikes` : 'Listening…';
}

function ensureLightningFeed() {
  if (lightningSocket || !lightningFeedActive) return;
  const url = BLITZORTUNG_SERVERS[lightningServerIndex % BLITZORTUNG_SERVERS.length];
  try {
    lightningSocket = new WebSocket(url);
  } catch (error) {
    return;
  }

  lightningSocket.onopen = () => {
    lightningSocket.send(JSON.stringify({ a: 111 }));
    const status = document.getElementById('lightning-status');
    if (status && lightningEnabled) status.textContent = 'Connected';
  };

  lightningSocket.onmessage = (event) => {
    const strike = parseLightningStrike(event.data);
    if (!strike || !isStrikeNearLocation(strike, state.currentLat, state.currentLon)) return;
    state.lightningStrikes.push(strike);
    renderLightningStrikes();
    refreshMainCardCondition();
    updateRightNowInsight({
      hourlyPeriods: state.lastHourlyPeriods,
      radarPrecip: state.mainCardContext?.options?.radarPrecip,
      currentTempF: parseInt(document.getElementById('current-temp')?.dataset?.tempF, 10),
      openMeteoHourly: state.lastOpenMeteoData?.hourly,
      minutelyData: state.lastOpenMeteoData?.minutely_15
    });
  };

  lightningSocket.onclose = () => {
    lightningSocket = null;
    if (!lightningFeedActive) return;
    lightningServerIndex++;
    setTimeout(ensureLightningFeed, 2500);
  };

  lightningSocket.onerror = () => {
    if (lightningSocket) lightningSocket.close();
  };
}

export function startPassiveLightningFeed() {
  lightningFeedActive = true;
  ensureLightningFeed();
}

export function toggleLightningLayer() {
  lightningEnabled = !lightningEnabled;
  const btn = document.getElementById('radar-lightning-btn');
  if (btn) btn.classList.toggle('bg-amber-500/20', lightningEnabled);
  ensureLightningFeed();
  if (lightningEnabled) renderLightningStrikes();
  else if (lightningLayerGroup) lightningLayerGroup.clearLayers();
  const status = document.getElementById('lightning-status');
  if (status) status.textContent = lightningEnabled ? (state.lightningStrikes.length ? `${state.lightningStrikes.length} strikes` : 'Listening…') : '';
}

export function updateAlertPolygons(features) {
  if (!radarMap || !L) return;
  if (!alertPolygonLayer) {
    alertPolygonLayer = L.layerGroup().addTo(radarMap);
  }
  alertPolygonLayer.clearLayers();

  (features || []).forEach(feature => {
    if (!feature.geometry) return;
    const props = feature.properties || {};
    const severity = (props.severity || '').toLowerCase();
    const color = severity.includes('extreme') || severity.includes('severe') ? '#ef4444'
      : severity.includes('moderate') ? '#f59e0b' : '#60a5fa';
    L.geoJSON(feature, {
      style: {
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.18
      }
    }).bindTooltip(props.event || 'Weather Alert', { sticky: true }).addTo(alertPolygonLayer);
  });
}

let PrecipRadarLayer = null;

function getPrecipRadarLayer() {
  if (!PrecipRadarLayer) {
    PrecipRadarLayer = L.TileLayer.extend({
      createTile(coords, done) {
        const tile = document.createElement('canvas');
        const size = this.getTileSize();
        tile.width = size.x;
        tile.height = size.y;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const ctx = tile.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, tile.width, tile.height);
            const image = ctx.getImageData(0, 0, tile.width, tile.height);
            const data = image.data;
            for (let i = 0; i < data.length; i += 4) {
              if (!isDisplayedPrecip(data[i], data[i + 1], data[i + 2], data[i + 3])) data[i + 3] = 0;
            }
            ctx.putImageData(image, 0, 0);
            done(null, tile);
          } catch (error) {
            done(error, tile);
          }
        };
        img.onerror = () => done(new Error('radar tile failed'), tile);
        img.src = this.getTileUrl(coords);
        return tile;
      }
    });
  }
  return PrecipRadarLayer;
}

function buildRadarTileLayer(frame) {
  const Layer = getPrecipRadarLayer();
  return new Layer(
    `${frame.host}${frame.path}/${RADAR_TILE_SIZE}/{z}/{x}/{y}/${RADAR_COLOR_SCHEME}/${RADAR_TILE_OPTIONS}.png`,
    {
      opacity: 0.9,
      zIndex: 10,
      tileSize: RADAR_TILE_SIZE,
      zoomOffset: RADAR_ZOOM_OFFSET,
      maxNativeZoom: RADAR_TILE_MAX_ZOOM - RADAR_ZOOM_OFFSET,
      maxZoom: 13,
      minZoom: 2,
      updateWhenZooming: true,
      keepBuffer: 2
    }
  );
}

export function setRadarView(lat, lon, zoom = null) {
  if (!radarMap) return;
  const targetZoom = zoom ?? radarMap.getZoom() ?? RADAR_DEFAULT_ZOOM;
  radarMap.setView([lat, lon], targetZoom, { animate: true });
  setTimeout(() => radarMap.invalidateSize(), 120);
}

export function primeRadarForLocation(lat, lon) {
  radarLastLat = lat;
  radarLastLon = lon;
  if (!radarMap) return;
  setRadarView(lat, lon, RADAR_DEFAULT_ZOOM);
  if (radarLocationMarker) radarLocationMarker.setLatLng([lat, lon]);
}

export function radarFramesFromCatalog(data) {
  const host = data?.host || '';
  const past = data?.radar?.past || [];
  const nowcast = data?.radar?.nowcast || [];
  return {
    pastCount: past.length,
    forecastCount: nowcast.length,
    frames: [
      ...past.map(frame => ({ ...frame, host, type: 'past' })),
      ...nowcast.map(frame => ({ ...frame, host, type: 'forecast' }))
    ]
  };
}

function applyForecastLoopUi(forecastCount) {
  const showForecast = forecastCount > 0;
  const loop = document.getElementById('radar-loop');
  const option = loop?.querySelector('option[value="forecast"]');
  if (option) option.hidden = !showForecast;
  const legend = document.getElementById('radar-forecast-legend');
  if (legend) legend.hidden = !showForecast;
  if (!showForecast && radarLoopMode === 'forecast') {
    radarLoopMode = 'all';
    if (loop) loop.value = 'all';
  }
}

export async function loadRadarFrames() {
  try {
    const res = await fetchWithTimeout('https://api.rainviewer.com/public/weather-maps.json', {}, 8000);
    const data = await res.json();
    const catalog = radarFramesFromCatalog(data);

    Object.values(radarLayers).forEach(layer => { if (radarMap.hasLayer(layer)) radarMap.removeLayer(layer); });
    radarLayers = {};

    radarPastCount = catalog.pastCount;
    radarFrames = catalog.frames;
    applyForecastLoopUi(catalog.forecastCount);

    radarFrames.forEach((frame, i) => {
      radarLayers[i] = buildRadarTileLayer(frame);
    });

    const slider = document.getElementById('radar-slider');
    slider.max = Math.max(0, radarFrames.length - 1);
    const startFrame = Math.max(0, radarPastCount - 1);
    slider.value = startFrame;
    showRadarFrame(startFrame);
    return true;
  } catch (error) {
    console.error('Radar load failed', error);
    const label = document.getElementById('radar-time-label');
    if (label) label.textContent = 'Radar unavailable';
    return false;
  }
}

export async function updateRadarMap(lat, lon, options = {}) {
  const { resetZoom = false } = options;
  if (!L) throw new Error('Map library failed to load');
  radarLastLat = lat;
  radarLastLon = lon;
  if (!radarMap) {
    radarMap = L.map('radar-map', {
      center: [lat, lon],
      zoom: RADAR_DEFAULT_ZOOM,
      zoomControl: true,
      minZoom: 4,
      maxZoom: 13
    });
    L.tileLayer(`https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${cartoBasemapKey()}`, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions/">CARTO</a>',
      maxZoom: 19,
      maxNativeZoom: 19
    }).addTo(radarMap);
    lightningLayerGroup = L.layerGroup().addTo(radarMap);
    alertPolygonLayer = L.layerGroup().addTo(radarMap);
    radarMap.on('zoomend', () => {
      const active = radarLayers[radarCurrentFrame];
      if (active && radarMap.hasLayer(active)) active.redraw();
    });
  } else {
    setRadarView(lat, lon, resetZoom ? RADAR_DEFAULT_ZOOM : null);
  }

  if (radarLocationMarker) {
    radarLocationMarker.setLatLng([lat, lon]);
  } else {
    radarLocationMarker = L.circleMarker([lat, lon], {
      radius: 8,
      fillColor: '#ffb347',
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9
    }).addTo(radarMap).bindTooltip('Your location', { permanent: false, offset: [0, -12] });
  }

  await loadRadarFrames();
}

function getAllowedRadarIndexes() {
  if (!radarFrames.length) return [];
  if (radarLoopMode === 'past') {
    return Array.from({ length: radarPastCount }, (_, i) => i);
  }
  if (radarLoopMode === 'forecast') {
    const forecastCount = radarFrames.length - radarPastCount;
    if (forecastCount <= 0) {
      return Array.from({ length: radarFrames.length }, (_, i) => i);
    }
    return Array.from({ length: forecastCount }, (_, i) => i + radarPastCount);
  }
  return Array.from({ length: radarFrames.length }, (_, i) => i);
}

function showRadarFrame(index) {
  if (!radarMap) return;
  Object.values(radarLayers).forEach(layer => { if (radarMap.hasLayer(layer)) radarMap.removeLayer(layer); });
  if (radarLayers[index]) {
    radarLayers[index].addTo(radarMap);
    radarLayers[index].redraw();
  }
  radarCurrentFrame = index;
  const slider = document.getElementById('radar-slider');
  if (slider) slider.value = index;
  const frame = radarFrames[index];
  if (frame) {
    const d = new Date(frame.time * 1000);
    const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const typeLabel = frame.type === 'forecast' ? ' · Forecast' : ' · Past';
    const timeLabel = document.getElementById('radar-time-label');
    const countLabel = document.getElementById('radar-frame-count');
    if (timeLabel) timeLabel.textContent = timeStr + typeLabel;
    if (countLabel) countLabel.textContent = `${index + 1} / ${radarFrames.length}`;
  }
}

function moveToLatestObservedFrame() {
  if (!radarFrames.length) return;
  showRadarFrame(Math.max(0, radarPastCount - 1));
}

function advanceRadarFrame() {
  const allowed = getAllowedRadarIndexes();
  if (!allowed.length) return;
  const currentPos = allowed.indexOf(radarCurrentFrame);
  const nextPos = currentPos === -1 ? 0 : (currentPos + 1) % allowed.length;
  showRadarFrame(allowed[nextPos]);
}

function restartRadarPlaybackIfNeeded() {
  if (!radarPlayInterval) return;
  clearInterval(radarPlayInterval);
  radarPlayInterval = setInterval(() => {
    advanceRadarFrame();
  }, radarSpeedMs);
}

function toggleRadarPlay() {
  if (!radarFrames.length) return;
  const playBtn = document.getElementById('radar-play-btn');
  if (radarPlayInterval) {
    clearInterval(radarPlayInterval);
    radarPlayInterval = null;
    if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-play text-xs"></i>';
  } else {
    if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-pause text-xs"></i>';
    radarPlayInterval = setInterval(() => {
      advanceRadarFrame();
    }, radarSpeedMs);
  }
}

export function resetLocationScopedUI() {
  if (radarPlayInterval) {
    clearInterval(radarPlayInterval);
    radarPlayInterval = null;
    const playBtn = document.getElementById('radar-play-btn');
    if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-play text-xs"></i>';
  }
  state.lightningStrikes = [];
  if (lightningLayerGroup) lightningLayerGroup.clearLayers();
  if (alertPolygonLayer) alertPolygonLayer.clearLayers();
  const alertsSection = document.getElementById('alerts-section');
  const alertsList = document.getElementById('alerts-list');
  if (alertsSection) alertsSection.classList.add('hidden');
  if (alertsList) alertsList.innerHTML = '';
}

export function bindRadarControls() {
  document.getElementById('radar-play-btn')?.addEventListener('click', toggleRadarPlay);
  document.getElementById('radar-zoom-in-btn')?.addEventListener('click', () => radarMap?.zoomIn());
  document.getElementById('radar-zoom-out-btn')?.addEventListener('click', () => radarMap?.zoomOut());
  document.getElementById('radar-zoom-local-btn')?.addEventListener('click', () => {
    if (radarLastLat !== null && radarLastLon !== null) {
      setRadarView(radarLastLat, radarLastLon, RADAR_LOCAL_ZOOM);
    }
  });
  document.getElementById('radar-lightning-btn')?.addEventListener('click', toggleLightningLayer);
  document.getElementById('radar-now-btn')?.addEventListener('click', moveToLatestObservedFrame);
  document.getElementById('radar-speed')?.addEventListener('change', function () {
    radarSpeedMs = parseInt(this.value, 10);
    restartRadarPlaybackIfNeeded();
  });
  document.getElementById('radar-loop')?.addEventListener('change', function () {
    radarLoopMode = this.value;
    const allowed = getAllowedRadarIndexes();
    if (allowed.length && !allowed.includes(radarCurrentFrame)) {
      showRadarFrame(allowed[0]);
    }
    restartRadarPlaybackIfNeeded();
  });
  document.getElementById('radar-slider')?.addEventListener('input', function () {
    if (radarPlayInterval) {
      clearInterval(radarPlayInterval);
      radarPlayInterval = null;
      const playBtn = document.getElementById('radar-play-btn');
      if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-play text-xs"></i>';
    }
    showRadarFrame(parseInt(this.value, 10));
  });
}
