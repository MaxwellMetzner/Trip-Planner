import type { Category, CategoryImportance, ItineraryMode, PreferenceProfile, StopSlot, TripPlanningRequest } from '../../types/trip';

export const DEFAULT_MEAL_WINDOWS = {
  breakfast: { start: '06:00', end: '10:30' },
  lunch: { start: '11:00', end: '14:30' },
  dinner: { start: '17:00', end: '21:00' },
} as const;

export const DEFAULT_PREFERENCES: PreferenceProfile = {
  budgetLevel: 'medium',
  travelParty: 'couple',
  tripTemperament: 'balanced',
  energyCurve: 'steady',
  stopPacing: 'balanced',
  foodPriority: 62,
  sceneryPriority: 58,
  comfortPriority: 50,
  surprisePriority: 36,
  quietPriority: 48,
  cuisines: [],
  attractionTags: [],
  hikingInterest: 'moderate',
  avoidChains: false,
  childFriendly: false,
  allowNightOutdoor: false,
  idealBreakCadenceMinutes: 150,
  learned: {
    preferScenicStops: 0.2,
    avoidChains: 0,
    preferLocalFood: 0.4,
    preferredCoffeeCadenceMinutes: 150,
    preferredMaxHikeMinutes: 45,
  },
};

export const CATEGORY_LABELS: Record<Category, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  coffee: 'Coffee',
  rest_stop: 'Rest stop',
  scenic_overlook: 'Scenic overlook',
  hike: 'Hike',
  attraction: 'Attraction',
  gas: 'Gas',
  ev_charging: 'EV charging',
  surprise: 'Surprise me',
};

export const CATEGORY_DWELL_MINUTES: Record<Category, number> = {
  breakfast: 35,
  lunch: 45,
  dinner: 60,
  coffee: 20,
  rest_stop: 15,
  scenic_overlook: 20,
  hike: 90,
  attraction: 60,
  gas: 15,
  ev_charging: 35,
  surprise: 40,
};

export const CATEGORY_DAYLIGHT_SENSITIVE = new Set<Category>(['scenic_overlook', 'hike', 'attraction']);

export const MODE_LABELS: Record<ItineraryMode, string> = {
  best_overall: 'Best overall',
  fastest_reasonable: 'Fastest reasonable',
  food_focused: 'Food-focused',
  experience_focused: 'Experience-focused',
};

export const MODE_DESCRIPTIONS: Record<ItineraryMode, string> = {
  best_overall: 'Balances trusted ratings, timing fit, and detour cost.',
  fastest_reasonable: 'Keeps the trip efficient and resists big detours.',
  food_focused: 'Prioritizes meal quality, coffee, and local food fit.',
  experience_focused: 'Leans into scenic and memorable stops when they are worth it.',
};

export const IMPORTANCE_MULTIPLIER: Record<CategoryImportance, number> = {
  low: 0.92,
  medium: 1,
  high: 1.14,
};

export const CATEGORY_QUERIES: Record<Category, string[]> = {
  breakfast: ['breakfast', 'brunch cafe', 'bakery breakfast'],
  lunch: ['lunch restaurant', 'local lunch', 'casual lunch'],
  dinner: ['dinner restaurant', 'highly rated dinner', 'local dinner'],
  coffee: ['coffee', 'coffee roaster', 'espresso bar'],
  rest_stop: ['rest area', 'travel stop', 'roadside stop'],
  scenic_overlook: ['scenic overlook', 'viewpoint', 'lookout point'],
  hike: ['hiking trail', 'nature trail', 'state park'],
  attraction: ['tourist attraction', 'landmark', 'must see'],
  gas: ['gas station', 'fuel stop'],
  ev_charging: ['ev charging station', 'fast charger'],
  surprise: ['interesting stop', 'hidden gem', 'local favorite'],
};

export const CHAIN_HINTS = [
  'starbucks',
  'mcdonald',
  'subway',
  'burger king',
  'taco bell',
  'wendy',
  'chipotle',
  'panera',
  'shell',
  'chevron',
  'bp',
  'tesla supercharger',
  'pilot',
  'love\'s',
  '7-eleven',
];

export function createDefaultTripRequest(): TripPlanningRequest {
  const departureAt = new Date();
  departureAt.setMinutes(Math.ceil(departureAt.getMinutes() / 15) * 15, 0, 0);
  const localDeparture = new Date(departureAt.getTime() - departureAt.getTimezoneOffset() * 60_000);

  return {
    origin: { label: 'Seattle, WA' },
    destination: { label: 'Portland, OR' },
    departureAt: localDeparture.toISOString().slice(0, 16),
    travelMode: 'drive',
    returnTripEnabled: false,
    itineraryMode: 'best_overall',
    activeCategories: ['coffee', 'scenic_overlook', 'attraction'],
    categoryImportance: {
      coffee: 'medium',
      scenic_overlook: 'high',
      attraction: 'medium',
      lunch: 'high',
    },
    mealStopCount: 1,
    desiredStopsByCategory: {
      coffee: 1,
      scenic_overlook: 1,
      attraction: 1,
    },
    detourToleranceMinutes: 18,
    mealWindows: {
      breakfast: { ...DEFAULT_MEAL_WINDOWS.breakfast },
      lunch: { ...DEFAULT_MEAL_WINDOWS.lunch },
      dinner: { ...DEFAULT_MEAL_WINDOWS.dinner },
    },
    preferences: { ...DEFAULT_PREFERENCES, learned: { ...DEFAULT_PREFERENCES.learned } },
  };
}

export function getCategoryCount(request: TripPlanningRequest, category: Category): number {
  if (category === 'breakfast' || category === 'lunch' || category === 'dinner') {
    return 0;
  }

  const explicitCount = request.desiredStopsByCategory[category];
  if (typeof explicitCount === 'number') {
    return explicitCount;
  }

  return request.activeCategories.includes(category) ? 1 : 0;
}

export function getSlotLabel(slot: StopSlot): string {
  if (slot.mealType) {
    return CATEGORY_LABELS[slot.mealType];
  }

  return CATEGORY_LABELS[slot.category];
}
