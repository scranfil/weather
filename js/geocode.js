import { fetchWithTimeout, nominatimUrl } from './net.js';
import { showToast } from './ui.js';
import { fetchWeather } from './weather.js';

let closeAutocomplete = () => {};

export function extractPlaceName(address, fallbackName = null) {
  if (!address) return fallbackName;
  return address.city || address.town || address.village || address.hamlet
    || address.municipality || address.borough || address.suburb
    || address.neighbourhood || address.county || fallbackName;
}

export function formatPlaceWithState(place, address) {
  if (!place) return null;
  const stateCode = address?.['ISO3166-2-lvl4']?.split('-')[1]
    || (address?.state?.length === 2 ? address.state : null);
  if (stateCode) return `${place}, ${stateCode}`;
  if (address?.state) return `${place}, ${address.state}`;
  return place;
}

async function resolveLocationNameFromNws(lat, lon) {
  try {
    const { getPointsData } = await import('./nws.js');
    const data = await getPointsData(lat, lon);
    const { city, state } = data.properties?.relativeLocation?.properties || {};
    if (city && state) return `${city}, ${state}`;
    if (city) return city;
    return null;
  } catch (error) {
    return null;
  }
}

export async function resolveLocationName(lat, lon) {
  try {
    const res = await fetchWithTimeout(
      nominatimUrl(`https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${lat}&lon=${lon}`),
      {},
      8000
    );
    if (res.ok) {
      const geoData = await res.json();
      const place = extractPlaceName(geoData.address, geoData.name);
      const formatted = formatPlaceWithState(place, geoData.address);
      if (formatted) return formatted;
      if (geoData.display_name) {
        return geoData.display_name.split(',')[0].trim();
      }
    }
  } catch (error) {
    // fall through to NWS
  }
  return resolveLocationNameFromNws(lat, lon);
}

export async function searchLocation() {
  const input = document.getElementById('location-input');
  const query = input?.value.trim();
  if (!query) return;
  closeAutocomplete();

  try {
    const response = await fetchWithTimeout(
      nominatimUrl(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`),
      {},
      8000
    );
    const data = await response.json();
    if (data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      const name = data[0].display_name.split(',')[0];
      await fetchWeather(lat, lon, name);
      input.value = '';
    } else {
      showToast('Location not found.', 'warning');
    }
  } catch (error) {
    showToast('Search failed.', 'error');
  }
}

export function useCurrentLocation(options = {}) {
  const { silent = false } = options;
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      if (!silent) showToast('Geolocation is not supported by your browser.', 'warning');
      resolve(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      try {
        const resolvedName = await resolveLocationName(lat, lon);
        await fetchWeather(lat, lon, resolvedName);
        resolve(true);
      } catch (error) {
        if (!silent) showToast('Unable to get your location.', 'error');
        resolve(false);
      }
    }, () => {
      if (!silent) showToast('Unable to get your location.', 'error');
      resolve(false);
    }, { timeout: 10000, maximumAge: 300000 });
  });
}

export function bindSearchAutocomplete() {
  let acDebounce = null;
  let acResults = [];
  let acIndex = -1;
  const input = document.getElementById('location-input');
  const acList = document.getElementById('autocomplete-list');
  if (!input || !acList) return;

  function close() {
    acList.classList.remove('open');
    acList.replaceChildren();
    acResults = [];
    acIndex = -1;
  }
  closeAutocomplete = close;

  function renderAutocomplete(results) {
    acResults = results;
    acIndex = -1;
    acList.replaceChildren();
    if (!results.length) {
      close();
      return;
    }
    results.forEach((result) => {
      const city = result.address?.city || result.address?.town || result.address?.village || result.address?.county || result.name;
      const country = result.address?.country || '';
      const region = result.address?.state || '';
      const sub = [region, country].filter(Boolean).join(', ');
      const li = document.createElement('li');
      const icon = document.createElement('i');
      icon.className = 'fa-solid fa-location-dot ac-icon';
      const main = document.createElement('span');
      main.className = 'ac-main';
      main.textContent = city;
      const subEl = document.createElement('span');
      subEl.className = 'ac-sub';
      subEl.textContent = sub;
      li.append(icon, main, subEl);
      li.addEventListener('mousedown', (event) => {
        event.preventDefault();
        input.value = city;
        close();
        fetchWeather(parseFloat(result.lat), parseFloat(result.lon), city);
      });
      acList.appendChild(li);
    });
    acList.classList.add('open');
  }

  input.addEventListener('input', function () {
    clearTimeout(acDebounce);
    const q = this.value.trim();
    if (q.length < 2) {
      close();
      return;
    }
    acDebounce = setTimeout(async () => {
      try {
        const res = await fetchWithTimeout(
          nominatimUrl(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(q)}&limit=6`),
          {},
          8000
        );
        const data = await res.json();
        renderAutocomplete(data);
      } catch (error) {
        close();
      }
    }, 280);
  });

  input.addEventListener('keydown', function (event) {
    const items = acList.querySelectorAll('li');
    if (!items.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      acIndex = Math.min(acIndex + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('active', i === acIndex));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      acIndex = Math.max(acIndex - 1, 0);
      items.forEach((el, i) => el.classList.toggle('active', i === acIndex));
    } else if (event.key === 'Enter' && acIndex >= 0) {
      event.preventDefault();
      const result = acResults[acIndex];
      const city = result.address?.city || result.address?.town || result.address?.village || result.address?.county || result.name;
      input.value = city;
      close();
      fetchWeather(parseFloat(result.lat), parseFloat(result.lon), city);
    } else if (event.key === 'Escape') {
      close();
    }
  });

  input.addEventListener('keypress', function (event) {
    if (event.key === 'Enter' && acIndex < 0) {
      close();
      searchLocation();
    }
  });

  document.addEventListener('click', function (event) {
    if (!document.getElementById('search-wrapper')?.contains(event.target)) {
      close();
    }
  });
}
