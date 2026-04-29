const GOOGLE_STATUS_PATTERN = /:\s*([A-Z_]+)$/;

export function getGoogleErrorMessage(error: unknown): string | null {
  const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (!rawMessage) {
    return null;
  }

  if (rawMessage === 'Missing VITE_GOOGLE_MAPS_API_KEY.') {
    return 'Google browser mode is not configured. Add VITE_GOOGLE_MAPS_API_KEY or switch to Demo.';
  }

  if (rawMessage === 'Google Maps failed to load.') {
    return 'Google Maps could not load in this browser. Check the API key and confirm this origin is allowed in the key HTTP referrer restrictions.';
  }

  if (rawMessage === 'Google browser mode is not ready yet.') {
    return 'Google browser mode is still loading. Wait a moment and try again, or switch to Demo.';
  }

  if (rawMessage === 'Google did not return a usable driving route.') {
    return 'Google could not build a usable driving route for those locations. Re-select the addresses from autocomplete and try again.';
  }

  if (rawMessage.startsWith('Google routing failed:')) {
    return getRoutingErrorMessage(extractGoogleStatus(rawMessage));
  }

  if (rawMessage.startsWith('Google place search failed:')) {
    return getPlacesErrorMessage(extractGoogleStatus(rawMessage), 'search');
  }

  if (rawMessage.startsWith('Google place details failed:')) {
    return getPlacesErrorMessage(extractGoogleStatus(rawMessage), 'details');
  }

  return null;
}

function extractGoogleStatus(message: string): string | null {
  return message.match(GOOGLE_STATUS_PATTERN)?.[1] ?? null;
}

function getRoutingErrorMessage(status: string | null): string {
  switch (status) {
    case 'NOT_FOUND':
      return 'Google could not match one of the trip locations. Pick the address from autocomplete and try again.';
    case 'ZERO_RESULTS':
      return 'Google could not find a drivable route between those locations.';
    case 'OVER_QUERY_LIMIT':
      return 'Google route planning is over the current quota limit. Check Maps Platform billing and quota, then try again.';
    case 'REQUEST_DENIED':
      return 'Google route planning was denied. Confirm the browser key allows Maps JavaScript API and Directions API (Legacy), and that this site is allowed in the HTTP referrer restrictions.';
    case 'INVALID_REQUEST':
      return 'Google rejected the route request. Re-select the addresses and try again.';
    case 'MAX_ROUTE_LENGTH_EXCEEDED':
      return 'Google could not process a route that long. Try a shorter trip or turn off the round-trip option.';
    case 'MAX_WAYPOINTS_EXCEEDED':
      return 'Google rejected the route because it exceeded the waypoint limit.';
    case 'UNKNOWN_ERROR':
      return 'Google route planning had a temporary issue. Try again in a moment.';
    default:
      return 'Google route planning failed. Check the key restrictions, enabled APIs, and selected locations, then try again.';
  }
}

function getPlacesErrorMessage(status: string | null, operation: 'search' | 'details'): string {
  switch (status) {
    case 'NOT_FOUND':
      return `Google place ${operation} could not find that place anymore. Try building the itinerary again.`;
    case 'OVER_QUERY_LIMIT':
      return `Google place ${operation} is over the current quota limit. Check Maps Platform billing and quota, then try again.`;
    case 'REQUEST_DENIED':
      return `Google place ${operation} was denied. Confirm Places API is enabled for this project and allowed by the browser key restrictions.`;
    case 'INVALID_REQUEST':
      return `Google place ${operation} was rejected as invalid. Refresh the page and try again.`;
    case 'UNKNOWN_ERROR':
      return `Google place ${operation} hit a temporary issue. Try again in a moment.`;
    case 'ZERO_RESULTS':
      return `Google place ${operation} returned no results for that stop.`;
    default:
      return `Google place ${operation} failed. Check the key restrictions and enabled APIs, then try again.`;
  }
}