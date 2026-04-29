import type { PlannedTrip } from '../types/trip';
import { formatDateLabel, formatDurationMinutes } from '../lib/utils';

interface SavedTripsPanelProps {
  trips: PlannedTrip[];
  notice?: string | null;
  onOpen: (trip: PlannedTrip) => void;
  onDelete: (tripId: string) => void;
}

export function SavedTripsPanel({ trips, notice, onOpen, onDelete }: SavedTripsPanelProps) {
  return (
    <section className="panel saved-trips-panel">
      <div className="panel-head compact">
        <div>
          <p className="eyebrow">Saved itineraries</p>
          <h2>Trip archive</h2>
        </div>
        <span className="mode-chip muted">{trips.length} saved</span>
      </div>

      {notice ? <div className="info-banner archive-notice">{notice}</div> : null}

      {trips.length === 0 ? (
        <p className="supporting-copy">Saved trips stay in localStorage on this device. Expired Google-backed trips are removed automatically.</p>
      ) : (
        <div className="saved-trip-list">
          {trips.map((trip) => (
            <article className="saved-trip-card" key={trip.id}>
              <div>
                <h3>
                  {trip.request.origin.label} to {trip.request.destination.label}
                </h3>
                <p>{formatDateLabel(trip.summary.departureAt)}</p>
              </div>
              <div className="saved-trip-meta">
                <span>{trip.recommendations.filter((item) => item.status !== 'skipped').length} stops</span>
                <span>{formatDurationMinutes(trip.summary.totalExtraMinutes)}</span>
              </div>
              <div className="saved-trip-actions">
                <button className="secondary-button" type="button" onClick={() => onOpen(trip)}>
                  Open
                </button>
                <button className="ghost-button danger" type="button" onClick={() => onDelete(trip.id)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
