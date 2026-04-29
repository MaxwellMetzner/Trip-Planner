# Local Setup

Trip Planner can run entirely in demo mode, so a Google key is optional for local development.

## 1. Install dependencies

```bash
npm install
```

## 2. Create the local env file

Create `.env.local` from [.env.example](../.env.example).

```env
VITE_GOOGLE_MAPS_API_KEY=
VITE_PUBLIC_BASE=/Trip-Planner/
```

- Leave `VITE_GOOGLE_MAPS_API_KEY` blank if you only want the demo provider.
- Add a browser-restricted Google Maps key if you want autocomplete, map rendering, and browser-side route search.
- Keep `VITE_PUBLIC_BASE=/Trip-Planner/` for this repository's production Pages path.
- If you fork the repo or deploy under a different path, update `VITE_PUBLIC_BASE` before making a production build.

## 3. Optional Google configuration

If you want Google-backed features locally, configure the key for browser use:

1. Enable Maps JavaScript API, Places API, and Directions API (Legacy) in the same Google Cloud project.
2. Restrict the key by HTTP referrer.
3. Allow the local origins you actually use, such as `http://localhost:5173/*`.
4. If you test built output with `vite preview`, also allow that preview origin.

## 4. Start the app

```bash
npm run dev
```

## 5. Create a production build

```bash
npm run build
```

The production build works without a Google key. When no key is present, the app builds and runs in demo mode.

## 6. Preview the built app locally

```bash
npm run preview
```
