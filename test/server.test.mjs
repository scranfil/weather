import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APP_USER_AGENT } from '../js/config.js';
import { nwsProxyHeaders, resolveNwsUpstreamUrl, startServer } from '../server.mjs';

test('the national weather service proxy adds the app contact string', () => {
  const headers = nwsProxyHeaders('application/geo+json');
  assert.equal(headers['User-Agent'], APP_USER_AGENT);
  assert.match(headers['User-Agent'], /contact:/);
  assert.equal(nwsProxyHeaders(undefined).Accept, 'application/geo+json');
});

test('nws proxy URL resolver keeps requests on api.weather.gov', () => {
  const ok = resolveNwsUpstreamUrl('/nws/points/39.89,-85.96');
  assert.equal(ok?.origin, 'https://api.weather.gov');
  assert.equal(ok?.pathname, '/points/39.89,-85.96');

  const withQuery = resolveNwsUpstreamUrl('/nws/alerts/active?point=1,2');
  assert.equal(withQuery?.pathname, '/alerts/active');
  assert.equal(withQuery?.searchParams.get('point'), '1,2');

  assert.equal(resolveNwsUpstreamUrl('/nws//evil.com/x'), null);
  assert.equal(resolveNwsUpstreamUrl('/nws/https://evil.com/x'), null);
  assert.equal(resolveNwsUpstreamUrl('/nws/http://evil.com/x'), null);
  assert.equal(resolveNwsUpstreamUrl('/nws/\\evil.com'), null);
  assert.equal(resolveNwsUpstreamUrl('/nws').href, 'https://api.weather.gov/');
  assert.equal(resolveNwsUpstreamUrl('/nws/').href, 'https://api.weather.gov/');
});

test('the local server rejects open-proxy paths and serves the app', async () => {
  const server = await startServer({ port: 0 });
  const { port } = server.address();
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /radar-forecast-legend/);
    assert.match(html, /freshness-badge/);

    const points = await fetch(`http://127.0.0.1:${port}/nws/points/39.8913,-85.9677`);
    assert.equal(points.status, 200);
    assert.equal(points.headers.get('x-weather-nws-proxy'), '1');
    const body = await points.json();
    assert.equal(typeof body.properties?.forecast, 'string');

    const missing = await fetch(`http://127.0.0.1:${port}/nws/does-not-exist`);
    assert.equal(missing.headers.get('x-weather-nws-proxy'), '1');
    assert.notEqual(missing.status, 200);

    const openProxy = await fetch(`http://127.0.0.1:${port}/nws/%2F%2Fexample.com/`);
    assert.equal(openProxy.status, 400);
    assert.equal(openProxy.headers.get('x-weather-nws-proxy'), '1');

    const absolute = await fetch(`http://127.0.0.1:${port}/nws/https://example.com/`);
    assert.equal(absolute.status, 400);

    const head = await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' });
    assert.equal(head.status, 200);

    const post = await fetch(`http://127.0.0.1:${port}/nws/points/1,2`, { method: 'POST' });
    assert.equal(post.status, 405);
  } finally {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});
