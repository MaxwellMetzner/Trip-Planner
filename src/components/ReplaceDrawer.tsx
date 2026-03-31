import type { PlaceCandidate, RankedSlotRecommendation, StopSlot } from '../types/trip';
import { CATEGORY_LABELS } from '../lib/planner/config';
import { formatDurationMinutes } from '../lib/utils';

interface ReplaceDrawerProps {
  recommendation: RankedSlotRecommendation | null;
  slot: StopSlot | null;
  onClose: () => void;
  onSelectAlternative: (candidate: PlaceCandidate) => void;
}

export function ReplaceDrawer({ recommendation, slot, onClose, onSelectAlternative }: ReplaceDrawerProps) {
  if (!recommendation || !slot) {
    return null;
  }

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="replace-drawer" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Replace stop</p>
            <h3>{CATEGORY_LABELS[recommendation.category]}</h3>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="drawer-current-stop">
          <span className="stats-label">Current pick</span>
          <strong>{recommendation.candidate.name}</strong>
          <p>{recommendation.explanation.summary}</p>
        </div>

        <div className="drawer-alternative-list">
          {recommendation.alternatives.length === 0 ? (
            <p className="supporting-copy">No alternates are cached for this slot yet.</p>
          ) : (
            recommendation.alternatives.map((candidate) => (
              <article className="alternative-card" key={candidate.providerPlaceId}>
                <div>
                  <h4>{candidate.name}</h4>
                  <p>{candidate.formattedAddress}</p>
                </div>
                <div className="alternative-meta">
                  <span>{candidate.avgRating.toFixed(1)} stars</span>
                  <span>{formatDurationMinutes(candidate.detourMinutes)}</span>
                  <span>{formatDurationMinutes(slot.expectedDwellMinutes)} dwell</span>
                </div>
                <button className="secondary-button" type="button" onClick={() => onSelectAlternative(candidate)}>
                  Swap in
                </button>
              </article>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
