const CACHE_NAME = 'weather-pwa-v7';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './css/app.css',
  './css/tailwind.css',
  './vendor/fonts/fonts.css',
  './vendor/fonts/inter-latin-300-normal.woff2',
  './vendor/fonts/inter-latin-400-normal.woff2',
  './vendor/fonts/inter-latin-500-normal.woff2',
  './vendor/fonts/space-grotesk-latin-500-normal.woff2',
  './vendor/fonts/space-grotesk-latin-600-normal.woff2',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/fontawesome/css/all.min.css',
  './vendor/fontawesome/webfonts/fa-solid-900.woff2',
  './vendor/fontawesome/webfonts/fa-regular-400.woff2',
  './vendor/fontawesome/webfonts/fa-brands-400.woff2',
  './vendor/fontawesome/webfonts/fa-v4compatibility.woff2',
  './js/app.js',
  './js/alerts.js',
  './js/conditions.js',
  './js/config.js',
  './js/favorites.js',
  './js/format.js',
  './js/geocode.js',
  './js/net.js',
  './js/nws.js',
  './js/pwa.js',
  './js/radar.js',
  './js/state.js',
  './js/ui.js',
  './js/weather.js'
];

const DB_NAME = 'weather-sw';
const DB_STORE = 'kv';
const SEEN_ALERT_LIMIT = 300;

let storedLocation = null;
const seenAlertIds = new Set();

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(key) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function idbSet(key, value) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

let readyPromise = null;
function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const location = await idbGet('location');
      if (location && Number.isFinite(location.lat) && Number.isFinite(location.lon)) {
        storedLocation = { lat: location.lat, lon: location.lon };
      }
      const ids = await idbGet('seenAlertIds');
      if (Array.isArray(ids)) {
        ids.filter(Boolean).forEach(id => seenAlertIds.add(id));
      }
    })().catch(() => {});
  }
  return readyPromise;
}

function rememberAlertId(id) {
  seenAlertIds.add(id);
  const trimmed = [...seenAlertIds].slice(-SEEN_ALERT_LIMIT);
  seenAlertIds.clear();
  trimmed.forEach(item => seenAlertIds.add(item));
  return idbSet('seenAlertIds', trimmed).catch(() => {});
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve())));
    await ensureReady();
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SET_LOCATION' && Number.isFinite(data.lat) && Number.isFinite(data.lon)) {
    storedLocation = { lat: data.lat, lon: data.lon };
    idbSet('location', storedLocation).catch(() => {});
  }
});

self.addEventListener('periodicsync', event => {
  if (event.tag === 'weather-alerts') {
    event.waitUntil(checkBackgroundAlerts());
  }
});

async function checkBackgroundAlerts() {
  await ensureReady();
  if (!storedLocation) return;
  try {
    const res = await fetch(
      `https://api.weather.gov/alerts/active?point=${storedLocation.lat},${storedLocation.lon}`,
      { headers: { 'User-Agent': 'WeatherPWA/1.0 (https://github.com/scranfil/weather)', Accept: 'application/geo+json' } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const features = data.features || [];
    for (const feature of features) {
      const id = feature.id || feature.properties?.id || feature.properties?.event;
      if (!id || seenAlertIds.has(id)) continue;
      await rememberAlertId(id);
      const props = feature.properties || {};
      await self.registration.showNotification(props.event || 'Weather Alert', {
        body: props.headline || props.description || 'Open the weather app for details.',
        icon: './icon.svg',
        badge: './icon.svg',
        tag: id
      });
    }
  } catch (error) {
    // ignore background failures
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const reqUrl = new URL(event.request.url);
  const isSameOrigin = reqUrl.origin === self.location.origin;
  if (!isSameOrigin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
        }
        return response;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
