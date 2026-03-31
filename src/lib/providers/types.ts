import type { PlaceCandidate, RouteSummary, StopSlot, TripPlanningRequest } from '../../types/trip';

export interface SearchCandidatesArgs {
  request: TripPlanningRequest;
  route: RouteSummary;
  slot: StopSlot;
  excludePlaceIds?: string[];
}

export interface PlannerProvider {
  mode: 'google' | 'demo';
  label: string;
  supportsAutocomplete: boolean;
  planRoute(request: TripPlanningRequest): Promise<RouteSummary>;
  searchCandidates(args: SearchCandidatesArgs): Promise<PlaceCandidate[]>;
}
