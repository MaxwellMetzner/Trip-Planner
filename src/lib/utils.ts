import type { Category, CategoryImportance, OpeningHoursPeriod, RouteBounds, RouteCheckpoint } from '../types/trip';
import { IMPORTANCE_MULTIPLIER } from './planner/config';

export interface LatLngLike {
  lat: number;
  lng: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash >>> 0);
}

export function seededNumber(seed: string, min: number, max: number): number {
  const hash = hashString(seed);
  const ratio = (hash % 10000) / 10000;
  return min + ratio * (max - min);
}

export function toDateTimeLocalInputValue(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function parseDateTimeLocal(value: string): string {
  if (!value) {
    return new Date().toISOString();
  }

  return new Date(value).toISOString();
}

export function addMinutes(value: string | Date, minutes: number): Date {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setMinutes(date.getMinutes() + minutes);
  return date;
}

export function addSeconds(value: string | Date, seconds: number): Date {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setSeconds(date.getSeconds() + seconds);
  return date;
}

export function formatDurationMinutes(totalMinutes: number): string {
  const rounded = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
}

export function formatDistanceMeters(distanceMeters: number): string {
  const miles = distanceMeters / 1609.34;
  if (miles >= 100) {
    return `${Math.round(miles)} mi`;
  }

  return `${miles.toFixed(1)} mi`;
}

export function formatClock(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatDateLabel(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatNumberCompact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact' }).format(value);
}

export function getImportanceMultiplier(value?: CategoryImportance): number {
  return IMPORTANCE_MULTIPLIER[value ?? 'medium'];
}

export function haversineDistanceKm(start: LatLngLike, end: LatLngLike): number {
  const radiusKm = 6371;
  const dLat = toRadians(end.lat - start.lat);
  const dLng = toRadians(end.lng - start.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(start.lat)) *
      Math.cos(toRadians(end.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radiusKm * c;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function buildRouteBounds(points: LatLngLike[]): RouteBounds {
  const latitudes = points.map((point) => point.lat);
  const longitudes = points.map((point) => point.lng);

  return {
    north: Math.max(...latitudes),
    south: Math.min(...latitudes),
    east: Math.max(...longitudes),
    west: Math.min(...longitudes),
  };
}

export function buildRoutePath(points: LatLngLike[], durationSeconds: number): RouteCheckpoint[] {
  if (points.length === 0) {
    return [];
  }

  const segments: number[] = [];
  let totalDistanceKm = 0;
  for (let index = 1; index < points.length; index += 1) {
    const distanceKm = haversineDistanceKm(points[index - 1], points[index]);
    segments.push(distanceKm);
    totalDistanceKm += distanceKm;
  }

  let travelledKm = 0;
  return points.map((point, index) => {
    if (index > 0) {
      travelledKm += segments[index - 1] ?? 0;
    }

    const progressPercent = totalDistanceKm === 0 ? 0 : (travelledKm / totalDistanceKm) * 100;
    const elapsedSeconds = Math.round((progressPercent / 100) * durationSeconds);

    return {
      lat: point.lat,
      lng: point.lng,
      progressPercent,
      elapsedSeconds,
    };
  });
}

export function buildCheckpointsFromPath(path: RouteCheckpoint[], everyPercent = 5): RouteCheckpoint[] {
  if (path.length === 0) {
    return [];
  }

  const checkpoints: RouteCheckpoint[] = [];
  for (let percent = 0; percent <= 100; percent += everyPercent) {
    checkpoints.push(getPointAtProgress(path, percent));
  }
  return checkpoints;
}

export function getPointAtProgress(path: RouteCheckpoint[], percent: number): RouteCheckpoint {
  if (path.length === 0) {
    return { lat: 0, lng: 0, progressPercent: percent, elapsedSeconds: 0 };
  }

  const target = clamp(percent, 0, 100);
  let previous = path[0];

  for (const point of path) {
    if (point.progressPercent >= target) {
      const delta = point.progressPercent - previous.progressPercent;
      if (delta <= 0) {
        return { ...point, progressPercent: target };
      }

      const ratio = (target - previous.progressPercent) / delta;
      return {
        lat: previous.lat + (point.lat - previous.lat) * ratio,
        lng: previous.lng + (point.lng - previous.lng) * ratio,
        progressPercent: target,
        elapsedSeconds: Math.round(previous.elapsedSeconds + (point.elapsedSeconds - previous.elapsedSeconds) * ratio),
      };
    }

    previous = point;
  }

  return { ...path[path.length - 1], progressPercent: target };
}

export function projectPointOntoRoute(path: RouteCheckpoint[], point: LatLngLike): {
  progressPercent: number;
  distanceFromRouteKm: number;
} {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestProgress = 0;

  for (const routePoint of path) {
    const distance = haversineDistanceKm(routePoint, point);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestProgress = routePoint.progressPercent;
    }
  }

  return {
    progressPercent: bestProgress,
    distanceFromRouteKm: bestDistance,
  };
}

export function estimateDetourMinutes(distanceFromRouteKm: number): number {
  return Math.max(2, Math.round(distanceFromRouteKm * 2 * 1.2));
}

export function buildWeeklyHours(openTime: string, closeTime: string): OpeningHoursPeriod[] {
  return Array.from({ length: 7 }, (_, day) => ({
    openDay: day,
    openTime,
    closeDay: day,
    closeTime,
  }));
}

export function parseTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function dayIndexForDate(date: Date): number {
  return date.getDay();
}

export function isOpenDuring(date: Date, dwellMinutes: number, periods?: OpeningHoursPeriod[]): boolean | null {
  if (!periods || periods.length === 0) {
    return null;
  }

  const day = dayIndexForDate(date);
  const startMinutes = date.getHours() * 60 + date.getMinutes();
  const endMinutes = startMinutes + dwellMinutes;

  for (const period of periods) {
    const sameDayWindow = period.openDay === period.closeDay;
    if (!sameDayWindow) {
      continue;
    }

    if (period.openDay !== day) {
      continue;
    }

    const openMinutes = parseTimeToMinutes(period.openTime);
    const closeMinutes = parseTimeToMinutes(period.closeTime);
    if (startMinutes >= openMinutes && endMinutes <= closeMinutes) {
      return true;
    }
  }

  return false;
}

export function normalizeCategoryLabel(category: Category): string {
  return category.replace('_', ' ');
}

export function reorderItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) {
    return items;
  }

  const copy = [...items];
  const [item] = copy.splice(index, 1);
  copy.splice(nextIndex, 0, item);
  return copy;
}
