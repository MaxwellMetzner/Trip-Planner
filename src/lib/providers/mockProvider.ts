import type { Category, PlaceCandidate, PlaceInput, RouteSummary } from '../../types/trip';
import { CATEGORY_QUERIES, CHAIN_HINTS } from '../planner/config';
import type { PlannerProvider, SearchCandidatesArgs } from './types';
import {
  buildCheckpointsFromPath,
  buildRouteBounds,
  buildRoutePath,
  buildWeeklyHours,
  estimateDetourMinutes,
  getPointAtProgress,
  hashString,
  haversineDistanceKm,
  projectPointOntoRoute,
  seededNumber,
  uid,
} from '../utils';

const KNOWN_LOCATIONS: Record<string, { lat: number; lng: number }> = {
  'seattle, wa': { lat: 47.6062, lng: -122.3321 },
  'portland, or': { lat: 45.5152, lng: -122.6784 },
  'san francisco, ca': { lat: 37.7749, lng: -122.4194 },
  'los angeles, ca': { lat: 34.0522, lng: -118.2437 },
  'new york, ny': { lat: 40.7128, lng: -74.006 },
  'denver, co': { lat: 39.7392, lng: -104.9903 },
  chicago: { lat: 41.8781, lng: -87.6298 },
  austin: { lat: 30.2672, lng: -97.7431 },
  miami: { lat: 25.7617, lng: -80.1918 },
};

const DEMO_NAMES = {
  breakfast: ['Sunrise Biscuit Co.', 'Blue Hour Brunch', 'Milestone Diner', 'Maple Table Cafe'],
  lunch: ['Milepost Kitchen', 'Oak & Ember Lunchroom', 'Roadhouse Pantry', 'Harvest Junction'],
  dinner: ['Copper Lantern', 'River Mile Grill', 'Waypoint Supper Club', 'Cinder & Salt'],
  coffee: ['Signal Roast', 'Switchback Coffee', 'Trailhead Espresso', 'Lantern Coffee Lab'],
  rest_stop: ['Pine Bluff Rest Area', 'Canyon View Travel Plaza', 'North Fork Break Point', 'Silverline Travel Stop'],
  scenic_overlook: ['High Meadow Overlook', 'Eagle Crest Viewpoint', 'Basalt Rim Lookout', 'Cascade Vista Pullout'],
  hike: ['Cedar Run Trail', 'Windfall Ridge Loop', 'Silver Fern Path', 'Juniper Saddle Trail'],
  attraction: ['Foundry Museum', 'Canyon Rail Depot', 'Riverbend Landmark', 'Skyline Heritage Center'],
  gas: ['Summit Fuel', 'Northline Gas', 'Cedar Crest Fuel', 'Waypoint Fuel Depot'],
  ev_charging: ['Volt Harbor Charging', 'SwitchGrid Fast Charge', 'Current Junction', 'Pinewire Supercharge'],
  surprise: ['Old Mill Garden', 'Hidden Spring Market', 'Sky Cabin Gallery', 'Ridgefield Curiosity House'],
} as const;

export class MockPlannerProvider implements PlannerProvider {
  readonly mode = 'demo';
  readonly label = 'Demo planner';
  readonly supportsAutocomplete = false;

  async planRoute(request: SearchCandidatesArgs['request']): Promise<RouteSummary> {
    const origin = resolveLocation(request.origin);
    const destination = resolveLocation(request.destination);
    const curveStrength = seededNumber(`${request.origin.label}-${request.destination.label}-curve`, 0.35, 1.15);
    const outbound = Array.from({ length: 28 }, (_, index) => {
      const ratio = index / 27;
      const arc = Math.sin(ratio * Math.PI) * curveStrength;
      const lat = origin.lat + (destination.lat - origin.lat) * ratio + arc * 0.45;
      const lng = origin.lng + (destination.lng - origin.lng) * ratio + arc * 0.65;
      return { lat, lng };
    });
    const pathPoints = request.returnTripEnabled
      ? [...outbound, ...[...outbound].reverse().slice(1)]
      : outbound;

    const distanceKm = pathPoints.slice(1).reduce((sum, point, index) => sum + haversineDistanceKm(pathPoints[index], point), 0) * 1.04;
    const durationSeconds = Math.round((distanceKm / 88) * 3600);
    const path = buildRoutePath(pathPoints, durationSeconds);

    return {
      provider: 'demo',
      distanceMeters: Math.round(distanceKm * 1000),
      durationSeconds,
      legs: request.returnTripEnabled
        ? [
            {
              startAddress: request.origin.label,
              endAddress: request.destination.label,
              distanceMeters: Math.round((distanceKm * 1000) / 2),
              durationSeconds: Math.round(durationSeconds / 2),
            },
            {
              startAddress: request.destination.label,
              endAddress: request.origin.label,
              distanceMeters: Math.round((distanceKm * 1000) / 2),
              durationSeconds: Math.round(durationSeconds / 2),
            },
          ]
        : [
            {
              startAddress: request.origin.label,
              endAddress: request.destination.label,
              distanceMeters: Math.round(distanceKm * 1000),
              durationSeconds,
            },
          ],
      checkpoints: buildCheckpointsFromPath(path),
      path,
      bounds: buildRouteBounds(pathPoints),
      summaryText: request.returnTripEnabled
        ? 'Client-side demo route generated as a same-day out-and-back loop.'
        : 'Client-side demo route generated without a server or external APIs.',
    };
  }

  async searchCandidates({ request, route, slot, excludePlaceIds = [] }: SearchCandidatesArgs): Promise<PlaceCandidate[]> {
    const targetPercent = (slot.targetArrivalOffsetSeconds / route.durationSeconds) * 100;
    const anchors = [
      getPointAtProgress(route.path, targetPercent),
      getPointAtProgress(route.path, Math.max(0, targetPercent - 7)),
      getPointAtProgress(route.path, Math.min(100, targetPercent + 7)),
    ];
    const names = DEMO_NAMES[slot.category];
    const searchQuery = CATEGORY_QUERIES[slot.category][0];
    const candidates: PlaceCandidate[] = [];

    for (let index = 0; index < 12; index += 1) {
      const anchor = anchors[index % anchors.length];
      const seed = `${request.origin.label}-${request.destination.label}-${slot.category}-${index}`;
      const latOffset = seededNumber(`${seed}-lat`, -0.055, 0.055);
      const lngOffset = seededNumber(`${seed}-lng`, -0.055, 0.055);
      const lat = anchor.lat + latOffset;
      const lng = anchor.lng + lngOffset;
      const projected = projectPointOntoRoute(route.path, { lat, lng });
      const detourMinutes = estimateDetourMinutes(projected.distanceFromRouteKm * seededNumber(`${seed}-detour`, 0.8, 1.4));
      const providerPlaceId = `demo-${hashString(seed)}`;
      if (excludePlaceIds.includes(providerPlaceId)) {
        continue;
      }

      const name = names[index % names.length];
      const isChain = seededNumber(`${seed}-chain`, 0, 1) > 0.78;
      const chainName = CHAIN_HINTS[index % CHAIN_HINTS.length]
        .split(' ')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
      const finalName = isChain ? chainName : name;

      candidates.push({
        id: uid('candidate'),
        provider: 'demo',
        providerPlaceId,
        name: finalName,
        formattedAddress: `${Math.round(seededNumber(`${seed}-mile`, 12, 240))} ${searchQuery} Rd`,
        lat,
        lng,
        categories: inferCategories(slot.category),
        avgRating: Number(seededNumber(`${seed}-rating`, 4.0, 4.9).toFixed(1)),
        ratingCount: Math.round(seededNumber(`${seed}-count`, 45, 3200)),
        priceLevel: Math.round(seededNumber(`${seed}-price`, 1, 4)),
        openHoursText: [describeHours(slot.category)],
        openingHoursPeriods: defaultHoursForCategory(slot.category),
        servesBreakfast: slot.category === 'breakfast' || seededNumber(`${seed}-breakfast`, 0, 1) > 0.6,
        servesLunch: slot.category === 'lunch' || ['breakfast', 'coffee'].includes(slot.category) ? seededNumber(`${seed}-lunch`, 0, 1) > 0.3 : true,
        servesDinner: slot.category === 'dinner' || seededNumber(`${seed}-dinner`, 0, 1) > 0.65,
        kidFriendly: seededNumber(`${seed}-kids`, 0, 1) > 0.5,
        reservable: seededNumber(`${seed}-reservable`, 0, 1) > 0.75,
        isChain,
        estimatedDwellMinutes: slot.expectedDwellMinutes,
        detourMinutes,
        rejoinDelayMinutes: detourMinutes,
        routeProgressPercent: projected.progressPercent,
        sourceExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        brief: `Demo ${slot.category.replace('_', ' ')} result generated near the route band.`,
      });
    }

    return candidates.sort((left, right) => {
      const leftScore = left.avgRating - left.detourMinutes * 0.03;
      const rightScore = right.avgRating - right.detourMinutes * 0.03;
      return rightScore - leftScore;
    });
  }
}

function resolveLocation(input: PlaceInput): { lat: number; lng: number } {
  if (typeof input.lat === 'number' && typeof input.lng === 'number') {
    return { lat: input.lat, lng: input.lng };
  }

  const normalized = input.label.trim().toLowerCase();
  if (KNOWN_LOCATIONS[normalized]) {
    return KNOWN_LOCATIONS[normalized];
  }

  const seed = hashString(normalized || 'trip-planner-demo');
  return {
    lat: 27 + (seed % 2000) / 100,
    lng: -124 + (seed % 4200) / 100,
  };
}

function inferCategories(category: Category): string[] {
  if (category === 'breakfast' || category === 'lunch' || category === 'dinner') {
    return ['restaurant', 'food'];
  }

  if (category === 'coffee') {
    return ['cafe', 'food'];
  }

  if (category === 'rest_stop') {
    return ['travel_stop'];
  }

  if (category === 'scenic_overlook') {
    return ['tourist_attraction', 'natural_feature'];
  }

  if (category === 'hike') {
    return ['park', 'trail'];
  }

  if (category === 'gas') {
    return ['gas_station'];
  }

  if (category === 'ev_charging') {
    return ['charging_station'];
  }

  if (category === 'attraction') {
    return ['tourist_attraction', 'museum'];
  }

  return ['point_of_interest'];
}

function describeHours(category: Category): string {
  if (category === 'breakfast') {
    return 'Open daily 6:00 AM-11:00 AM';
  }

  if (category === 'lunch') {
    return 'Open daily 11:00 AM-3:00 PM';
  }

  if (category === 'dinner') {
    return 'Open daily 5:00 PM-10:00 PM';
  }

  if (category === 'coffee') {
    return 'Open daily 5:30 AM-6:00 PM';
  }

  if (category === 'hike' || category === 'scenic_overlook') {
    return 'Best visited 7:00 AM-sunset';
  }

  return 'Open daily 8:00 AM-8:00 PM';
}

function defaultHoursForCategory(category: Category) {
  if (category === 'breakfast') {
    return buildWeeklyHours('06:00', '11:00');
  }

  if (category === 'lunch') {
    return buildWeeklyHours('11:00', '15:00');
  }

  if (category === 'dinner') {
    return buildWeeklyHours('17:00', '22:00');
  }

  if (category === 'coffee') {
    return buildWeeklyHours('05:30', '18:00');
  }

  if (category === 'rest_stop' || category === 'gas' || category === 'ev_charging') {
    return buildWeeklyHours('00:00', '23:59');
  }

  if (category === 'hike' || category === 'scenic_overlook') {
    return buildWeeklyHours('07:00', '19:30');
  }

  return buildWeeklyHours('09:00', '18:00');
}
