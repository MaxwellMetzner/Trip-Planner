# Trip Planner

A route-aware trip planner that recommends stops against the trip timeline instead of only showing places near a location. This implementation is static-first so it can be deployed to GitHub Pages, while preserving a clear upgrade path to a richer server-backed architecture later.

## What this build does today

- Builds one-way and same-day round-trip driving itineraries
- Plans meal slots against departure time and meal windows
- Adds coffee, rest, scenic, hike, attraction, gas, EV charging, and surprise stops
- Ranks candidates by weighted ratings, review count, detour cost, slot fit, daylight fit, open-hours fit, and preference fit
- Explains why each stop was selected
- Supports pin, skip, and replace interactions
- Saves trips and transparent preference learning in localStorage
- Runs in two modes:
  - Demo planner: fully client-side, no external API required
  - Google browser mode: map, autocomplete, driving route, and browser-side place search

## GitHub Pages viability

Yes, this app can be deployed to GitHub Pages.

### What works without a server

- The entire UI and planning engine
- Local persistence with localStorage
- Demo mode with deterministic route and place generation
- Google browser mode if you provide a browser-restricted Google Maps JavaScript API key
- Same-day round trips using the browser Directions service

### What degrades without a server

- API keys are public browser keys, not secret server keys
- Saved trips live only in the current browser unless you add a backend
- The along-route search is an approximation built from browser-side text search near sampled route anchors
- The static app cannot safely support Yelp enrichment or other secret-bearing providers
- The static app does not provide shared accounts, sync, or durable cross-device storage

### When to split into two components

Add a backend when you need any of the following:

- Secure provider keys and quotas beyond browser-only usage
- Google Routes plus Places REST integration with stricter field masking and better route-biased search
- Yelp or other enrichment providers
- User accounts and cross-device saved trips
- Re-optimization and provider normalization on the server
- Auditable provider snapshot retention and expiry enforcement

## Local development

1. Install dependencies.

```bash
npm install
```

2. Start the dev server.

```bash
npm run dev
```

3. Optional: enable Google browser mode by copying `.env.example` to `.env` and setting `VITE_GOOGLE_MAPS_API_KEY`.

The key must be a browser-restricted Google Maps JavaScript API key. It will be shipped to the browser in the static build, so treat it as public and lock it down by referrer.

## GitHub Pages deployment

The repo includes a Pages workflow at [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml).

### Required repository setup

1. Enable GitHub Pages in the repository settings and choose GitHub Actions as the source.
2. Add a repository variable or secret named `VITE_GOOGLE_MAPS_API_KEY` if you want Google browser mode in production.
3. Restrict that Google key to your GitHub Pages domain or custom domain.
4. If the repo name changes, update `VITE_PUBLIC_BASE` or the Vite `base` setting.

### Manual deployment

```bash
npm run build
npm run deploy
```

## Static architecture notes

The technical design originally assumed a server-owned provider pipeline. The current implementation adapts that design to a static environment by moving the ranking engine, slot planner, daylight logic, explanation generation, and local re-optimization into the browser.

The main differences from the ideal two-component architecture are documented in [docs/deployment-notes.md](docs/deployment-notes.md).

## Core files

- [docs/technical-design.md](docs/technical-design.md)
- [docs/deployment-notes.md](docs/deployment-notes.md)
- [src/App.tsx](src/App.tsx)
- [src/lib/planner/engine.ts](src/lib/planner/engine.ts)
- [src/lib/providers/googleProvider.ts](src/lib/providers/googleProvider.ts)
- [src/lib/providers/mockProvider.ts](src/lib/providers/mockProvider.ts)

## Next upgrade path

If you want to continue past GitHub Pages constraints, the clean next step is a two-component architecture:

1. Keep this React frontend largely intact.
2. Move routing, along-route search, place hydration, scoring, persistence, and provider enrichment behind an API.
3. Swap the browser Google provider for a server-backed provider while preserving the current planner contracts.
