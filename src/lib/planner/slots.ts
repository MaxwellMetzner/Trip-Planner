import type { Category, StopSlot, TripPlanningRequest, RouteSummary } from '../../types/trip';
import {
  CATEGORY_DAYLIGHT_SENSITIVE,
  CATEGORY_DWELL_MINUTES,
  DEFAULT_MEAL_WINDOWS,
  getCategoryCount,
} from './config';
import { clamp, uid } from '../utils';

interface WindowInterval {
  category: 'breakfast' | 'lunch' | 'dinner';
  startMinutes: number;
  endMinutes: number;
}

export function createStopSlots(request: TripPlanningRequest, route: RouteSummary): StopSlot[] {
  const slots: StopSlot[] = [];
  slots.push(...createMealSlots(request, route));
  slots.push(...createCategorySlots(request, route, ['coffee', 'rest_stop', 'scenic_overlook', 'hike', 'attraction', 'gas', 'ev_charging', 'surprise']));
  return slots.sort((left, right) => left.targetArrivalOffsetSeconds - right.targetArrivalOffsetSeconds);
}

function createMealSlots(request: TripPlanningRequest, route: RouteSummary): StopSlot[] {
  if (request.mealStopCount === 0) {
    return [];
  }

  const departure = new Date(request.departureAt);
  const arrival = new Date(departure.getTime() + route.durationSeconds * 1000);
  const windows: WindowInterval[] = [
    { category: 'breakfast', ...toMinutesRange(request.mealWindows.breakfast ?? DEFAULT_MEAL_WINDOWS.breakfast) },
    { category: 'lunch', ...toMinutesRange(request.mealWindows.lunch ?? DEFAULT_MEAL_WINDOWS.lunch) },
    { category: 'dinner', ...toMinutesRange(request.mealWindows.dinner ?? DEFAULT_MEAL_WINDOWS.dinner) },
  ];

  const overlapping = windows.filter((window) => overlapsTripWindow(window, departure, arrival));
  const candidates = overlapping.length > 0 ? overlapping : windows;
  const selected = chooseMealWindows(candidates, request.mealStopCount, route.durationSeconds);

  return selected.map((window, index) => {
    const targetMinutes = getTargetMinutesForMealWindow(window, departure, route.durationSeconds);
    const targetOffsetSeconds = clamp(targetMinutes * 60, route.durationSeconds * 0.15, route.durationSeconds * 0.92);

    return createSlot(window.category, targetOffsetSeconds, 30 * 60, index);
  });
}

function chooseMealWindows(windows: WindowInterval[], count: number, durationSeconds: number): WindowInterval[] {
  const sorted = [...windows].sort((left, right) => left.startMinutes - right.startMinutes);
  if (count >= sorted.length) {
    return sorted;
  }

  const targetPercents = count === 1 ? [0.5] : count === 2 ? [0.37, 0.73] : [0.22, 0.52, 0.78];
  const targetMinutes = targetPercents.map((percent) => (durationSeconds / 60) * percent);
  const remaining = [...sorted];
  const picked: WindowInterval[] = [];

  for (const target of targetMinutes) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    remaining.forEach((window, index) => {
      const midpoint = (window.startMinutes + window.endMinutes) / 2;
      const distance = Math.abs(midpoint - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    picked.push(remaining.splice(bestIndex, 1)[0]);
  }

  return picked.sort((left, right) => left.startMinutes - right.startMinutes);
}

function createCategorySlots(request: TripPlanningRequest, route: RouteSummary, categories: Category[]): StopSlot[] {
  const slots: StopSlot[] = [];

  categories.forEach((category) => {
    const count = getCategoryCount(request, category);
    if (count <= 0) {
      return;
    }

    const targets = spreadTargets(category, count, route.durationSeconds, request.preferences.idealBreakCadenceMinutes);
    targets.forEach((target, index) => {
      slots.push(createSlot(category, target, getSearchWindowSeconds(category), index));
    });
  });

  return slots;
}

function spreadTargets(category: Category, count: number, durationSeconds: number, idealBreakCadenceMinutes: number): number[] {
  if (count === 1) {
    if (category === 'coffee' || category === 'rest_stop') {
      const target = Math.min(durationSeconds * 0.55, idealBreakCadenceMinutes * 60);
      return [clamp(target, durationSeconds * 0.18, durationSeconds * 0.9)];
    }

    return [durationSeconds * 0.58];
  }

  const start = category === 'coffee' || category === 'rest_stop' ? 0.2 : 0.25;
  const end = category === 'coffee' || category === 'rest_stop' ? 0.82 : 0.78;
  const span = end - start;

  return Array.from({ length: count }, (_, index) => durationSeconds * (start + (span * index) / (count - 1)));
}

function createSlot(category: Category, targetOffsetSeconds: number, searchWindowSeconds: number, index: number): StopSlot {
  return {
    id: uid(`${category}_${index}`),
    kind: categoryToSlotKind(category),
    category,
    mealType: category === 'breakfast' || category === 'lunch' || category === 'dinner' ? category : undefined,
    targetArrivalOffsetSeconds: Math.round(targetOffsetSeconds),
    searchWindowStartOffsetSeconds: Math.max(0, Math.round(targetOffsetSeconds - searchWindowSeconds)),
    searchWindowEndOffsetSeconds: Math.round(targetOffsetSeconds + searchWindowSeconds),
    expectedDwellMinutes: CATEGORY_DWELL_MINUTES[category],
    daylightSensitive: CATEGORY_DAYLIGHT_SENSITIVE.has(category),
    hardConstraints: category === 'hike' ? ['daylight_required'] : [],
    softConstraints: category === 'coffee' ? ['near cadence target'] : [],
  };
}

function categoryToSlotKind(category: Category): StopSlot['kind'] {
  if (category === 'breakfast' || category === 'lunch' || category === 'dinner') {
    return 'meal';
  }

  if (category === 'coffee' || category === 'rest_stop') {
    return 'break';
  }

  if (category === 'scenic_overlook' || category === 'hike') {
    return 'outdoor';
  }

  if (category === 'gas' || category === 'ev_charging') {
    return 'fuel';
  }

  if (category === 'surprise') {
    return 'surprise';
  }

  return 'attraction';
}

function toMinutesRange(window: { start: string; end: string }): { startMinutes: number; endMinutes: number } {
  return {
    startMinutes: timeStringToMinutes(window.start),
    endMinutes: timeStringToMinutes(window.end),
  };
}

function timeStringToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function overlapsTripWindow(window: WindowInterval, departure: Date, arrival: Date): boolean {
  const start = departure.getHours() * 60 + departure.getMinutes();
  const end = arrival.getHours() * 60 + arrival.getMinutes();
  return window.endMinutes >= start && window.startMinutes <= end;
}

function getTargetMinutesForMealWindow(window: WindowInterval, departure: Date, durationSeconds: number): number {
  const departureMinutes = departure.getHours() * 60 + departure.getMinutes();
  const midpoint = (window.startMinutes + window.endMinutes) / 2;
  const elapsedTarget = midpoint - departureMinutes;
  const routeMinutes = durationSeconds / 60;

  return clamp(elapsedTarget, routeMinutes * 0.18, routeMinutes * 0.9);
}

function getSearchWindowSeconds(category: Category): number {
  if (category === 'coffee' || category === 'rest_stop') {
    return 25 * 60;
  }

  if (category === 'hike' || category === 'attraction') {
    return 35 * 60;
  }

  return 20 * 60;
}
