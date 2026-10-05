import './dom-shim.mjs';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  getDisplayWindMph,
  observationWindMph,
  resolveCurrentCondition
} from '../js/conditions.js';
import { FALLBACK_LOCATION } from '../js/config.js';
import { homeOrFallbackLocation } from '../js/favorites.js';
import { fetchWithTimeout, resetNwsProxyForTests } from '../js/net.js';
import { isDisplayedPrecip, radarFramesFromCatalog } from '../js/radar.js';
import { state } from '../js/state.js';

function freshObservation(text, windSpeed, precipMm = 0) {
  return {
    textDescription: text,
    timestamp: new Date().toISOString(),
    windSpeed,
    precipitationLastHour: { value: precipMm }
  };
}

function hourlyNow(shortForecast, windSpeed = '7 mph', pop = 0) {
  return [{
    startTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    shortForecast,
    windSpeed,
    temperature: 68,
    probabilityOfPrecipitation: { value: pop }
  }];
}

afterEach(() => {
  resetNwsProxyForTests();
  state.favorites = [];
});

test('observation wind converts km/h and m/s and keeps miles per hour', () => {
  assert.equal(observationWindMph({ windSpeed: { value: 11.16, unitCode: 'wmoUnit:km_h-1' } }), 11.16 * 0.621371);
  assert.equal(observationWindMph({ windSpeed: { value: 10, unitCode: 'wmoUnit:m_s-1' } }), 10 * 2.236936);
  assert.equal(observationWindMph({ windSpeed: { value: 7, unitCode: 'wmoUnit:mi_h-1' } }), 7);
  assert.equal(getDisplayWindMph(freshObservation('Clear', { value: 11.16, unitCode: 'wmoUnit:km_h-1' }), hourlyNow('Sunny', '25 mph')), 7);
  assert.equal(getDisplayWindMph(freshObservation('Clear', { value: 10, unitCode: 'wmoUnit:m_s-1' }), []), 22);
});

test('calm station wind stays calm and missing wind uses the hourly forecast', () => {
  const calm = freshObservation('Clear', { value: 0, unitCode: 'wmoUnit:km_h-1' });
  assert.equal(getDisplayWindMph(calm, hourlyNow('Sunny', '12 mph')), 0);
  const missing = freshObservation('Clear', null);
  assert.equal(getDisplayWindMph(missing, hourlyNow('Sunny', '7 mph')), 7);
  assert.equal(observationWindMph({ windSpeed: { value: 4, unitCode: 'wmoUnit:deg' } }), null);
  assert.equal(getDisplayWindMph(freshObservation('Clear', { value: 4, unitCode: 'wmoUnit:deg' }), []), '--');
});

test('a fresh clear observation stays clear unless radar is heavy or an alert is active', () => {
  const clear = freshObservation('Clear', { value: 11.16, unitCode: 'wmoUnit:km_h-1' });
  const hourly = hourlyNow('Chance Rain', '7 mph', 40);
  assert.equal(
    resolveCurrentCondition(clear, hourly, { shortForecast: 'Rain' }, { radarPrecip: { text: 'Light Rain', severity: 52 } }),
    'Clear'
  );
  assert.equal(
    resolveCurrentCondition(clear, hourly, { shortForecast: 'Sunny' }, { radarPrecip: { text: 'Heavy Rain', severity: 74 } }),
    'Heavy Rain'
  );
  assert.equal(
    resolveCurrentCondition(clear, hourly, null, { alerts: [{ properties: { event: 'Severe Thunderstorm Warning' } }] }),
    'Severe Thunderstorm Warning'
  );
});

test('measured rain replaces a clear observation and a stale observation yields to the forecast', () => {
  const wet = freshObservation('Clear', { value: 5, unitCode: 'wmoUnit:mi_h-1' }, 3);
  assert.equal(resolveCurrentCondition(wet, hourlyNow('Sunny'), null), 'Rain');

  const stale = freshObservation('Clear', { value: 5, unitCode: 'wmoUnit:mi_h-1' });
  stale.timestamp = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  assert.equal(resolveCurrentCondition(stale, hourlyNow('Rain', '7 mph', 60), null), 'Rain');
});

test('radar color filter keeps precipitation colors and drops beige and gray clutter', () => {
  assert.equal(isDisplayedPrecip(30, 90, 210, 200), true);
  assert.equal(isDisplayedPrecip(40, 180, 50, 180), true);
  assert.equal(isDisplayedPrecip(230, 170, 30, 220), true);
  assert.equal(isDisplayedPrecip(210, 40, 40, 200), true);
  assert.equal(isDisplayedPrecip(150, 40, 190, 200), true);
  assert.equal(isDisplayedPrecip(196, 184, 150, 90), false);
  assert.equal(isDisplayedPrecip(114, 110, 97, 46), false);
  assert.equal(isDisplayedPrecip(0, 0, 255, 10), false);
});

test('gps failure prefers the saved home favorite', () => {
  assert.deepEqual(homeOrFallbackLocation(), FALLBACK_LOCATION);
  state.favorites = [
    { name: 'Chicago, IL', lat: 41.8781, lon: -87.6298, isHome: false }
  ];
  assert.equal(homeOrFallbackLocation().name, FALLBACK_LOCATION.name);
  state.favorites.push({ name: 'Chicago, IL', lat: 41.8781, lon: -87.6298, isHome: true });
  assert.deepEqual(homeOrFallbackLocation(), { name: 'Chicago, IL', lat: 41.8781, lon: -87.6298 });
});

test('national weather service calls use the same-origin proxy until it is missing', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('/nws')) {
      return new Response('missing', { status: 404, headers: { 'content-type': 'text/html' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/geo+json' } });
  };
  try {
    const first = await fetchWithTimeout('https://api.weather.gov/points/39.8,-86.1', {}, 2000);
    assert.equal(first.status, 200);
    assert.deepEqual(calls, ['/nws/points/39.8,-86.1', 'https://api.weather.gov/points/39.8,-86.1']);
    calls.length = 0;
    await fetchWithTimeout('https://api.weather.gov/alerts/active?point=39.8,-86.1', {}, 2000);
    assert.deepEqual(calls, ['https://api.weather.gov/alerts/active?point=39.8,-86.1']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a proxied national weather service 404 is not treated as a missing proxy', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response('{}', {
      status: 404,
      headers: { 'content-type': 'application/geo+json', 'x-weather-nws-proxy': '1' }
    });
  };
  try {
    const res = await fetchWithTimeout('https://api.weather.gov/points/0,0', {}, 2000);
    assert.equal(res.status, 404);
    await fetchWithTimeout('https://api.weather.gov/points/0,0', {}, 2000);
    assert.deepEqual(calls, ['/nws/points/0,0', '/nws/points/0,0']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rainviewer frames keep an empty nowcast out of the loop', () => {
  const catalog = radarFramesFromCatalog({
    host: 'https://tilecache.rainviewer.com',
    radar: {
      past: [{ time: 1, path: '/past' }],
      nowcast: []
    }
  });
  assert.equal(catalog.forecastCount, 0);
  assert.equal(catalog.pastCount, 1);
  assert.deepEqual(catalog.frames.map(frame => frame.type), ['past']);

  const withForecast = radarFramesFromCatalog({
    host: 'https://tilecache.rainviewer.com',
    radar: {
      past: [{ time: 1, path: '/past' }],
      nowcast: [{ time: 2, path: '/future' }]
    }
  });
  assert.equal(withForecast.forecastCount, 1);
  assert.deepEqual(withForecast.frames.map(frame => frame.type), ['past', 'forecast']);
});
