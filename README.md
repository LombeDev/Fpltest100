# Kopala FPL

A Fantasy Premier League companion for managers in Zambia, built as a
progressive web app with vanilla HTML, CSS and JavaScript (ES modules), and
Netlify Functions for the data proxy.

## Pages

| File | What it is |
|---|---|
| `index.html` | Entry point. Opens `app.html`. |
| `app.html` | Single-page app: sign-in, Home, My team, Live, Prices, Fixtures. |
| `dashboard.html` | Live dashboard: squad list, 3D pitch view, rank, mini-leagues, prices, what-if captain. |
| `data-check.html` | Calls every FPL endpoint through the proxy and reports what came back. |
| `games.html`, `leagues.html`, `prices.html` | Earlier pages, kept while features move into `app.html` and `dashboard.html`. |
| `legacy-index.html` | The previous home page. |

## Structure

```
js/                 ES modules for the dashboard
  config.js         proxy URL, refresh interval, storage keys
  storage.js        localStorage with timestamp expiry
  api.js            FPL requests through the proxy, Promise.all fetches
  store.js          reactive state store with targeted subscriptions
  dom.js            keyed, in-place DOM updates (data-player-id)
  app.js            dashboard controller
  analytics.js      pure calculations: EO, net swing, safety score,
                    automatic substitutions, live mini-league re-ranking
netlify/functions/
  fpl-proxy.js      forwards read-only requests to the FPL API
tests/
  analytics.test.mjs
```

## Run locally

Module scripts do not load from `file://`, so serve the folder over HTTP:

```bash
npx serve .            # or: python3 -m http.server 8000
```

The Netlify function only runs on Netlify. For local testing with real data,
use `netlify dev` (Netlify CLI).

## Tests

```bash
npm test
```

Runs the analytics unit tests in Node 18+ with no dependencies.

## Deploy

1. Push this repository to GitHub.
2. In Netlify, choose **Add new site → Import an existing project** and select the repository.
3. Netlify reads `netlify.toml` and deploys `netlify/functions/fpl-proxy.js`.
4. Open `/data-check.html`, enter your team ID and run the check. Every row should say OK.

Functions only run on a Git-based deploy. Drag-and-drop uploads serve static files only.

## Privacy and data

Sign-in uses the FPL team ID only. The ID and any favourite league IDs are stored in
the browser's localStorage. Nothing is sent to a server other than the read-only
requests through the proxy.

## Licence

See `LICENSE`.
