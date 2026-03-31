# Static Deployment Notes

## Summary

This repository currently implements the trip planner as a static web application so it can run on GitHub Pages. The planning engine, slot generation, ranking logic, daylight checks, explanation generation, and persistence all run in the browser.

## What the static build preserves from the design

- Timeline-first planning model
- Meal-window inference
- Detour-aware ranking
- Daylight-aware outdoor penalties
- Explanation text for recommendations
- Local re-optimization through pin, skip, and replace actions
- Saved itineraries and transparent preference learning

## What changes in the static build

### Provider ownership

Original design:

- server owns Google calls
- server owns place normalization and caching
- server protects secrets

Static adaptation:

- browser owns route requests when Google browser mode is enabled
- browser owns place search and details hydration
- browser key must be restricted by referrer

### Persistence

Original design:

- PostgreSQL stores trips, slots, provider snapshots, and preference data

Static adaptation:

- localStorage stores trips and preference data on the current device only
- no cross-device sync
- no authenticated user model

### Along-route search quality

Original design:

- route-biased search through the Google provider pipeline and field-masked enrichment

Static adaptation:

- search approximates along-route planning by sampling around target route anchors and querying nearby browser-side places
- this is good enough for an MVP or portfolio deployment, but weaker than a server-backed provider layer

## When a server becomes necessary

A second component becomes the right move when any of these matter more than GitHub Pages simplicity:

- secure provider credentials
- Yelp or other secret-bearing enrichment
- durable saved itineraries
- collaborative trip planning
- stronger provider normalization and deduplication
- analytics and observability beyond local interactions
- compliance workflows around provider snapshot expiry

## Suggested transition plan

1. Keep the existing React app as the frontend.
2. Replace the browser Google provider with an API-backed provider adapter.
3. Move persistence from localStorage to a database.
4. Keep the planner contracts stable so the UI and re-optimization actions do not need a rewrite.
5. Preserve demo mode for local development and marketing demos.
