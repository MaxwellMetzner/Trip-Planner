import { useEffect, useRef } from 'react';
import type { PlannedTrip } from '../types/trip';
import { formatClock, formatDistanceMeters, formatDurationMinutes } from '../lib/utils';

interface MapPanelProps {
  plan: PlannedTrip | null;
  googleReady: boolean;
}

export function MapPanel({ plan, googleReady }: MapPanelProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!googleReady || !plan || !mapRef.current) {
      return;
    }

    const map = new google.maps.Map(mapRef.current, {
      center: { lat: (plan.route.bounds.north + plan.route.bounds.south) / 2, lng: (plan.route.bounds.east + plan.route.bounds.west) / 2 },
      zoom: 6,
      disableDefaultUI: true,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: 'cooperative',
    });

    const bounds = new google.maps.LatLngBounds(
      { lat: plan.route.bounds.south, lng: plan.route.bounds.west },
      { lat: plan.route.bounds.north, lng: plan.route.bounds.east },
    );
    map.fitBounds(bounds, 48);

    const polyline = new google.maps.Polyline({
      path: plan.route.path.map((point) => ({ lat: point.lat, lng: point.lng })),
      strokeColor: '#0f766e',
      strokeOpacity: 0.95,
      strokeWeight: 5,
      map,
    });

    const markers = plan.recommendations
      .filter((recommendation) => recommendation.status !== 'skipped')
      .map(
        (recommendation, index) =>
          new google.maps.Marker({
            position: { lat: recommendation.candidate.lat, lng: recommendation.candidate.lng },
            map,
            label: {
              text: String(index + 1),
              color: '#f8fafc',
              fontWeight: '700',
            },
            title: recommendation.candidate.name,
          }),
      );

    return () => {
      polyline.setMap(null);
      markers.forEach((marker) => marker.setMap(null));
    };
  }, [googleReady, plan]);

  if (!plan) {
    return (
      <section className="map-panel empty-state">
        <h3>No route yet</h3>
        <p>Build a trip to see the map, timeline, and ranked stop cards line up against the journey.</p>
      </section>
    );
  }

  if (!googleReady) {
    return (
      <section className="map-panel fallback-map-panel">
        <div className="fallback-map-head">
          <h3>Route preview</h3>
          <span className="mode-chip muted">Map unavailable in demo mode</span>
        </div>
        <div className="fallback-route-stats">
          <div>
            <span className="stats-label">Distance</span>
            <strong>{formatDistanceMeters(plan.route.distanceMeters)}</strong>
          </div>
          <div>
            <span className="stats-label">Drive time</span>
            <strong>{formatDurationMinutes(plan.route.durationSeconds / 60)}</strong>
          </div>
          <div>
            <span className="stats-label">Planned arrival</span>
            <strong>{formatClock(plan.summary.plannedArrivalAt)}</strong>
          </div>
        </div>
        <p className="supporting-copy">
          The planner still runs fully client-side here. Add a browser-restricted Google Maps key to unlock real map rendering,
          autocomplete, and browser-based route search.
        </p>
      </section>
    );
  }

  return <section className="map-panel" ref={mapRef} aria-label="Trip map" />;
}
