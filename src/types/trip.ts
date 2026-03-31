export type TravelMode = 'drive';

export type Category =
  | 'breakfast'
  | 'lunch'
  | 'dinner'
  | 'coffee'
  | 'rest_stop'
  | 'scenic_overlook'
  | 'hike'
  | 'attraction'
  | 'gas'
  | 'ev_charging'
  | 'surprise';

export type ItineraryMode =
  | 'best_overall'
  | 'fastest_reasonable'
  | 'food_focused'
  | 'experience_focused';

export type SlotKind = 'meal' | 'break' | 'outdoor' | 'attraction' | 'fuel' | 'surprise';
export type ProviderMode = 'google' | 'demo';
export type StopStatus = 'selected' | 'pinned' | 'skipped';
export type CategoryImportance = 'low' | 'medium' | 'high';

export interface PlaceInput {
  label: string;
  googlePlaceId?: string;
  lat?: number;
  lng?: number;
}

export interface MealWindow {
  start: string;
  end: string;
}

export interface LearnedPreferences {
  preferScenicStops: number;
  avoidChains: number;
  preferLocalFood: number;
  preferredCoffeeCadenceMinutes: number;
  preferredMaxHikeMinutes: number;
}

export interface PreferenceProfile {
  budgetLevel?: 'low' | 'medium' | 'high';
  cuisines: string[];
  attractionTags: string[];
  hikingInterest?: 'none' | 'light' | 'moderate' | 'high';
  avoidChains: boolean;
  childFriendly: boolean;
  allowNightOutdoor: boolean;
  idealBreakCadenceMinutes: number;
  learned: LearnedPreferences;
}

export interface TripPlanningRequest {
  origin: PlaceInput;
  destination: PlaceInput;
  departureAt: string;
  travelMode: TravelMode;
  returnTripEnabled: boolean;
  itineraryMode: ItineraryMode;
  activeCategories: Category[];
  categoryImportance: Partial<Record<Category, CategoryImportance>>;
  mealStopCount: 0 | 1 | 2 | 3;
  desiredStopsByCategory: Partial<Record<Category, number>>;
  detourToleranceMinutes: number;
  mealWindows: {
    breakfast: MealWindow;
    lunch: MealWindow;
    dinner: MealWindow;
  };
  preferences: PreferenceProfile;
}

export interface RouteLeg {
  startAddress: string;
  endAddress: string;
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteCheckpoint {
  progressPercent: number;
  elapsedSeconds: number;
  lat: number;
  lng: number;
}

export interface RouteBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface RouteSummary {
  provider: ProviderMode;
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline?: string;
  legs: RouteLeg[];
  checkpoints: RouteCheckpoint[];
  path: RouteCheckpoint[];
  bounds: RouteBounds;
  summaryText?: string;
}

export interface OpeningHoursPeriod {
  openDay: number;
  openTime: string;
  closeDay: number;
  closeTime: string;
}

export interface StopSlot {
  id: string;
  kind: SlotKind;
  category: Category;
  mealType?: 'breakfast' | 'lunch' | 'dinner';
  targetArrivalOffsetSeconds: number;
  searchWindowStartOffsetSeconds: number;
  searchWindowEndOffsetSeconds: number;
  expectedDwellMinutes: number;
  daylightSensitive: boolean;
  hardConstraints: string[];
  softConstraints: string[];
}

export interface PlaceCandidate {
  id: string;
  provider: ProviderMode | 'yelp';
  providerPlaceId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  categories: string[];
  avgRating: number;
  ratingCount: number;
  priceLevel?: number;
  openHoursText?: string[];
  openingHoursPeriods?: OpeningHoursPeriod[];
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
  brief?: string;
  website?: string;
}

export interface CandidateScoreBreakdown {
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

export interface RecommendationExplanation {
  shortReasons: string[];
  summary: string;
}

export interface RankedSlotRecommendation {
  slotId: string;
  category: Category;
  projectedArrivalAt: string;
  projectedDepartureAt: string;
  candidate: PlaceCandidate;
  score: CandidateScoreBreakdown;
  alternatives: PlaceCandidate[];
  explanation: RecommendationExplanation;
  status: StopStatus;
}

export interface TripWarning {
  level: 'info' | 'warning';
  message: string;
}

export interface ItinerarySummary {
  departureAt: string;
  baseArrivalAt: string;
  plannedArrivalAt: string;
  totalDetourMinutes: number;
  totalDwellMinutes: number;
  totalExtraMinutes: number;
}

export interface TripFeedbackEvent {
  type: 'pinned_stop' | 'replaced_stop' | 'skipped_stop' | 'saved_trip';
  slotId?: string;
  category?: Category;
  createdAt: string;
}

export interface PlannedTrip {
  id: string;
  providerMode: ProviderMode;
  request: TripPlanningRequest;
  route: RouteSummary;
  slots: StopSlot[];
  recommendations: RankedSlotRecommendation[];
  warnings: TripWarning[];
  summary: ItinerarySummary;
  feedbackEvents: TripFeedbackEvent[];
  createdAt: string;
  updatedAt: string;
}
