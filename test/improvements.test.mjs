import './dom-shim.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { APP_USER_AGENT, FALLBACK_LOCATION } from '../js/config.js';
import { homeOrFallbackLocation, loadFavorites } from '../js/favorites.js';
import { formatTempF, formatTempLabel, tempUnit } from '../js/format.js';
import { state } from '../js/state.js';

const root = path.dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  state.favorites = [];
  state.useCelsius = false;
  localStorage.removeItem('weatherFavorites');
});

test('service worker imports the shared NWS user agent string', () => {
  const sw = readFileSync(path.join(root, '../sw.js'), 'utf8');
  assert.match(sw, /import\s+\{\s*APP_USER_AGENT\s*\}\s+from\s+'\.\/js\/config\.js'/);
  assert.equal(APP_USER_AGENT.includes('WeatherPWA'), true);
  assert.doesNotMatch(sw, /const NWS_USER_AGENT =/);
});

test('loadFavorites recovers from corrupt JSON and invalid entries', () => {
  localStorage.setItem('weatherFavorites', '{not-json');
  loadFavorites();
  assert.equal(state.favorites.length, 1);
  assert.equal(state.favorites[0].name, FALLBACK_LOCATION.name);
  assert.equal(state.favorites[0].isHome, true);

  localStorage.setItem('weatherFavorites', JSON.stringify([
    { name: 'Broken' },
    { name: 'Chicago, IL', lat: 41.8781, lon: -87.6298, isHome: true }
  ]));
  loadFavorites();
  assert.equal(state.favorites.length, 1);
  assert.equal(state.favorites[0].name, 'Chicago, IL');
  assert.deepEqual(homeOrFallbackLocation(), { name: 'Chicago, IL', lat: 41.8781, lon: -87.6298 });
});

test('forecast-style temps respect the unit toggle', () => {
  state.useCelsius = false;
  assert.equal(formatTempLabel(68), '68°F');
  assert.equal(tempUnit(), '°F');
  state.useCelsius = true;
  assert.equal(formatTempF(68), 20);
  assert.equal(formatTempLabel(68), '20°C');
  assert.equal(formatTempLabel(NaN), '--');
});

test('manifest lists png install icons', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, '../manifest.webmanifest'), 'utf8'));
  const pngs = manifest.icons.filter(icon => icon.type === 'image/png');
  assert.ok(pngs.some(icon => icon.sizes === '192x192'));
  assert.ok(pngs.some(icon => icon.sizes === '512x512'));
});

test('app shell no longer precaches unused fontawesome webfonts', () => {
  const sw = readFileSync(path.join(root, '../sw.js'), 'utf8');
  assert.match(sw, /fa-solid-900\.woff2/);
  assert.doesNotMatch(sw, /fa-brands-400/);
  assert.doesNotMatch(sw, /fa-regular-400/);
  assert.doesNotMatch(sw, /fa-v4compatibility/);
});
