import SunCalc from 'suncalc';
import tzLookup from 'tz-lookup';
import type { PlaceCandidate, StopSlot, TripPlanningRequest } from '../../types/trip';
import { addMinutes } from '../utils';

interface DaylightResult {
  fit: number;
  reason?: string;
}

export function evaluateDaylightFit(
  request: TripPlanningRequest,
  slot: StopSlot,
  candidate: PlaceCandidate,
  projectedArrivalAt: Date,
): DaylightResult {
  if (!slot.daylightSensitive) {
    return { fit: 1 };
  }

  if (request.preferences.allowNightOutdoor) {
    return { fit: 1, reason: 'night outdoor activity allowed' };
  }

  try {
    const timezone = tzLookup(candidate.lat, candidate.lng);
    const localDate = getLocalDateParts(projectedArrivalAt, timezone);
    const solarAnchor = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day, 12, 0, 0));
    const solarTimes = SunCalc.getTimes(solarAnchor, candidate.lat, candidate.lng);
    const sunset = solarTimes.sunset;
    const projectedEnd = addMinutes(projectedArrivalAt, slot.expectedDwellMinutes + getSafetyBufferMinutes(slot));

    if (projectedArrivalAt >= sunset) {
      return { fit: 0, reason: 'arrives after sunset' };
    }

    if (projectedEnd > sunset) {
      if (slot.category === 'hike') {
        return { fit: 0, reason: 'would run too close to sunset for a safe hike' };
      }

      return { fit: 0.35, reason: 'close to sunset for an outdoor stop' };
    }

    const minutesToSunset = (sunset.getTime() - projectedArrivalAt.getTime()) / 60_000;
    if (minutesToSunset <= 45) {
      return { fit: 0.6, reason: 'works, but is close to sunset' };
    }

    return { fit: 1, reason: `daylight-safe in ${timezone}` };
  } catch {
    return { fit: 0.85, reason: 'timezone lookup unavailable, using a neutral daylight fit' };
  }
}

function getLocalDateParts(date: Date, timezone: string): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value ?? '1970');
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? '1');
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? '1');

  return { year, month, day };
}

function getSafetyBufferMinutes(slot: StopSlot): number {
  if (slot.category === 'hike') {
    return 30;
  }

  if (slot.category === 'scenic_overlook') {
    return 10;
  }

  return 20;
}
