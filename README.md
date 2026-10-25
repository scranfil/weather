# Weather

Installable weather PWA: National Weather Service forecasts and alerts, Open-Meteo extras, RainViewer radar, and Blitzortung lightning.

## Quick start

```bash
npm install
npm start
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/). Override the port with `PORT`.

```bash
npm test          # node:test suite
npm run lint      # ESLint
npm run build:css # rebuild Tailwind from css/tailwind-input.css
```

## Architecture

| Piece | Role |
|--------|------|
| `index.html` + `js/*` | Client UI and weather orchestration |
| `server.mjs` | Static file server + same-origin `/nws/*` proxy to `api.weather.gov` |
| `sw.js` | App-shell cache, background alert checks, notification click |
| `vendor/` | Checked-in copies of Leaflet, Font Awesome (solid), and fonts used at runtime |

npm dependencies under `@fontsource/*`, `@fortawesome/*`, and `leaflet` are the upstream sources for refreshing `vendor/`. The browser loads assets from `vendor/`, not `node_modules`.

## NWS proxy

Browsers call NWS through `/nws/...` so the app can send a contact User-Agent without CORS issues. The proxy only allows relative paths under `https://api.weather.gov` (protocol-relative and absolute URLs are rejected).

CARTO basemap keys in `js/config.js` are referer-locked (GitHub Pages vs localhost).

## PWA notes

- Installable fullscreen app (`display: "fullscreen"` with standalone fallback)
- Manifest icons: `icon-192.png`, `icon-512.png`, plus `icon.svg`
- Use **Install** (or iOS Share → Add to Home Screen) to launch without browser chrome
- Alert notifications are opt-in via **Enable notifications** when alerts are present
- Lightning WebSocket starts only when the Lightning control is turned on
- Leaflet CSS/JS load on first radar use
- Safe-area insets keep the nav clear of notches in fullscreen / home-screen mode

## License

ISC
