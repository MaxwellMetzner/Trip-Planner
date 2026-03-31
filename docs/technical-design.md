# Trip Planner Technical Design

## 1. Purpose

This document turns the product requirements into an implementable design for the v1 route-aware trip planner.

The MVP target is a Google-first web application for car trips that:

- builds a route from origin to destination
- plans meal, break, and attraction stops against the trip timeline
- ranks stops by quality, detour cost, schedule fit, daylight fit, and user preference fit
- explains why each recommendation was selected
- saves and reopens itineraries

The core design principle is that trip planning is timeline-first, not place-first. Every recommendation is evaluated against when the traveler will arrive there, not just whether it is near the route.

## 2. MVP Boundaries

### In scope

- One-way and round-trip driving itineraries
- Google-based origin and destination autocomplete
- Google routing and route polyline handling
- Along-route candidate generation using Google Places
- Schedule-aware planning for breakfast, lunch, dinner, coffee, rest stops, scenic stops, hikes, attractions, gas, and EV charging
- Detour-aware ranking
- Daylight-aware suppression or penalty for outdoor stops
- Saved itineraries
- Explicit and transparent preference profile
- Local stop replacement and local re-optimization

### Out of scope

- Public transit planning
- Reservations and booking
- Hotel or overnight optimization
- Social collaboration
- Multi-day route optimization
- Full ML-based recommendation models
- Non-Google map rendering when Google place or route content is shown

## 3. Recommended Stack

The repo is empty, so this design assumes a stack that minimizes deployment complexity while keeping server-side control over sensitive APIs.

### Frontend

- Next.js with TypeScript
- React for UI
- Google Maps JavaScript API for map rendering and route display
- Google Places Autocomplete for origin and destination entry
- TanStack Query for server-state fetching and caching
- Zod for request and response validation on the client boundary

### Backend

- Next.js server routes or a small Node.js API layer inside the same deployment
- TypeScript domain services for routing, candidate generation, scoring, and explanation generation
- Provider adapters to isolate Google and future Yelp integration

### Persistence

- PostgreSQL for trips, slots, saved itineraries, preference profiles, and audit-friendly scoring data
- Redis or in-memory cache for short-lived route and place hydration caching

### Supporting libraries

- geo-tz or equivalent timezone lookup from coordinates
- suncalc or equivalent for sunrise and sunset calculations
- a lightweight job runner only if background refresh is later needed for stale saved trips

## 4. Architecture Overview

```text
Browser UI
  -> Trip Planner API
    -> Route Service
    -> Slot Planner
    -> Candidate Search Service
    -> Place Hydration Service
    -> Scoring Engine
    -> Itinerary Assembler
    -> Preference Service
    -> Persistence Layer
      -> PostgreSQL
      -> Short-lived Cache
    -> Provider Adapters
      -> Google Routes API
      -> Google Places API
      -> Yelp Adapter (phase 2)
```

### Responsibility split

### Browser responsibilities

- Render the Google map and route polyline
- Collect trip inputs and preferences
- Display the timeline, stop cards, map pins, and explanations
- Trigger plan, replace, pin, skip, reorder, and save actions
- Store only non-sensitive UI state locally

### Server responsibilities

- Hold provider API keys and secrets
- Compute routes and projected timeline data
- Normalize provider-specific payloads into canonical trip objects
- Search and rank candidates
- Enforce daylight, opening-hours, and detour rules
- Persist trips and preference data
- Recompute only the affected part of the itinerary on local edits

## 5. Core Planning Workflow

### Planning sequence

1. The browser captures origin and destination via autocomplete and sends selected place IDs plus user-entered settings to the backend.
2. The backend requests a driving route from Google Routes and receives distance, duration, legs, and encoded polyline.
3. The Slot Planner converts the route into a timeline and generates stop slots.
4. The Candidate Search Service searches for candidate places along the route for each active slot or category.
5. The backend enriches only the top candidates with additional place details.
6. The Scoring Engine computes a score breakdown for every candidate.
7. The Itinerary Assembler chooses the best candidate per slot while respecting trip-level constraints.
8. The response returns the route, timeline, selected stops, alternatives, and explanation text.
9. The user can then pin, replace, skip, or reorder a stop without forcing a full trip rebuild.

### Why this pipeline is staged

- Google route computation is cheap relative to broad place hydration.
- Along-route candidate generation should be wide but shallow.
- Only top candidates should be hydrated with full place details.
- Local stop replacement should reuse existing route context and cached candidates where possible.

## 6. Domain Model

Canonical models are provider-agnostic. Provider payloads are stored separately with expiration rules.

### 6.1 Core request model

```ts
type TravelMode = "drive";

type Category =
  | "breakfast"
  | "lunch"
  | "dinner"
  | "coffee"
  | "rest_stop"
  | "scenic_overlook"
  | "hike"
  | "attraction"
  | "gas"
  | "ev_charging"
  | "surprise";

type ItineraryMode =
  | "best_overall"
  | "fastest_reasonable"
  | "food_focused"
  | "experience_focused";

interface PlaceInput {
  label: string;
  googlePlaceId: string;
  lat?: number;
  lng?: number;
}

interface TripPlanningRequest {
  origin: PlaceInput;
  destination: PlaceInput;
  departureAt: string;
  travelMode: TravelMode;
  returnTripEnabled: boolean;
  itineraryMode: ItineraryMode;
  activeCategories: Category[];
  mealStopCount?: 0 | 1 | 2 | 3;
  desiredStopsByCategory?: Partial<Record<Category, number>>;
  detourToleranceMinutes: number;
  mealWindows?: {
    breakfast: { start: string; end: string };
    lunch: { start: string; end: string };
    dinner: { start: string; end: string };
  };
  preferences: {
    budgetLevel?: "low" | "medium" | "high";
    cuisines?: string[];
    attractionTags?: string[];
    hikingInterest?: "none" | "light" | "moderate" | "high";
    avoidChains?: boolean;
    childFriendly?: boolean;
    allowNightOutdoor?: boolean;
    idealBreakCadenceMinutes?: number;
  };
}
```

### 6.2 Route model

```ts
interface RouteSummary {
  provider: "google";
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
  legs: RouteLeg[];
  checkpoints: RouteCheckpoint[];
}

interface RouteLeg {
  startAddress: string;
  endAddress: string;
  distanceMeters: number;
  durationSeconds: number;
}

interface RouteCheckpoint {
  progressPercent: number;
  elapsedSeconds: number;
  lat: number;
  lng: number;
}
```

### 6.3 Slot model

Each recommended stop is first modeled as a slot. Slots describe intent and constraints before any place is chosen.

```ts
type SlotKind = "meal" | "break" | "outdoor" | "attraction" | "fuel" | "surprise";

interface StopSlot {
  id: string;
  kind: SlotKind;
  category: Category;
  mealType?: "breakfast" | "lunch" | "dinner";
  targetArrivalOffsetSeconds: number;
  searchWindowStartOffsetSeconds: number;
  searchWindowEndOffsetSeconds: number;
  expectedDwellMinutes: number;
  daylightSensitive: boolean;
  hardConstraints: string[];
  softConstraints: string[];
}
```

### 6.4 Candidate model

```ts
interface PlaceCandidate {
  id: string;
  provider: "google" | "yelp";
  providerPlaceId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  categories: string[];
  avgRating: number | null;
  ratingCount: number | null;
  priceLevel?: number;
  openHoursText?: string[];
  openIntervals?: Array<{ open: string; close: string }>;
  servesBreakfast?: boolean;
  servesLunch?: boolean;
  servesDinner?: boolean;
  kidFriendly?: boolean;
  reservable?: boolean;
  isChain?: boolean;
  estimatedDwellMinutes?: number;
  detourMinutes: number;
  rejoinDelayMinutes: number;
  routeProgressPercent: number;
  sourceExpiresAt?: string;
}
```

### 6.5 Scoring model

```ts
interface CandidateScoreBreakdown {
  weightedRating: number;
  qualityScore: number;
  slotFit: number;
  categoryFit: number;
  daylightFit: number;
  openNowFit: number;
  preferenceFit: number;
  majorAttractionBoost: number;
  detourPenalty: number;
  totalScore: number;
  reasons: string[];
}

interface RankedSlotRecommendation {
  slotId: string;
  category: Category;
  projectedArrivalAt: string;
  projectedDepartureAt: string;
  candidate: PlaceCandidate;
  score: CandidateScoreBreakdown;
  alternatives: PlaceCandidate[];
}
```

### 6.6 Saved itinerary model

```ts
interface SavedItinerary {
  id: string;
  userId: string;
  tripRequest: TripPlanningRequest;
  routeSummary: RouteSummary;
  slots: StopSlot[];
  selectedStops: RankedSlotRecommendation[];
  skippedCandidateIds: string[];
  userNotes: Array<{ stopId?: string; text: string }>;
  createdAt: string;
  updatedAt: string;
}
```

## 7. Suggested Database Schema

These tables support the domain model while keeping Google-derived content separate from canonical trip records.

### Required tables

- `users`
- `user_preference_profiles`
- `trips`
- `trip_routes`
- `trip_slots`
- `trip_stop_recommendations`
- `trip_stop_alternatives`
- `trip_notes`
- `provider_place_snapshots`
- `trip_feedback_events`

### Table intent

`trips`

- Stores origin and destination labels, place IDs, departure time, itinerary mode, selected categories, and trip status.

`trip_routes`

- Stores route distance, route duration, encoded polyline, and an expiry timestamp for any Google-derived geometry.

`trip_slots`

- Stores the generated slot plan so local replacement can avoid recomputing slot intent.

`trip_stop_recommendations`

- Stores selected stops, arrival time, dwell time, detour time, and score breakdown JSON.

`trip_stop_alternatives`

- Stores a short list of runner-up candidates for faster replacement flows.

`provider_place_snapshots`

- Stores normalized provider payloads with `provider`, `provider_place_id`, `payload_json`, and `expires_at`.
- For Google-derived coordinates and route data, `expires_at` must never exceed 30 consecutive days.

`trip_feedback_events`

- Stores actions such as `pinned_stop`, `replaced_stop`, `skipped_stop`, or `saved_trip` to support transparent preference learning.

## 8. Provider Strategy

### Google in v1

Use Google as the primary provider for:

- Place Autocomplete
- Map rendering
- Route generation
- Along-route place search
- Place details and opening-hours hydration

### Why Google-first is correct for MVP

- One provider keeps matching and deduplication simple.
- The route polyline and along-route place search fit the core product problem.
- Ratings, rating counts, hours, and dining attributes are already available.

### Yelp in phase 2

Yelp should be introduced as an enrichment provider only for restaurant-heavy flows. It should not become a second source of truth for route geometry.

The provider adapter contract should already support future enrichment:

```ts
interface ProviderAdapter {
  searchAlongRoute(input: ProviderSearchRequest): Promise<ProviderCandidate[]>;
  getPlaceDetails(providerPlaceId: string): Promise<ProviderPlaceDetails>;
  normalize(candidate: ProviderCandidate): PlaceCandidate;
}
```

## 9. Slot Planning and Timeline Logic

The Slot Planner is the product's core differentiator.

### 9.1 Base timeline generation

After route creation, generate route checkpoints at fixed progress intervals, for example every 5 percent of route duration. These checkpoints are used to:

- estimate arrival time to a candidate based on route progress
- place target stop bands by elapsed trip time
- update downstream ETAs after stop insertion

### 9.2 Meal slot inference

Meal planning should be based on overlapping the trip timeline with meal windows, not only on route midpoint.

Recommended meal window defaults:

- breakfast: 06:00-10:30
- lunch: 11:00-14:30
- dinner: 17:00-21:00

Algorithm:

1. Convert the trip departure and estimated arrival into local trip time.
2. Identify which meal windows overlap the trip interval.
3. If the user asked for exactly one meal stop, choose the best-fitting meal window by overlap length and distance from departure.
4. If the user asked for two or three meal stops, assign slots to distinct meal windows where possible.
5. If the trip duration is too short to naturally cross a meal window, fall back to a generic food stop anchored near 40 to 60 percent of trip time.

### 9.3 Stop spacing heuristics

Equal spacing is the default heuristic, but never an absolute rule.

Suggested default elapsed-time targets:

- one food stop: 45 to 55 percent of route time, adjusted to the nearest meal window
- two food stops: 35 to 40 percent and 70 to 75 percent
- three food stops: 20 to 25 percent, 50 percent, and 75 to 80 percent
- coffee or rest stops: every 120 to 180 minutes depending on user preference

The planner should create a search window around each target, for example plus or minus 20 minutes of elapsed drive time.

### 9.4 Dwell time defaults

Default dwell durations for scoring and ETA updates:

- breakfast: 35 minutes
- lunch: 45 minutes
- dinner: 60 minutes
- coffee: 20 minutes
- rest stop: 15 minutes
- scenic overlook: 20 minutes
- hike: 90 minutes
- attraction: 60 minutes
- gas: 15 minutes
- EV charging: 35 minutes

These values belong in configuration, not code constants.

### 9.5 Major attraction override

The system may override equal spacing if a major attraction is clearly worth the detour.

V1 heuristic for a major attraction:

- category includes a tourism-oriented type
- average rating is at least 4.5
- rating count is at least 500
- detour is within user tolerance or within a separate hard cap

If a major attraction's total score exceeds the best in-band attraction by a configurable threshold, it can be inserted or substituted even if it is not equidistant.

## 10. Candidate Generation

### 10.1 Search strategy

Candidate generation should happen in two stages.

Stage 1: broad search

- run a Google along-route search for each active slot or category
- request only lightweight fields needed for filtering and rough scoring
- keep a generous but capped candidate pool per slot

Stage 2: detail hydration

- take the top candidates from stage 1, usually 5 to 10 per slot
- request rich details only for those candidates
- compute final scoring and explanation text

### 10.2 Candidate normalization

Every provider result must be normalized into `PlaceCandidate` fields before scoring. The ranking engine must never depend on raw provider payloads.

### 10.3 Search band filtering

Even when Google returns route-biased results across the route, the backend should still filter candidates by distance to the slot's target band.

Each candidate should be projected onto the route polyline and assigned:

- closest route progress percent
- estimated arrival time at that point
- detour minutes from the base route

This keeps recommendations aligned to the trip timeline instead of just being "somewhere along the route."

## 11. Daylight and Opening-Hours Logic

### 11.1 Daylight-sensitive categories

These categories are daylight-sensitive by default:

- hike
- scenic_overlook
- outdoor attractions

### 11.2 Daylight rules

For each daylight-sensitive candidate:

1. Determine the candidate timezone from coordinates.
2. Compute sunrise and sunset for the planned date.
3. Compute projected arrival time using route progress plus previously selected stop delays.
4. Reject or heavily penalize the candidate if:
   - arrival is after sunset and the user does not allow night outdoor activity
   - arrival plus dwell extends meaningfully past sunset

Suggested buffers:

- overlook: arrival must be at least 10 minutes before sunset
- hike: arrival plus expected dwell plus 30-minute safety buffer must end before sunset

### 11.3 Opening-hours rules

`openNowFit` is based on whether the place is open for the full expected dwell interval.

Suggested values:

- 1.0 if open for the full projected stop interval
- 0.6 if open on arrival but likely closes before dwell completes
- 0.3 if closed on arrival but opens within 15 minutes
- 0.0 if closed on arrival and not practical

For meals, opening-hours evaluation should also consider meal-type suitability. A place open at 09:00 but not suitable for breakfast should not score like a true breakfast stop.

## 12. Ranking Engine

### 12.1 Feature calculation

Use the PRD scoring idea, but normalize the components so they are easier to calibrate.

```ts
function calculateScore(input: {
  avgRating: number;
  ratingCount: number;
  detourMinutes: number;
  slotFit: number;
  categoryFit: number;
  daylightFit: number;
  openNowFit: number;
  preferenceFit: number;
  majorAttractionBoost: number;
}) {
  const priorMean = 4.2;
  const priorWeight = 50;

  const weightedRating =
    ((input.avgRating * input.ratingCount) + (priorMean * priorWeight)) /
    (input.ratingCount + priorWeight);

  const qualityScore = weightedRating / 5;
  const detourPenalty = Math.min(input.detourMinutes / 45, 1);

  return {
    weightedRating,
    qualityScore,
    detourPenalty,
    totalScore:
      qualityScore * 0.35 +
      input.slotFit * 0.15 +
      input.categoryFit * 0.10 +
      input.daylightFit * 0.10 +
      input.openNowFit * 0.10 +
      input.preferenceFit * 0.10 +
      input.majorAttractionBoost * 0.10 -
      detourPenalty * 0.20,
  };
}
```

The numeric score is only for ranking. It does not need to map to a user-facing value.

### 12.2 Feature definitions

`slotFit`

- Measures how close projected arrival is to the slot target.
- Example: `1 - min(abs(arrivalOffset - targetOffset) / slotWindowWidth, 1)`.

`categoryFit`

- Measures whether the place matches the requested intent.
- For meals, use servesBreakfast, servesLunch, servesDinner when available.
- For hikes and overlooks, use category mappings and optional provider tags.

`daylightFit`

- Equals 1.0 if safely inside the daylight rule.
- Equals 0.25 to 0.5 when close to the edge.
- Equals 0.0 if it violates the configured daylight rule.

`preferenceFit`

- Weighted sum of explicit preferences such as budget, cuisine, avoid-chains, and attraction tags.
- May include a small learned adjustment from prior user choices.

`majorAttractionBoost`

- Small positive bonus for clearly distinctive attractions.
- Must not overwhelm a severe detour or daylight violation.

### 12.3 Mode-specific weight adjustments

The base weights should be modified by itinerary mode.

`best_overall`

- use the default weights

`fastest_reasonable`

- increase detour penalty
- reduce major attraction boost

`food_focused`

- increase category fit and preference fit for restaurants and coffee
- reduce attraction boost

`experience_focused`

- reduce detour penalty moderately
- increase major attraction boost and daylight-aware outdoor value

## 13. Explanation Generation

Explanations are product value, not decoration. The response should include structured reasons and a human-readable summary.

### Explanation rules

Generate reasons from the strongest features that influenced ranking. Good v1 templates include:

- fits breakfast window
- fits lunch window
- fits dinner window
- adds only X minutes
- open on arrival
- daylight-safe for a Y-minute hike
- rated 4.7 from 2,100 reviews
- matches your low-budget preference
- avoids major-chain options
- strong scenic stop with minimal route deviation

### Explanation payload shape

```ts
interface RecommendationExplanation {
  shortReasons: string[];
  summary: string;
}
```

The UI should show 2 to 4 short reasons on the card and the full summary in the details panel.

## 14. API Design

### 14.1 `POST /api/trips/plan`

Creates a new draft trip plan.

Request body:

```json
{
  "origin": { "label": "Seattle, WA", "googlePlaceId": "abc" },
  "destination": { "label": "Portland, OR", "googlePlaceId": "def" },
  "departureAt": "2026-03-30T08:30:00-07:00",
  "travelMode": "drive",
  "returnTripEnabled": false,
  "itineraryMode": "best_overall",
  "activeCategories": ["lunch", "coffee", "scenic_overlook"],
  "mealStopCount": 1,
  "detourToleranceMinutes": 20,
  "preferences": {
    "budgetLevel": "medium",
    "avoidChains": true,
    "allowNightOutdoor": false
  }
}
```

Response body:

```json
{
  "tripId": "trip_123",
  "route": {
    "distanceMeters": 278000,
    "durationSeconds": 11400,
    "encodedPolyline": "..."
  },
  "timeline": {
    "departureAt": "2026-03-30T08:30:00-07:00",
    "baseArrivalAt": "2026-03-30T11:40:00-07:00",
    "plannedArrivalAt": "2026-03-30T12:35:00-07:00"
  },
  "slots": [],
  "recommendedStops": [],
  "warnings": []
}
```

### 14.2 `POST /api/trips/:tripId/slots/:slotId/replace`

Replaces one stop with the next best alternatives for that slot.

Behavior:

- excludes the current candidate and any explicitly rejected candidate IDs
- rescoring happens locally for the slot and downstream ETA impact
- route geometry is reused unless the replacement is extreme enough to require route refresh

### 14.3 `PATCH /api/trips/:tripId/stops/:stopId`

Mutates a stop state.

Supported actions:

- pin
- skip
- unskip
- add_note
- reorder

### 14.4 `GET /api/trips/:tripId`

Returns the current draft or saved itinerary.

### 14.5 `POST /api/trips/:tripId/save`

Promotes a draft plan to a saved itinerary.

### 14.6 `GET /api/preferences/profile`

Returns explicit and learned user preference data.

### 14.7 `PATCH /api/preferences/profile`

Updates explicit preference settings and resets learned preferences when requested.

## 15. Key API Flow Details

### 15.1 Plan trip flow

```text
Client -> POST /api/trips/plan
API -> Google Routes
API -> Slot Planner
API -> Google Places search along route
API -> Google Place Details for top candidates
API -> Daylight and hours evaluation
API -> Scoring Engine
API -> Persist draft trip
API -> Client
```

### 15.2 Replace stop flow

```text
Client -> POST /api/trips/:tripId/slots/:slotId/replace
API -> Load slot and cached alternatives
API -> Re-score remaining candidates or fetch more if needed
API -> Recompute downstream ETAs only
API -> Persist updated slot selection
API -> Client
```

### 15.3 Reopen saved trip flow

```text
Client -> GET /api/trips/:tripId
API -> Load saved trip
API -> Check provider snapshot expiry
API -> Refresh stale Google-derived geometry or hours if required
API -> Return hydrated itinerary
```

## 16. UI Design and Screen Behavior

The UI should be built around one workspace experience with supporting screens.

### 16.1 Screen 1: Trip Builder

Purpose:

- collect trip inputs quickly
- express trip intent before planning begins

Primary elements:

- origin autocomplete field
- destination autocomplete field
- departure date and time picker
- return trip toggle
- itinerary mode selector
- category toggles and ordering controls
- meal stop count selector
- detour tolerance slider
- quick preferences panel for budget, avoid chains, hiking interest, and child-friendly needs
- primary call to action: build trip

Behavior:

- autocomplete stays client-side, but the final selection sent to the backend includes place ID and label
- form validation blocks unsupported travel modes in v1
- sensible presets are shown for common intents such as fastest reasonable or scenic trip
- on submit, the UI transitions to a loading state with a timeline skeleton rather than a blank page

Mobile behavior:

- form fields stack vertically
- map is hidden until a trip is generated

### 16.2 Screen 2: Trip Workspace

Purpose:

- show the generated itinerary as a coordinated timeline, map, and stop-card view

Desktop layout:

- left column: timeline and stop cards
- right column: Google map with route and selected stops
- top bar: itinerary mode switcher, total extra time, save action

Stop card content:

- slot type and projected arrival time
- place name and rating summary
- detour time and dwell time
- explanation reasons
- actions: pin, replace, skip, view details

Behavior:

- switching itinerary mode re-scores the current candidate pool before falling back to fresh search
- clicking a stop card highlights the map marker and route segment
- warnings are displayed inline, for example "no daylight-safe hikes found"
- the trip summary always shows base ETA versus planned ETA

### 16.3 Screen 3: Replace Stop Drawer

Purpose:

- let the user swap a single stop without rebuilding the entire itinerary

Content:

- current selected stop
- ranked alternatives for that slot
- score explanations and ETA delta per alternative
- option to exclude a candidate from future suggestions in the current trip

Behavior:

- replacing a stop updates only that slot and downstream ETAs
- the drawer remains anchored to the current slot context
- if no cached alternatives are available, the backend fetches more candidates only for that slot

### 16.4 Screen 4: Saved Trips

Purpose:

- reopen prior itineraries and see summary details

Content:

- trip cards with origin, destination, departure date, number of stops, and saved notes
- status badges if provider data requires refresh on reopen

Behavior:

- selecting a saved trip opens the Trip Workspace
- stale provider details are refreshed on demand

### 16.5 Screen 5: Preferences

Purpose:

- keep preference learning transparent and editable

Content:

- explicit preferences such as cuisines, budget, detour tolerance, avoid chains, child-friendly, and break cadence
- learned preferences with source indicators such as "you often keep scenic stops"
- controls to reset learned preferences or turn preference learning off

Behavior:

- changes apply to new trips immediately
- major preference changes may trigger optional reranking of the current draft trip

## 17. Local Re-optimization Rules

The planner must avoid rebuilding everything after every user change.

### Replace

- recompute candidate ranking only for the selected slot
- update downstream ETAs based on the new detour and dwell time
- do not rerun upstream slots

### Pin

- mark the current stop as fixed
- preserve it during future reranking

### Skip

- remove the slot's current candidate
- either leave the slot empty or attempt a replacement based on user choice

### Reorder

- allowed only when the new order does not violate hard constraints
- if reordering causes daylight or hours conflicts, show a warning and require confirmation

## 18. Preference Learning Model

V1 preference learning should be simple, transparent, and reversible.

### Explicit preferences

- entered by the user directly
- always take precedence over learned preferences

### Learned signals

- pinning scenic stops increases scenic preference confidence
- repeatedly replacing chain restaurants with local spots increases avoid-chains preference
- repeatedly skipping long hikes lowers preferred hike duration

### Storage shape

Learned preferences should be stored as small weighted counters, not opaque embeddings or black-box model output.

Example:

```json
{
  "preferScenicStops": 0.8,
  "avoidChains": 0.7,
  "preferredCoffeeCadenceMinutes": 150,
  "preferredMaxHikeMinutes": 45
}
```

## 19. Performance and Cost Controls

### Response-time target

The initial itinerary should usually render in a few seconds for standard day trips.

### Cost controls

- use Google field masks aggressively
- do not hydrate full details for every candidate
- cache short-lived place details for repeat searches during the same session
- cap alternative candidates per slot
- reuse route geometry during local re-optimization

### Suggested caps

- max slots planned in v1: 8
- stage-1 candidates per slot: 20
- hydrated candidates per slot: 5 to 10
- saved alternatives per slot: 3 to 5

## 20. Compliance and Data Retention

### Google map and content usage

If the UI shows Google route or place content visually, the product should stay on a Google map or use a non-map itinerary view. It should not combine Google place or route content with a third-party map.

### Temporary caching

Google-derived latitude, longitude, and route geometry must be treated as expiring data. Store them with `expires_at` and refresh or purge them within the allowed retention window.

### Sensitive keys

- all provider API calls beyond browser autocomplete must be made server-side
- secrets belong in server environment variables
- logs must avoid raw provider payload dumps in production

## 21. Observability

Capture metrics that make planning quality debuggable:

- route request latency
- candidate generation latency per slot
- place hydration latency
- number of candidates found per slot
- score distribution by slot and itinerary mode
- user action events such as replace, pin, skip, and save
- cases where no acceptable candidate is found

These metrics are necessary for tuning weights and search-band rules.

## 22. Implementation Order

### Slice 1: Planning foundation

- trip input form
- route calculation
- slot generation
- draft itinerary response shape

### Slice 2: Recommendation quality

- along-route search
- place hydration
- ranking engine
- explanation text

### Slice 3: Interactive editing

- replace, pin, skip, reorder
- downstream ETA recomputation

### Slice 4: Persistence

- save and reopen trip
- preference profile and feedback events

### Slice 5: Hardening

- observability
- cache expiry enforcement
- rate limiting and failure handling

## 23. Open Questions

These are product decisions that should be locked before implementation starts:

- Will saved itineraries require authenticated user accounts in v1, or is anonymous session persistence acceptable?
- Should gas and EV charging use simple along-route search in v1, or should EV charging wait until vehicle-specific inputs exist?
- What chain-classification source should be used for `avoidChains` in v1: manual heuristics, Google brand data when available, or a curated list?
- Should round trips be planned as two independent one-way itineraries in v1 or as a single linked object with shared preferences?
- Is the default post-plan view map-first or timeline-first on desktop?

## 24. Immediate Next Step

The most practical implementation next step is to translate this document into a thin vertical slice:

1. build the trip input screen
2. implement `POST /api/trips/plan`
3. return route plus generated slots before full place ranking
4. then add candidate search and scoring behind the same contract

That sequence keeps the planner testable early and avoids mixing UI work with ranking complexity on day one.