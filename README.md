# Trip Planner

Trip Planner is a route-aware road trip planner that recommends when and where to stop across the full drive, not just what happens to be near a single map pin.

Give it an origin, a destination, a departure time, and a travel style, and it builds an itinerary that balances meals, breaks, scenery, comfort, and detour tolerance across the entire trip.

## Build From Source

Before running the app locally, create `.env.local` from [.env.example](.env.example).

- Set `VITE_GOOGLE_MAPS_API_KEY` only if you want Google-backed autocomplete, map rendering, and route search.
- Leave `VITE_GOOGLE_MAPS_API_KEY` blank if you want to use the built-in demo provider.

Full local build steps are in [docs/local-setup.md](docs/local-setup.md).

## What It Does

- Builds one-way and same-day round-trip driving itineraries
- Plans meal stops against departure time and meal windows
- Mixes in coffee, rest, scenic, hike, attraction, gas, EV charging, and surprise stops
- Ranks stop candidates against route fit, detour cost, ratings, daylight, opening hours, and trip preferences
- Explains why each stop was chosen
- Lets you pin, skip, save, and replace recommendations as you tune the plan
- Learns from saved trips to gradually reflect recurring preferences

## Why It Feels Different

Most trip tools answer "what is nearby?" Trip Planner answers "what fits this part of the drive?"

Instead of treating every stop the same, it reasons about route progress, likely energy dips, meal timing, and how much extra time each detour is actually worth. The result is a plan that feels paced, not just geographically clustered.

## Experience

Trip Planner combines:

- Timeline-first trip building
- Route-aware stop recommendations
- Adjustable planning modes and detour tolerance
- Interactive itinerary refinement after the initial plan is built
- A map-and-cards workflow that keeps the route, timing, and stops aligned

## Built For

- Day trips with a few well-timed breaks
- Longer drives that need reliable meal planning
- Scenic drives where memorable detours should still feel intentional
- Travelers who want a plan they can keep editing instead of a fixed directions printout

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
