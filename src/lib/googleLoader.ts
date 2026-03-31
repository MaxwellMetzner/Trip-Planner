declare global {
  interface Window {
    __tripPlannerGoogleMapsReady?: () => void;
  }
}

let loaderPromise: Promise<void> | null = null;

export function loadGoogleMapsApi(apiKey: string): Promise<void> {
  if (!apiKey) {
    return Promise.reject(new Error('Missing VITE_GOOGLE_MAPS_API_KEY.'));
  }

  if (window.google?.maps?.places) {
    return Promise.resolve();
  }

  if (loaderPromise) {
    return loaderPromise;
  }

  loaderPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-trip-planner-google="true"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Google Maps failed to load.')), { once: true });
      return;
    }

    window.__tripPlannerGoogleMapsReady = () => {
      resolve();
      delete window.__tripPlannerGoogleMapsReady;
    };

    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.dataset.tripPlannerGoogle = 'true';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=__tripPlannerGoogleMapsReady`;
    script.onerror = () => {
      reject(new Error('Google Maps failed to load.'));
      loaderPromise = null;
    };

    document.head.append(script);
  });

  return loaderPromise;
}
