import { z } from 'zod';
import type { PlannedTrip, PreferenceProfile } from '../types/trip';
import { DEFAULT_PREFERENCES } from './planner/config';

const PROVIDER_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const learnedPreferencesSchema = z.object({
  preferScenicStops: z.number().default(DEFAULT_PREFERENCES.learned.preferScenicStops),
  avoidChains: z.number().default(DEFAULT_PREFERENCES.learned.avoidChains),
  preferLocalFood: z.number().default(DEFAULT_PREFERENCES.learned.preferLocalFood),
  preferredCoffeeCadenceMinutes: z.number().default(DEFAULT_PREFERENCES.learned.preferredCoffeeCadenceMinutes),
  preferredMaxHikeMinutes: z.number().default(DEFAULT_PREFERENCES.learned.preferredMaxHikeMinutes),
});

const preferenceSchema = z.object({
  budgetLevel: z.enum(['low', 'medium', 'high']).optional(),
  travelParty: z.enum(['solo', 'couple', 'family', 'friends']).default(DEFAULT_PREFERENCES.travelParty),
  tripTemperament: z
    .enum(['efficient', 'balanced', 'local_texture', 'scenic_collector', 'comfort_buffer'])
    .default(DEFAULT_PREFERENCES.tripTemperament),
  energyCurve: z.enum(['early_peak', 'steady', 'late_riser']).default(DEFAULT_PREFERENCES.energyCurve),
  stopPacing: z.enum(['quick_hits', 'balanced', 'linger']).default(DEFAULT_PREFERENCES.stopPacing),
  foodPriority: z.number().default(DEFAULT_PREFERENCES.foodPriority),
  sceneryPriority: z.number().default(DEFAULT_PREFERENCES.sceneryPriority),
  comfortPriority: z.number().default(DEFAULT_PREFERENCES.comfortPriority),
  surprisePriority: z.number().default(DEFAULT_PREFERENCES.surprisePriority),
  quietPriority: z.number().default(DEFAULT_PREFERENCES.quietPriority),
  cuisines: z.array(z.string()).default([]),
  attractionTags: z.array(z.string()).default([]),
  hikingInterest: z.enum(['none', 'light', 'moderate', 'high']).optional(),
  avoidChains: z.boolean().default(false),
  childFriendly: z.boolean().default(false),
  allowNightOutdoor: z.boolean().default(false),
  idealBreakCadenceMinutes: z.number().default(DEFAULT_PREFERENCES.idealBreakCadenceMinutes),
  learned: learnedPreferencesSchema.default(DEFAULT_PREFERENCES.learned),
});

const PREFERENCES_KEY = 'trip-planner:preferences';
const SAVED_TRIPS_KEY = 'trip-planner:saved-trips';

export interface SavedTripsSnapshot {
  trips: PlannedTrip[];
  expiredTripCount: number;
}

export function loadPreferences(): PreferenceProfile {
  if (typeof window === 'undefined') {
    return cloneDefaultPreferences();
  }

  const raw = window.localStorage.getItem(PREFERENCES_KEY);
  if (!raw) {
    return cloneDefaultPreferences();
  }

  try {
    const parsed = JSON.parse(raw);
    return preferenceSchema.parse(parsed);
  } catch {
    return cloneDefaultPreferences();
  }
}

export function savePreferences(preferences: PreferenceProfile): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

export function loadSavedTripsSnapshot(): SavedTripsSnapshot {
  if (typeof window === 'undefined') {
    return { trips: [], expiredTripCount: 0 };
  }

  const storedTrips = readSavedTripsFromStorage();
  const { trips, expiredTripCount } = pruneExpiredTrips(storedTrips);

  if (expiredTripCount > 0) {
    persistSavedTrips(trips);
  }

  return { trips, expiredTripCount };
}

export function loadSavedTrips(): PlannedTrip[] {
  return loadSavedTripsSnapshot().trips;
}

export function saveTrip(plan: PlannedTrip): SavedTripsSnapshot {
  const storedTrips = readSavedTripsFromStorage().filter((trip) => trip.id !== plan.id);
  const { trips: activeTrips, expiredTripCount } = pruneExpiredTrips(storedTrips);
  const nextTrips = [plan, ...activeTrips].slice(0, 12);

  persistSavedTrips(nextTrips);

  return {
    trips: nextTrips,
    expiredTripCount,
  };
}

export function deleteTrip(tripId: string): PlannedTrip[] {
  const nextTrips = loadSavedTrips().filter((trip) => trip.id !== tripId);
  persistSavedTrips(nextTrips);

  return nextTrips;
}

export function deriveLearnedPreferences(trips: PlannedTrip[], base: PreferenceProfile): PreferenceProfile {
  if (trips.length === 0) {
    return base;
  }

  let scenicPins = 0;
  let foodReplacements = 0;
  let chainAvoidanceEvents = 0;
  let coffeeSelections = 0;
  let coffeeDetourTotal = 0;
  let hikeSelections = 0;
  let hikeMinutesTotal = 0;

  trips.forEach((trip) => {
    trip.recommendations.forEach((recommendation) => {
      if (recommendation.status === 'pinned' && recommendation.category === 'scenic_overlook') {
        scenicPins += 1;
      }

      if (recommendation.category === 'coffee' && recommendation.status !== 'skipped') {
        coffeeSelections += 1;
        coffeeDetourTotal += recommendation.candidate.detourMinutes;
      }

      if (['breakfast', 'lunch', 'dinner', 'coffee'].includes(recommendation.category) && !recommendation.candidate.isChain) {
        foodReplacements += 1;
      }

      if (recommendation.candidate.isChain === false) {
        chainAvoidanceEvents += 1;
      }

      if (recommendation.category === 'hike' && recommendation.status !== 'skipped') {
        hikeSelections += 1;
        const tripSlot = trip.slots.find((slot) => slot.id === recommendation.slotId);
        hikeMinutesTotal += tripSlot?.expectedDwellMinutes ?? 0;
      }
    });
  });

  return {
    ...base,
    learned: {
      preferScenicStops: clampToUnit(base.learned.preferScenicStops + scenicPins / (trips.length * 3)),
      avoidChains: clampToUnit(base.learned.avoidChains + chainAvoidanceEvents / Math.max(1, trips.length * 4)),
      preferLocalFood: clampToUnit(base.learned.preferLocalFood + foodReplacements / Math.max(1, trips.length * 4)),
      preferredCoffeeCadenceMinutes:
        coffeeSelections > 0
          ? Math.round(base.idealBreakCadenceMinutes + coffeeDetourTotal / coffeeSelections * 3)
          : base.learned.preferredCoffeeCadenceMinutes,
      preferredMaxHikeMinutes:
        hikeSelections > 0
          ? Math.round(hikeMinutesTotal / hikeSelections)
          : base.learned.preferredMaxHikeMinutes,
    },
  };
}

function clampToUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function readSavedTripsFromStorage(): PlannedTrip[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(SAVED_TRIPS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed as PlannedTrip[];
  } catch {
    return [];
  }
}

function persistSavedTrips(trips: PlannedTrip[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(trips));
}

function pruneExpiredTrips(trips: PlannedTrip[]): SavedTripsSnapshot {
  const now = Date.now();
  const activeTrips = trips.filter((trip) => !isExpiredTrip(trip, now));

  return {
    trips: activeTrips,
    expiredTripCount: trips.length - activeTrips.length,
  };
}

function isExpiredTrip(trip: PlannedTrip, now: number): boolean {
  if (trip.providerMode !== 'google') {
    return false;
  }

  const expiresAt = getTripExpiresAt(trip);
  return expiresAt !== null && expiresAt <= now;
}

function getTripExpiresAt(trip: PlannedTrip): number | null {
  const candidateExpirations = trip.recommendations.flatMap((recommendation) => {
    const candidates = [recommendation.candidate, ...recommendation.alternatives];
    return candidates
      .map((candidate) => Date.parse(candidate.sourceExpiresAt ?? ''))
      .filter((value) => Number.isFinite(value));
  });

  if (candidateExpirations.length > 0) {
    return Math.min(...candidateExpirations);
  }

  const fallbackBase = Date.parse(trip.updatedAt || trip.createdAt);
  if (Number.isFinite(fallbackBase)) {
    return fallbackBase + PROVIDER_SNAPSHOT_TTL_MS;
  }

  return null;
}

function cloneDefaultPreferences(): PreferenceProfile {
  return {
    ...DEFAULT_PREFERENCES,
    cuisines: [...DEFAULT_PREFERENCES.cuisines],
    attractionTags: [...DEFAULT_PREFERENCES.attractionTags],
    learned: { ...DEFAULT_PREFERENCES.learned },
  };
}
