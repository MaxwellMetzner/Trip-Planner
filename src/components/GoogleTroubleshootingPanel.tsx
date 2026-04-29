interface GoogleTroubleshootingPanelProps {
  issue: string;
  providerPreference: 'auto' | 'google';
}

export function GoogleTroubleshootingPanel({ issue, providerPreference }: GoogleTroubleshootingPanelProps) {
  const suggestedReferrer = getSuggestedReferrer();

  return (
    <section className="panel troubleshooting-panel">
      <div className="panel-head compact">
        <div>
          <p className="eyebrow">Google setup</p>
          <h2>Troubleshooting</h2>
        </div>
        <span className="mode-chip muted">{providerPreference === 'auto' ? 'Auto fallback' : 'Google mode'}</span>
      </div>

      <div className="warning-pill">{issue}</div>

      <p className="supporting-copy">
        Google browser mode depends on a browser key, enabled Google Maps Platform APIs, and matching HTTP referrer restrictions.
      </p>

      <ol className="troubleshooting-list">
        <li>Confirm VITE_GOOGLE_MAPS_API_KEY is present for this build or deployment.</li>
        <li>Enable Maps JavaScript API, Places API, and Directions API (Legacy) in the same Google Cloud project.</li>
        <li>Add {suggestedReferrer} to the key HTTP referrer restrictions.</li>
        <li>For local Vite development, also allow http://localhost:5173/*.</li>
        <li>Switch to Demo if you need to keep planning while the Google setup is being fixed.</li>
      </ol>
    </section>
  );
}

function getSuggestedReferrer(): string {
  if (typeof window === 'undefined') {
    return 'your app URL';
  }

  const pathPrefix = window.location.pathname.startsWith('/Trip-Planner') ? '/Trip-Planner/*' : '/*';
  return `${window.location.origin}${pathPrefix}`;
}