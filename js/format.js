import { state } from './state.js';

export function tempUnit() {
  return state.useCelsius ? '°C' : '°F';
}

export function cToF(celsius) {
  return Math.round((celsius * 9 / 5) + 32);
}

export function formatTempF(tempF) {
  if (!Number.isFinite(tempF)) return '--';
  if (state.useCelsius) return Math.round((tempF - 32) * 5 / 9);
  return Math.round(tempF);
}

export function formatTempLabel(tempF) {
  const value = formatTempF(tempF);
  return value === '--' ? '--' : `${value}${tempUnit()}`;
}

export function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatDuration(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return `${hours}h ${minutes}m`;
}
