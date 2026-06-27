const CACHE_NAME = 'weather-pwa-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg'
];

const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&family=Space+Grotesk:wght@500;600&display=swap'
];

const NWS_UA = 'WeatherPWA/1.0 (https://github.com/scranfil/weather)';
let storedLocation = null;
const seenAlertIds = new Set();

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await cache.addAll(APP_SHELL);
      await Promise.allSettled(CDN_ASSETS.map(url => fetch(url).then(r => {
        if (r.ok) return cache.put(url, r);
      })));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve())))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SET_LOCATION' && Number.isFinite(data.lat) && Number.isFinite(data.lon)) {
    storedLocation = { lat: data.lat, lon: data.lon };
  }
});

self.addEventListener('periodicsync', event => {
  if (event.tag === 'weather-alerts') {
    event.waitUntil(checkBackgroundAlerts());
  }
});

async function checkBackgroundAlerts() {
  if (!storedLocation) return;
  try {
    const res = await fetch(
      `https://api.weather.gov/alerts/active?point=${storedLocation.lat},${storedLocation.lon}`,
      { headers: { 'User-Agent': NWS_UA, Accept: 'application/geo+json' } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const features = data.features || [];
    for (const f of features) {
      const id = f.id || f.properties?.id || f.properties?.event;
      if (!id || seenAlertIds.has(id)) continue;
      seenAlertIds.add(id);
      const props = f.properties || {};
      await self.registration.showNotification(props.event || 'Weather Alert', {
        body: props.headline || props.description || 'Open the weather app for details.',
        icon: './icon.svg',
        badge: './icon.svg',
        tag: id
      });
    }
  } catch (e) {
    // ignore background failures
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const reqUrl = new URL(event.request.url);
  const isSameOrigin = reqUrl.origin === self.location.origin;
  const isCdn = CDN_ASSETS.some(u => event.request.url.startsWith(u.split('?')[0]));

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

  if (isCdn) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      }))
    );
    return;
  }

  if (!isSameOrigin) return;

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