import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APP_USER_AGENT } from '../js/config.js';
import { nwsProxyHeaders, startServer } from '../server.mjs';

test('the national weather service proxy adds the app contact string', () => {
  const headers = nwsProxyHeaders('application/geo+json');
  assert.equal(headers['User-Agent'], APP_USER_AGENT);
  assert.match(headers['User-Agent'], /contact:/);
  assert.equal(nwsProxyHeaders(undefined).Accept, 'application/geo+json');
});

test('the local server proxies api.weather.gov and serves the app', async () => {
  const server = await startServer({ port: 0 });
  const { port } = server.address();
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /radar-forecast-legend/);

    const points = await fetch(`http://127.0.0.1:${port}/nws/points/39.8913,-85.9677`);
    assert.equal(points.status, 200);
    assert.equal(points.headers.get('x-weather-nws-proxy'), '1');
    const body = await points.json();
    assert.equal(typeof body.properties?.forecast, 'string');

    const missing = await fetch(`http://127.0.0.1:${port}/nws/does-not-exist`);
    assert.equal(missing.headers.get('x-weather-nws-proxy'), '1');
    assert.notEqual(missing.status, 200);
  } finally {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});
