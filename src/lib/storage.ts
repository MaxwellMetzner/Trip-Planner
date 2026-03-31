import { z } from 'zod';
import type { PlannedTrip, PreferenceProfile } from '../types/trip';
import { DEFAULT_PREFERENCES } from './planner/config';

const learnedPreferencesSchema = z.object({
  preferScenicStops: z.number().default(DEFAULT_PREFERENCES.learned.preferScenicStops),
  avoidChains: z.number().default(DEFAULT_PREFERENCES.learned.avoidChains),
  preferLocalFood: z.number().default(DEFAULT_PREFERENCES.learned.preferLocalFood),
  preferredCoffeeCadenceMinutes: z.number().default(DEFAULT_PREFERENCES.learned.preferredCoffeeCadenceMinutes),
  preferredMaxHikeMinutes: z.number().default(DEFAULT_PREFERENCES.learned.preferredMaxHikeMinutes),
});

const preferenceSchema = z.object({
  budgetLevel: z.enum(['low', 'medium', 'high']).optional(),
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

export function loadSavedTrips(): PlannedTrip[] {
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

export function saveTrip(plan: PlannedTrip): PlannedTrip[] {
  const nextTrips = [
    plan,
    ...loadSavedTrips().filter((trip) => trip.id !== plan.id),
  ].slice(0, 12);

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(nextTrips));
  }

  return nextTrips;
}

export function deleteTrip(tripId: string): PlannedTrip[] {
  const nextTrips = loadSavedTrips().filter((trip) => trip.id !== tripId);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(nextTrips));
  }

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

function cloneDefaultPreferences(): PreferenceProfile {
  return {
    ...DEFAULT_PREFERENCES,
    cuisines: [...DEFAULT_PREFERENCES.cuisines],
    attractionTags: [...DEFAULT_PREFERENCES.attractionTags],
    learned: { ...DEFAULT_PREFERENCES.learned },
  };
}
