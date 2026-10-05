import { APP_USER_AGENT, NOMINATIM_EMAIL } from './config.js';

const NWS_ORIGIN = 'https://api.weather.gov';

let nwsProxyEnabled = true;

export function nominatimUrl(base) {
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}email=${encodeURIComponent(NOMINATIM_EMAIL)}`;
}

export function toNwsFetchUrl(url) {
  if (!nwsProxyEnabled || typeof url !== 'string' || !url.startsWith(NWS_ORIGIN)) return url;
  return `/nws${url.slice(NWS_ORIGIN.length)}`;
}

export function resetNwsProxyForTests() {
  nwsProxyEnabled = true;
}

function isMissingNwsProxy(response) {
  if (response.headers.get('x-weather-nws-proxy') === '1') return false;
  if (response.status === 404) return true;
  const type = (response.headers.get('content-type') || '').toLowerCase();
  return type.includes('text/html');
}

export async function fetchWithTimeout(resource, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const url = typeof resource === 'string' ? resource : resource.url;
  const headers = { ...(options.headers || {}) };
  if (url.includes('api.weather.gov')) {
    headers['User-Agent'] = APP_USER_AGENT;
    headers['Accept'] = headers['Accept'] || 'application/geo+json';
  }
  if (url.includes('nominatim.openstreetmap.org')) {
    headers['User-Agent'] = APP_USER_AGENT;
  }
  const target = typeof resource === 'string' ? toNwsFetchUrl(url) : resource;
  try {
    let res = await fetch(target, { signal: controller.signal, ...options, headers });
    if (typeof resource === 'string' && target !== url && isMissingNwsProxy(res)) {
      nwsProxyEnabled = false;
      res = await fetch(url, { signal: controller.signal, ...options, headers });
    }
    return res;
  } finally {
    clearTimeout(id);
  }
}
