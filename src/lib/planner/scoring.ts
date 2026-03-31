import type {
  CandidateScoreBreakdown,
  Category,
  PlaceCandidate,
  RecommendationExplanation,
  StopSlot,
  TripPlanningRequest,
} from '../../types/trip';
import { CHAIN_HINTS, CATEGORY_LABELS } from './config';
import { evaluateDaylightFit } from './daylight';
import { clamp, formatNumberCompact, getImportanceMultiplier, isOpenDuring } from '../utils';

interface ScoreCandidateArgs {
  request: TripPlanningRequest;
  slot: StopSlot;
  candidate: PlaceCandidate;
  routeDurationSeconds: number;
  projectedArrivalAt: Date;
}

export function scoreCandidate({
  request,
  slot,
  candidate,
  routeDurationSeconds,
  projectedArrivalAt,
}: ScoreCandidateArgs): {
  score: CandidateScoreBreakdown;
  explanation: RecommendationExplanation;
} {
  const priorMean = 4.2;
  const priorWeight = 50;
  const weightedRating =
    ((candidate.avgRating * candidate.ratingCount) + priorMean * priorWeight) /
    (candidate.ratingCount + priorWeight);
  const qualityScore = weightedRating / 5;
  const slotFit = getSlotFit(slot, candidate, routeDurationSeconds) * getImportanceMultiplier(request.categoryImportance[slot.category]);
  const categoryFit = getCategoryFit(slot.category, candidate);
  const daylight = evaluateDaylightFit(request, slot, candidate, projectedArrivalAt);
  const openNowFit = getOpenNowFit(slot, candidate, projectedArrivalAt);
  const preferenceFit = getPreferenceFit(request, slot.category, candidate);
  const majorAttractionBoost = getMajorAttractionBoost(slot.category, candidate, request.detourToleranceMinutes);
  const detourPenalty = clamp(candidate.detourMinutes / Math.max(15, request.detourToleranceMinutes * 1.5), 0, 1);
  const weights = getModeWeights(request.itineraryMode);

  const totalScore =
    qualityScore * weights.quality +
    slotFit * weights.slot +
    categoryFit * weights.category +
    daylight.fit * weights.daylight +
    openNowFit * weights.openNow +
    preferenceFit * weights.preference +
    majorAttractionBoost * weights.majorAttraction -
    detourPenalty * weights.detourPenalty;

  const reasons = buildReasons({
    slot,
    candidate,
    weightedRating,
    slotFit,
    daylightReason: daylight.reason,
    openNowFit,
    preferenceFit,
    majorAttractionBoost,
  });

  const score: CandidateScoreBreakdown = {
    weightedRating,
    qualityScore,
    slotFit,
    categoryFit,
    daylightFit: daylight.fit,
    openNowFit,
    preferenceFit,
    majorAttractionBoost,
    detourPenalty,
    totalScore,
    reasons,
  };

  return {
    score,
    explanation: {
      shortReasons: reasons.slice(0, 4),
      summary: buildSummary(slot.category, candidate.name, reasons),
    },
  };
}

function getModeWeights(mode: TripPlanningRequest['itineraryMode']): {
  quality: number;
  slot: number;
  category: number;
  daylight: number;
  openNow: number;
  preference: number;
  majorAttraction: number;
  detourPenalty: number;
} {
  const base = {
    quality: 0.35,
    slot: 0.15,
    category: 0.1,
    daylight: 0.1,
    openNow: 0.1,
    preference: 0.1,
    majorAttraction: 0.1,
    detourPenalty: 0.2,
  };

  if (mode === 'fastest_reasonable') {
    return { ...base, detourPenalty: 0.3, majorAttraction: 0.05, slot: 0.18 };
  }

  if (mode === 'food_focused') {
    return { ...base, category: 0.16, preference: 0.14, majorAttraction: 0.04 };
  }

  if (mode === 'experience_focused') {
    return { ...base, detourPenalty: 0.12, majorAttraction: 0.18, daylight: 0.14 };
  }

  return base;
}

function getSlotFit(slot: StopSlot, candidate: PlaceCandidate, routeDurationSeconds: number): number {
  const targetPercent = (slot.targetArrivalOffsetSeconds / routeDurationSeconds) * 100;
  const windowPercent = Math.max(
    6,
    ((slot.searchWindowEndOffsetSeconds - slot.searchWindowStartOffsetSeconds) / routeDurationSeconds) * 100,
  );
  return clamp(1 - Math.abs(candidate.routeProgressPercent - targetPercent) / windowPercent, 0, 1);
}

function getCategoryFit(category: Category, candidate: PlaceCandidate): number {
  const categories = candidate.categories.map((value) => value.toLowerCase());
  const name = candidate.name.toLowerCase();

  if (category === 'breakfast') {
    if (candidate.servesBreakfast) {
      return 1;
    }
    if (name.includes('breakfast') || name.includes('brunch') || categories.includes('bakery') || categories.includes('cafe')) {
      return 0.9;
    }
    return categories.includes('restaurant') ? 0.7 : 0.45;
  }

  if (category === 'lunch' || category === 'dinner') {
    if ((category === 'lunch' && candidate.servesLunch) || (category === 'dinner' && candidate.servesDinner)) {
      return 1;
    }
    if (categories.includes('restaurant') || categories.includes('meal_takeaway')) {
      return 0.88;
    }
    return 0.45;
  }

  if (category === 'coffee') {
    if (categories.includes('cafe') || name.includes('coffee') || name.includes('espresso')) {
      return 1;
    }
    return 0.4;
  }

  if (category === 'rest_stop') {
    return name.includes('rest') || name.includes('travel') ? 1 : 0.65;
  }

  if (category === 'scenic_overlook') {
    return name.includes('overlook') || name.includes('view') || name.includes('lookout') ? 1 : 0.7;
  }

  if (category === 'hike') {
    return name.includes('trail') || categories.includes('park') ? 1 : 0.62;
  }

  if (category === 'attraction') {
    return categories.includes('tourist_attraction') || categories.includes('museum') || categories.includes('park') ? 1 : 0.68;
  }

  if (category === 'gas') {
    return categories.includes('gas_station') ? 1 : 0.55;
  }

  if (category === 'ev_charging') {
    return name.includes('charging') || name.includes('supercharger') ? 1 : 0.6;
  }

  return 0.72;
}

function getOpenNowFit(slot: StopSlot, candidate: PlaceCandidate, projectedArrivalAt: Date): number {
  const result = isOpenDuring(projectedArrivalAt, slot.expectedDwellMinutes, candidate.openingHoursPeriods);
  if (result === null) {
    return 0.72;
  }

  return result ? 1 : 0;
}

function getPreferenceFit(request: TripPlanningRequest, category: Category, candidate: PlaceCandidate): number {
  let fit = 0.55;

  if (request.preferences.budgetLevel && typeof candidate.priceLevel === 'number') {
    const preferred = request.preferences.budgetLevel === 'low' ? 1 : request.preferences.budgetLevel === 'medium' ? 2 : 4;
    fit += 0.15 - Math.min(Math.abs(candidate.priceLevel - preferred) * 0.08, 0.15);
  }

  if (request.preferences.avoidChains) {
    fit += candidate.isChain ? -0.25 : 0.12;
  }

  if (request.preferences.learned.avoidChains > 0.5) {
    fit += candidate.isChain ? -0.1 : 0.08;
  }

  if (request.preferences.childFriendly && candidate.kidFriendly) {
    fit += 0.14;
  }

  if (category === 'coffee') {
    const cadenceDelta = Math.abs(request.preferences.idealBreakCadenceMinutes - request.preferences.learned.preferredCoffeeCadenceMinutes);
    fit += clamp(0.12 - cadenceDelta / 1000, 0, 0.12);
  }

  if (category === 'hike' && candidate.estimatedDwellMinutes) {
    const preferredMax = request.preferences.learned.preferredMaxHikeMinutes;
    fit += candidate.estimatedDwellMinutes <= preferredMax ? 0.12 : -0.12;
  }

  if ((category === 'breakfast' || category === 'lunch' || category === 'dinner' || category === 'coffee') && !candidate.isChain) {
    fit += request.preferences.learned.preferLocalFood * 0.12;
  }

  if (category === 'scenic_overlook' || category === 'attraction') {
    fit += request.preferences.learned.preferScenicStops * 0.14;
  }

  return clamp(fit, 0, 1);
}

function getMajorAttractionBoost(category: Category, candidate: PlaceCandidate, detourToleranceMinutes: number): number {
  if (!['attraction', 'scenic_overlook', 'hike', 'surprise'].includes(category)) {
    return 0;
  }

  if (candidate.avgRating >= 4.5 && candidate.ratingCount >= 500 && candidate.detourMinutes <= detourToleranceMinutes + 8) {
    return 1;
  }

  if (candidate.avgRating >= 4.6 && candidate.ratingCount >= 1500) {
    return 0.7;
  }

  return 0;
}

function buildReasons(input: {
  slot: StopSlot;
  candidate: PlaceCandidate;
  weightedRating: number;
  slotFit: number;
  daylightReason?: string;
  openNowFit: number;
  preferenceFit: number;
  majorAttractionBoost: number;
}): string[] {
  const reasons: string[] = [];

  if (input.slot.mealType) {
    reasons.push(`fits the ${CATEGORY_LABELS[input.slot.mealType].toLowerCase()} window`);
  }

  reasons.push(`${input.weightedRating.toFixed(1)} stars from ${formatNumberCompact(input.candidate.ratingCount)} reviews`);
  reasons.push(`adds only ${input.candidate.detourMinutes} minutes`);

  if (input.slotFit >= 0.8) {
    reasons.push('lands close to the ideal stop band');
  }

  if (input.openNowFit >= 1) {
    reasons.push('open on arrival');
  }

  if (input.daylightReason && input.slot.daylightSensitive) {
    reasons.push(input.daylightReason);
  }

  if (input.preferenceFit >= 0.75) {
    if (input.candidate.isChain) {
      reasons.push('still scores well despite the chain penalty');
    } else {
      reasons.push('matches your saved preferences');
    }
  }

  if (input.majorAttractionBoost >= 0.7) {
    reasons.push('distinctive enough to justify breaking equal spacing');
  }

  if (!input.candidate.isChain && isLikelyLocal(input.candidate.name)) {
    reasons.push('leans local over national chains');
  }

  return uniqueReasons(reasons).slice(0, 5);
}

function uniqueReasons(reasons: string[]): string[] {
  return reasons.filter((reason, index) => reasons.indexOf(reason) === index);
}

function buildSummary(category: Category, placeName: string, reasons: string[]): string {
  const reasonText = reasons.slice(0, 3).join(', ');
  return `${placeName} is the current ${CATEGORY_LABELS[category].toLowerCase()} pick because it ${reasonText}.`;
}

function isLikelyLocal(name: string): boolean {
  const lowerName = name.toLowerCase();
  return !CHAIN_HINTS.some((hint) => lowerName.includes(hint));
}
