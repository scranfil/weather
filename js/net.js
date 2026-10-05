import { APP_USER_AGENT, NOMINATIM_EMAIL } from './config.js';

export function nominatimUrl(base) {
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}email=${encodeURIComponent(NOMINATIM_EMAIL)}`;
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
  try {
    const res = await fetch(resource, { signal: controller.signal, ...options, headers });
    clearTimeout(id);
    return res;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}
