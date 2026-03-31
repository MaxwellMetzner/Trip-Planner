import type {
  PlannedTrip,
  PlaceCandidate,
  RankedSlotRecommendation,
  StopSlot,
  TripFeedbackEvent,
  TripPlanningRequest,
} from '../../types/trip';
import { createStopSlots } from './slots';
import { scoreCandidate } from './scoring';
import { PlannerProvider } from '../providers/types';
import { addMinutes, addSeconds, uid } from '../utils';

export async function planTrip(request: TripPlanningRequest, provider: PlannerProvider): Promise<PlannedTrip> {
  const route = await provider.planRoute(request);
  const slots = createStopSlots(request, route);
  const warnings: PlannedTrip['warnings'] = [];
  const recommendations: RankedSlotRecommendation[] = [];
  const usedPlaceIds = new Set<string>();
  let accumulatedExtraMinutes = 0;

  for (const slot of slots) {
    const projectedArrival = addSeconds(request.departureAt, slot.targetArrivalOffsetSeconds + accumulatedExtraMinutes * 60);
    const rawCandidates = await provider.searchCandidates({
      request,
      route,
      slot,
      excludePlaceIds: [...usedPlaceIds],
    });

    if (rawCandidates.length === 0) {
      warnings.push({
        level: 'warning',
        message: `No ${slot.category.replace('_', ' ')} stop was found near its target band.`,
      });
      continue;
    }

    const ranked = rawCandidates
      .map((candidate) => {
        const { score, explanation } = scoreCandidate({
          request,
          slot,
          candidate,
          routeDurationSeconds: route.durationSeconds,
          projectedArrivalAt: projectedArrival,
        });

        return { candidate, score, explanation };
      })
      .sort((left, right) => right.score.totalScore - left.score.totalScore);

    const best = ranked[0];
    if (!best) {
      continue;
    }

    usedPlaceIds.add(best.candidate.providerPlaceId);
    const projectedDeparture = addMinutes(projectedArrival, slot.expectedDwellMinutes + best.candidate.detourMinutes);
    accumulatedExtraMinutes += slot.expectedDwellMinutes + best.candidate.detourMinutes;

    if (slot.daylightSensitive && best.score.daylightFit < 0.5) {
      warnings.push({
        level: 'warning',
        message: `${best.candidate.name} is available, but daylight fit is weak for this ${slot.category.replace('_', ' ')} slot.`,
      });
    }

    recommendations.push({
      slotId: slot.id,
      category: slot.category,
      projectedArrivalAt: projectedArrival.toISOString(),
      projectedDepartureAt: projectedDeparture.toISOString(),
      candidate: best.candidate,
      score: best.score,
      alternatives: ranked.slice(1, 4).map((item) => item.candidate),
      explanation: best.explanation,
      status: 'selected',
    });
  }

  const baseArrivalAt = addSeconds(request.departureAt, route.durationSeconds);
  const plannedArrivalAt = addMinutes(baseArrivalAt, accumulatedExtraMinutes);

  return {
    id: uid('trip'),
    providerMode: provider.mode,
    request,
    route,
    slots,
    recommendations,
    warnings,
    summary: {
      departureAt: new Date(request.departureAt).toISOString(),
      baseArrivalAt: baseArrivalAt.toISOString(),
      plannedArrivalAt: plannedArrivalAt.toISOString(),
      totalDetourMinutes: Math.round(recommendations.reduce((sum, item) => sum + item.candidate.detourMinutes, 0)),
      totalDwellMinutes: Math.round(recommendations.reduce((sum, item) => sum + getSlot(slots, item.slotId).expectedDwellMinutes, 0)),
      totalExtraMinutes: Math.round(accumulatedExtraMinutes),
    },
    feedbackEvents: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function replaceRecommendation(plan: PlannedTrip, slotId: string, nextCandidate?: PlaceCandidate): PlannedTrip {
  const recommendation = plan.recommendations.find((item) => item.slotId === slotId);
  if (!recommendation) {
    return plan;
  }

  const replacement = nextCandidate ?? recommendation.alternatives[0];
  if (!replacement) {
    return plan;
  }

  const alternatives = recommendation.alternatives.filter((candidate) => candidate.providerPlaceId !== replacement.providerPlaceId);
  const updatedRecommendations: RankedSlotRecommendation[] = plan.recommendations.map((item) => {
    if (item.slotId !== slotId) {
      return item;
    }

    return {
      ...item,
      candidate: replacement,
      alternatives: [item.candidate, ...alternatives].slice(0, 4),
      explanation: {
        shortReasons: [`swapped to ${replacement.name}`, ...item.explanation.shortReasons.filter((reason) => !reason.startsWith('swapped to'))].slice(0, 4),
        summary: `${replacement.name} replaces ${item.candidate.name} for this slot.`,
      },
      status: item.status === 'skipped' ? 'selected' : item.status,
    };
  });

  return recomputePlan({
    ...plan,
    recommendations: updatedRecommendations,
    feedbackEvents: [...plan.feedbackEvents, createFeedbackEvent('replaced_stop', slotId, recommendation.category)],
  });
}

export function pinRecommendation(plan: PlannedTrip, slotId: string): PlannedTrip {
  return {
    ...plan,
    recommendations: plan.recommendations.map((item) =>
      item.slotId === slotId ? { ...item, status: item.status === 'pinned' ? 'selected' : 'pinned' } : item,
    ),
    feedbackEvents: [...plan.feedbackEvents, createFeedbackEvent('pinned_stop', slotId, getRecommendation(plan, slotId)?.category)],
    updatedAt: new Date().toISOString(),
  };
}

export function skipRecommendation(plan: PlannedTrip, slotId: string): PlannedTrip {
  const updatedRecommendations: RankedSlotRecommendation[] = plan.recommendations.map((item) =>
    item.slotId === slotId
      ? { ...item, status: item.status === 'skipped' ? 'selected' : 'skipped' }
      : item,
  );

  return recomputePlan({
    ...plan,
    recommendations: updatedRecommendations,
    feedbackEvents: [...plan.feedbackEvents, createFeedbackEvent('skipped_stop', slotId, getRecommendation(plan, slotId)?.category)],
  });
}

function recomputePlan(plan: PlannedTrip): PlannedTrip {
  const sortedRecommendations = [...plan.recommendations].sort(
    (left, right) => getSlot(plan.slots, left.slotId).targetArrivalOffsetSeconds - getSlot(plan.slots, right.slotId).targetArrivalOffsetSeconds,
  );
  let accumulatedExtraMinutes = 0;

  const recommendations: RankedSlotRecommendation[] = sortedRecommendations.map((item) => {
    const slot = getSlot(plan.slots, item.slotId);
    const projectedArrivalAt = addSeconds(plan.request.departureAt, slot.targetArrivalOffsetSeconds + accumulatedExtraMinutes * 60);
    let projectedDepartureAt = projectedArrivalAt;

    if (item.status !== 'skipped') {
      accumulatedExtraMinutes += slot.expectedDwellMinutes + item.candidate.detourMinutes;
      projectedDepartureAt = addMinutes(projectedArrivalAt, slot.expectedDwellMinutes + item.candidate.detourMinutes);
    }

    return {
      ...item,
      projectedArrivalAt: projectedArrivalAt.toISOString(),
      projectedDepartureAt: projectedDepartureAt.toISOString(),
    };
  });

  const baseArrivalAt = addSeconds(plan.request.departureAt, plan.route.durationSeconds);
  const plannedArrivalAt = addMinutes(baseArrivalAt, accumulatedExtraMinutes);

  return {
    ...plan,
    recommendations,
    summary: {
      ...plan.summary,
      baseArrivalAt: baseArrivalAt.toISOString(),
      plannedArrivalAt: plannedArrivalAt.toISOString(),
      totalDetourMinutes: Math.round(recommendations.filter((item) => item.status !== 'skipped').reduce((sum, item) => sum + item.candidate.detourMinutes, 0)),
      totalDwellMinutes: Math.round(recommendations.filter((item) => item.status !== 'skipped').reduce((sum, item) => sum + getSlot(plan.slots, item.slotId).expectedDwellMinutes, 0)),
      totalExtraMinutes: Math.round(accumulatedExtraMinutes),
    },
    updatedAt: new Date().toISOString(),
  };
}

function getSlot(slots: StopSlot[], slotId: string): StopSlot {
  const slot = slots.find((item) => item.id === slotId);
  if (!slot) {
    throw new Error(`Missing slot: ${slotId}`);
  }
  return slot;
}

function getRecommendation(plan: PlannedTrip, slotId: string): RankedSlotRecommendation | undefined {
  return plan.recommendations.find((item) => item.slotId === slotId);
}

function createFeedbackEvent(type: TripFeedbackEvent['type'], slotId?: string, category?: TripFeedbackEvent['category']): TripFeedbackEvent {
  return {
    type,
    slotId,
    category,
    createdAt: new Date().toISOString(),
  };
}
