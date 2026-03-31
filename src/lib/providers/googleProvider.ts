import type { Category, PlaceCandidate, RouteSummary } from '../../types/trip';
import { CATEGORY_QUERIES, CHAIN_HINTS } from '../planner/config';
import type { PlannerProvider, SearchCandidatesArgs } from './types';
import {
  buildCheckpointsFromPath,
  buildRouteBounds,
  buildRoutePath,
  estimateDetourMinutes,
  formatDistanceMeters,
  getPointAtProgress,
  projectPointOntoRoute,
  uid,
} from '../utils';

export class GooglePlannerProvider implements PlannerProvider {
  readonly mode = 'google';
  readonly label = 'Google browser mode';
  readonly supportsAutocomplete = true;

  private readonly directionsService: google.maps.DirectionsService;
  private readonly placesService: google.maps.places.PlacesService;

  constructor() {
    this.directionsService = new google.maps.DirectionsService();
    this.placesService = new google.maps.places.PlacesService(document.createElement('div'));
  }

  async planRoute(request: SearchCandidatesArgs['request']): Promise<RouteSummary> {
    const response = await this.route(request);
    const route = response.routes[0];
    if (!route || !route.legs) {
      throw new Error('Google did not return a usable driving route.');
    }

    const points = (route.overview_path ?? []).map((point) => ({ lat: point.lat(), lng: point.lng() }));
    const durationSeconds = route.legs.reduce((sum, leg) => sum + (leg.duration?.value ?? 0), 0);
    const distanceMeters = route.legs.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0);
    const path = buildRoutePath(points, durationSeconds);

    return {
      provider: 'google',
      distanceMeters,
      durationSeconds,
      encodedPolyline: route.overview_polyline,
      legs: route.legs.map((leg) => ({
        startAddress: leg.start_address,
        endAddress: leg.end_address,
        distanceMeters: leg.distance?.value ?? 0,
        durationSeconds: leg.duration?.value ?? 0,
      })),
      checkpoints: buildCheckpointsFromPath(path),
      path,
      bounds: buildRouteBounds(points),
      summaryText: `Google browser route: ${formatDistanceMeters(distanceMeters)}.`,
    };
  }

  async searchCandidates({ request, route, slot, excludePlaceIds = [] }: SearchCandidatesArgs): Promise<PlaceCandidate[]> {
    const targetPercent = (slot.targetArrivalOffsetSeconds / route.durationSeconds) * 100;
    const anchors = [
      getPointAtProgress(route.path, targetPercent),
      getPointAtProgress(route.path, Math.max(0, targetPercent - 6)),
      getPointAtProgress(route.path, Math.min(100, targetPercent + 6)),
    ];
    const rawByPlaceId = new Map<string, google.maps.places.PlaceResult>();
    const query = buildSearchQuery(slot.category, request.preferences.cuisines[0]);
    const radius = Math.min(25000, Math.max(5000, request.detourToleranceMinutes * 1200));

    for (const anchor of anchors) {
      const results = await this.textSearch({
        location: new google.maps.LatLng(anchor.lat, anchor.lng),
        radius,
        query,
      });

      for (const result of results) {
        if (!result.place_id || excludePlaceIds.includes(result.place_id)) {
          continue;
        }

        rawByPlaceId.set(result.place_id, result);
      }
    }

    const prelim = [...rawByPlaceId.values()]
      .map((result) => this.mapPreliminaryCandidate(result, route))
      .filter((candidate): candidate is PlaceCandidate => Boolean(candidate))
      .filter((candidate) => candidate.detourMinutes <= request.detourToleranceMinutes + 15)
      .sort((left, right) => right.avgRating * Math.log10(right.ratingCount + 10) - left.avgRating * Math.log10(left.ratingCount + 10));

    const hydrated = await Promise.all(prelim.slice(0, 8).map((candidate) => this.hydrateCandidate(candidate, route)));
    return hydrated.filter((candidate): candidate is PlaceCandidate => Boolean(candidate));
  }

  private async route(request: SearchCandidatesArgs['request']): Promise<google.maps.DirectionsResult> {
    const origin = request.origin.googlePlaceId ? { placeId: request.origin.googlePlaceId } : request.origin.label;
    const destination = request.destination.googlePlaceId ? { placeId: request.destination.googlePlaceId } : request.destination.label;

    return new Promise((resolve, reject) => {
      this.directionsService.route(
        {
          origin,
          destination: request.returnTripEnabled ? origin : destination,
          waypoints: request.returnTripEnabled ? [{ location: destination, stopover: true }] : undefined,
          travelMode: google.maps.TravelMode.DRIVING,
          provideRouteAlternatives: false,
          optimizeWaypoints: false,
        },
        (result, status) => {
          if (status === google.maps.DirectionsStatus.OK && result) {
            resolve(result);
            return;
          }

          reject(new Error(`Google routing failed: ${status}`));
        },
      );
    });
  }

  private async textSearch(request: google.maps.places.TextSearchRequest): Promise<google.maps.places.PlaceResult[]> {
    return new Promise((resolve, reject) => {
      this.placesService.textSearch(request, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
          resolve(results);
          return;
        }

        if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
          resolve([]);
          return;
        }

        reject(new Error(`Google place search failed: ${status}`));
      });
    });
  }

  private async getDetails(placeId: string): Promise<google.maps.places.PlaceResult | null> {
    return new Promise((resolve, reject) => {
      this.placesService.getDetails(
        {
          placeId,
          fields: [
            'place_id',
            'name',
            'formatted_address',
            'geometry',
            'rating',
            'user_ratings_total',
            'types',
            'price_level',
            'opening_hours',
            'website',
          ],
        },
        (result, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && result) {
            resolve(result);
            return;
          }

          if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
            resolve(null);
            return;
          }

          reject(new Error(`Google place details failed: ${status}`));
        },
      );
    });
  }

  private mapPreliminaryCandidate(result: google.maps.places.PlaceResult, route: RouteSummary): PlaceCandidate | null {
    const location = result.geometry?.location;
    if (!location || !result.place_id || !result.name) {
      return null;
    }

    const lat = location.lat();
    const lng = location.lng();
    const projected = projectPointOntoRoute(route.path, { lat, lng });
    const detourMinutes = estimateDetourMinutes(projected.distanceFromRouteKm);

    return {
      id: uid('candidate'),
      provider: 'google',
      providerPlaceId: result.place_id,
      name: result.name,
      formattedAddress: result.formatted_address ?? 'Along the route',
      lat,
      lng,
      categories: result.types ?? [],
      avgRating: result.rating ?? 4.1,
      ratingCount: result.user_ratings_total ?? 20,
      priceLevel: result.price_level,
      openHoursText: result.opening_hours?.weekday_text,
      openingHoursPeriods: mapOpeningHours(result.opening_hours?.periods),
      servesBreakfast: inferMealSupport(result, 'breakfast'),
      servesLunch: inferMealSupport(result, 'lunch'),
      servesDinner: inferMealSupport(result, 'dinner'),
      kidFriendly: (result.types ?? []).includes('amusement_park') || (result.types ?? []).includes('park'),
      reservable: false,
      isChain: isChainName(result.name),
      estimatedDwellMinutes: undefined,
      detourMinutes,
      rejoinDelayMinutes: detourMinutes,
      routeProgressPercent: projected.progressPercent,
      sourceExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  private async hydrateCandidate(candidate: PlaceCandidate, route: RouteSummary): Promise<PlaceCandidate | null> {
    const details = await this.getDetails(candidate.providerPlaceId);
    if (!details) {
      return candidate;
    }

    const location = details.geometry?.location;
    const lat = location?.lat() ?? candidate.lat;
    const lng = location?.lng() ?? candidate.lng;
    const projected = projectPointOntoRoute(route.path, { lat, lng });

    return {
      ...candidate,
      name: details.name ?? candidate.name,
      formattedAddress: details.formatted_address ?? candidate.formattedAddress,
      lat,
      lng,
      categories: details.types ?? candidate.categories,
      avgRating: details.rating ?? candidate.avgRating,
      ratingCount: details.user_ratings_total ?? candidate.ratingCount,
      priceLevel: details.price_level ?? candidate.priceLevel,
      openHoursText: details.opening_hours?.weekday_text ?? candidate.openHoursText,
      openingHoursPeriods: mapOpeningHours(details.opening_hours?.periods) ?? candidate.openingHoursPeriods,
      servesBreakfast: inferMealSupport(details, 'breakfast') || candidate.servesBreakfast,
      servesLunch: inferMealSupport(details, 'lunch') || candidate.servesLunch,
      servesDinner: inferMealSupport(details, 'dinner') || candidate.servesDinner,
      isChain: details.name ? isChainName(details.name) : candidate.isChain,
      detourMinutes: estimateDetourMinutes(projected.distanceFromRouteKm),
      rejoinDelayMinutes: estimateDetourMinutes(projected.distanceFromRouteKm),
      routeProgressPercent: projected.progressPercent,
      website: details.website,
    };
  }
}

function buildSearchQuery(category: Category, cuisineHint?: string): string {
  const baseQuery = CATEGORY_QUERIES[category][0];
  if (!cuisineHint || !['breakfast', 'lunch', 'dinner'].includes(category)) {
    return baseQuery;
  }

  return `${cuisineHint} ${baseQuery}`;
}

function inferMealSupport(result: google.maps.places.PlaceResult, meal: 'breakfast' | 'lunch' | 'dinner'): boolean {
  const name = result.name?.toLowerCase() ?? '';
  const categories = (result.types ?? []).map((value) => value.toLowerCase());

  if (meal === 'breakfast') {
    return name.includes('breakfast') || name.includes('brunch') || categories.includes('bakery') || categories.includes('cafe');
  }

  if (meal === 'lunch') {
    return categories.includes('restaurant') || categories.includes('meal_takeaway') || categories.includes('cafe');
  }

  return categories.includes('restaurant') || name.includes('grill') || name.includes('kitchen');
}

function mapOpeningHours(periods?: google.maps.places.PlaceOpeningHoursPeriod[]): PlaceCandidate['openingHoursPeriods'] {
  if (!periods || periods.length === 0) {
    return undefined;
  }

  return periods
    .filter((period) => period.open)
    .map((period) => ({
      openDay: period.open!.day,
      openTime: formatGoogleTime(period.open!.hours, period.open!.minutes),
      closeDay: period.close?.day ?? period.open!.day,
      closeTime: formatGoogleTime(period.close?.hours ?? 23, period.close?.minutes ?? 59),
    }));
}

function formatGoogleTime(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function isChainName(name: string): boolean {
  const lowerName = name.toLowerCase();
  return CHAIN_HINTS.some((hint) => lowerName.includes(hint));
}
