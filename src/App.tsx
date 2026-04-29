import { startTransition, useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BatteryCharging,
  Bookmark,
  Clock3,
  Compass,
  Coffee,
  Fuel,
  Gauge,
  ListChecks,
  Mountain,
  Minus,
  Plus,
  RefreshCw,
  Route,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trees,
  Utensils,
  Users,
  Wallet,
} from 'lucide-react';
import { MapPanel } from './components/MapPanel';
import { MeterBar } from './components/MeterBar';
import { GoogleTroubleshootingPanel } from './components/GoogleTroubleshootingPanel';
import { PlaceField } from './components/PlaceField';
import { ReplaceDrawer } from './components/ReplaceDrawer';
import { SavedTripsPanel } from './components/SavedTripsPanel';
import { getGoogleErrorMessage } from './lib/googleErrors';
import { loadGoogleMapsApi } from './lib/googleLoader';
import { pinRecommendation, planTrip, replaceRecommendation, skipRecommendation } from './lib/planner/engine';
import {
  CATEGORY_LABELS,
  MODE_DESCRIPTIONS,
  MODE_LABELS,
  createDefaultTripRequest,
} from './lib/planner/config';
import { GooglePlannerProvider } from './lib/providers/googleProvider';
import { MockPlannerProvider } from './lib/providers/mockProvider';
import { deleteTrip, deriveLearnedPreferences, loadPreferences, loadSavedTripsSnapshot, savePreferences, saveTrip } from './lib/storage';
import {
  formatClock,
  formatDateLabel,
  formatDistanceMeters,
  formatDurationMinutes,
  parseDateTimeLocal,
  toDateTimeLocalInputValue,
} from './lib/utils';
import type {
  Category,
  EnergyCurve,
  PlannedTrip,
  PlaceCandidate,
  PreferenceProfile,
  StopPacing,
  TravelParty,
  TripPlanningRequest,
  TripTemperament,
} from './types/trip';

const OPTIONAL_CATEGORIES: Category[] = [
  'coffee',
  'rest_stop',
  'scenic_overlook',
  'hike',
  'attraction',
  'gas',
  'ev_charging',
  'surprise',
];

const TUNE_CATEGORIES: Category[] = ['coffee', 'rest_stop', 'scenic_overlook', 'attraction', 'surprise'];

const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  breakfast: Utensils,
  lunch: Utensils,
  dinner: Utensils,
  coffee: Coffee,
  rest_stop: Clock3,
  scenic_overlook: Sun,
  hike: Mountain,
  attraction: Compass,
  gas: Fuel,
  ev_charging: BatteryCharging,
  surprise: Sparkles,
};

const PARTY_LABELS: Record<TravelParty, string> = {
  solo: 'Solo',
  couple: 'Couple',
  family: 'Family',
  friends: 'Friends',
};

const ENERGY_LABELS: Record<EnergyCurve, string> = {
  early_peak: 'Early peak',
  steady: 'Steady',
  late_riser: 'Late riser',
};

const PACING_LABELS: Record<StopPacing, string> = {
  quick_hits: 'Quick hits',
  balanced: 'Balanced',
  linger: 'Linger',
};

const TEMPERAMENT_LABELS: Record<TripTemperament, string> = {
  efficient: 'Efficient',
  balanced: 'Balanced',
  local_texture: 'Local texture',
  scenic_collector: 'Scenic collector',
  comfort_buffer: 'Comfort buffer',
};

const PRESETS: Array<{
  label: string;
  summary: string;
  apply: (request: TripPlanningRequest) => TripPlanningRequest;
}> = [
  {
    label: 'Focused errand',
    summary: 'Low detour, quick breaks, one reliable meal.',
    apply: (request) => ({
      ...request,
      itineraryMode: 'fastest_reasonable',
      mealStopCount: 1,
      activeCategories: ['coffee', 'rest_stop'],
      desiredStopsByCategory: { coffee: 1, rest_stop: 1 },
      detourToleranceMinutes: 12,
      categoryImportance: { coffee: 'medium', rest_stop: 'medium', lunch: 'high' },
      preferences: {
        ...request.preferences,
        tripTemperament: 'efficient',
        stopPacing: 'quick_hits',
        energyCurve: 'steady',
        foodPriority: 48,
        sceneryPriority: 24,
        comfortPriority: 58,
        surprisePriority: 12,
        quietPriority: 34,
        idealBreakCadenceMinutes: 150,
      },
    }),
  },
  {
    label: 'Scenic collector',
    summary: 'Viewpoints, trails, and memorable detours are allowed to win.',
    apply: (request) => ({
      ...request,
      itineraryMode: 'experience_focused',
      mealStopCount: 1,
      activeCategories: ['coffee', 'scenic_overlook', 'hike', 'attraction', 'surprise'],
      desiredStopsByCategory: { coffee: 1, scenic_overlook: 2, hike: 1, attraction: 1, surprise: 1 },
      detourToleranceMinutes: 30,
      categoryImportance: {
        coffee: 'medium',
        scenic_overlook: 'high',
        hike: 'high',
        attraction: 'high',
        surprise: 'medium',
        lunch: 'medium',
      },
      preferences: {
        ...request.preferences,
        tripTemperament: 'scenic_collector',
        stopPacing: 'linger',
        energyCurve: 'early_peak',
        foodPriority: 52,
        sceneryPriority: 94,
        comfortPriority: 44,
        surprisePriority: 54,
        quietPriority: 58,
      },
    }),
  },
  {
    label: 'Local texture',
    summary: 'Independent food, quieter stops, and a little planned serendipity.',
    apply: (request) => ({
      ...request,
      itineraryMode: 'food_focused',
      mealStopCount: 2,
      activeCategories: ['coffee', 'attraction', 'surprise', 'scenic_overlook'],
      desiredStopsByCategory: { coffee: 1, attraction: 1, surprise: 1, scenic_overlook: 1 },
      detourToleranceMinutes: 22,
      categoryImportance: {
        coffee: 'high',
        attraction: 'medium',
        surprise: 'high',
        scenic_overlook: 'medium',
        lunch: 'high',
        dinner: 'medium',
      },
      preferences: {
        ...request.preferences,
        tripTemperament: 'local_texture',
        stopPacing: 'balanced',
        foodPriority: 90,
        sceneryPriority: 56,
        comfortPriority: 42,
        surprisePriority: 72,
        quietPriority: 82,
        avoidChains: true,
      },
    }),
  },
  {
    label: 'Family buffer',
    summary: 'Predictable breaks, shorter gaps, kid-friendly weighting.',
    apply: (request) => ({
      ...request,
      itineraryMode: 'best_overall',
      mealStopCount: 2,
      activeCategories: ['coffee', 'rest_stop', 'attraction', 'gas'],
      desiredStopsByCategory: { coffee: 1, rest_stop: 2, attraction: 1, gas: 1 },
      detourToleranceMinutes: 16,
      preferences: {
        ...request.preferences,
        travelParty: 'family',
        tripTemperament: 'comfort_buffer',
        stopPacing: 'quick_hits',
        energyCurve: 'steady',
        childFriendly: true,
        idealBreakCadenceMinutes: 120,
        foodPriority: 56,
        sceneryPriority: 40,
        comfortPriority: 92,
        surprisePriority: 18,
        quietPriority: 50,
      },
      categoryImportance: {
        coffee: 'medium',
        rest_stop: 'high',
        gas: 'medium',
        attraction: 'medium',
        lunch: 'high',
        dinner: 'medium',
      },
    }),
  },
];

type WizardStepId = 'locations' | 'temperament' | 'travel' | 'meals' | 'stops' | 'preferences' | 'review';

const WIZARD_STEPS: Array<{
  id: WizardStepId;
  label: string;
  caption: string;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    id: 'locations',
    label: 'Locations',
    caption: 'Set the route',
    title: 'Where does the trip begin and end?',
    description: 'Start with the route itself, then layer timing and stop preferences on top of it.',
    icon: Route,
  },
  {
    id: 'temperament',
    label: 'Trip DNA',
    caption: 'Set the feel',
    title: 'What kind of trip should this feel like?',
    description: 'Choose the temperament first, then tune the priorities that make one road trip feel different from another.',
    icon: Gauge,
  },
  {
    id: 'travel',
    label: 'Travel time',
    caption: 'Departure and pace',
    title: 'How should the drive unfold?',
    description: 'Choose when you leave, how much detour you can tolerate, and which planning source to use.',
    icon: Clock3,
  },
  {
    id: 'meals',
    label: 'Meals',
    caption: 'Plan food stops',
    title: 'How should meals fit into the route?',
    description: 'Decide how many meal stops you want and what time windows the planner should target.',
    icon: Utensils,
  },
  {
    id: 'stops',
    label: 'Stops',
    caption: 'Pick categories',
    title: 'What else should shape the trip?',
    description: 'Turn optional stop categories on one by one instead of seeing every option at once.',
    icon: Trees,
  },
  {
    id: 'preferences',
    label: 'Preferences',
    caption: 'Taste and comfort',
    title: 'What should the planner bias toward?',
    description: 'Capture budget, cuisine, hiking appetite, and comfort preferences before the final review.',
    icon: Wallet,
  },
  {
    id: 'review',
    label: 'Review',
    caption: 'Build the itinerary',
    title: 'Review the full plan before building',
    description: 'Check the route, timing, meals, and stop mix in one summary, then generate the itinerary.',
    icon: Sparkles,
  },
];

type FingerprintMetric = {
  label: string;
  value: number;
};

type AppBootstrapState = {
  providerPreference: 'auto' | 'google' | 'demo';
  preferences: PreferenceProfile;
  request: TripPlanningRequest;
  savedTrips: PlannedTrip[];
  savedTripsNotice: string | null;
};

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildTripFingerprint(request: TripPlanningRequest, preferences: PreferenceProfile): FingerprintMetric[] {
  const optionalStopCount = request.activeCategories.reduce((sum, category) => sum + (request.desiredStopsByCategory[category] ?? 1), 0);

  return [
    {
      label: 'Pace',
      value: clampPercent(100 - request.detourToleranceMinutes * 1.8 + (preferences.stopPacing === 'quick_hits' ? 12 : preferences.stopPacing === 'linger' ? -10 : 0)),
    },
    {
      label: 'Flavor',
      value: clampPercent(preferences.foodPriority + (preferences.avoidChains ? 8 : 0)),
    },
    {
      label: 'Scenery',
      value: clampPercent(preferences.sceneryPriority + (request.activeCategories.includes('scenic_overlook') ? 8 : 0)),
    },
    {
      label: 'Comfort',
      value: clampPercent(preferences.comfortPriority + (preferences.childFriendly ? 10 : 0)),
    },
    {
      label: 'Wildcard',
      value: clampPercent(preferences.surprisePriority + optionalStopCount * 3),
    },
  ];
}

function priorityLabel(value: number): string {
  if (value >= 76) {
    return 'High';
  }

  if (value >= 46) {
    return 'Medium';
  }

  return 'Low';
}

function formatExpiredTripNotice(count: number): string {
  return `${count} expired Google-backed saved trip${count === 1 ? ' was' : 's were'} removed from the archive.`;
}

function isGoogleIssueMessage(message: string | null): boolean {
  return Boolean(message && message.startsWith('Google'));
}

function buildInitialAppState(): AppBootstrapState {
  const savedTripsSnapshot = loadSavedTripsSnapshot();
  const savedTrips = savedTripsSnapshot.trips;
  const preferences = deriveLearnedPreferences(savedTrips, loadPreferences());
  const request = createDefaultTripRequest();
  request.preferences = preferences;
  request.departureAt = toDateTimeLocalInputValue(request.departureAt);

  return {
    providerPreference: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? 'auto' : 'demo',
    preferences,
    request,
    savedTrips,
    savedTripsNotice: savedTripsSnapshot.expiredTripCount > 0 ? formatExpiredTripNotice(savedTripsSnapshot.expiredTripCount) : null,
  };
}

function App() {
  const [appBootstrap] = useState<AppBootstrapState>(buildInitialAppState);

  const [preferences, setPreferences] = useState<PreferenceProfile>(appBootstrap.preferences);
  const [savedTrips, setSavedTrips] = useState<PlannedTrip[]>(appBootstrap.savedTrips);
  const [savedTripsNotice, setSavedTripsNotice] = useState<string | null>(appBootstrap.savedTripsNotice);
  const [request, setRequest] = useState<TripPlanningRequest>(appBootstrap.request);
  const [currentPlan, setCurrentPlan] = useState<PlannedTrip | null>(null);
  const [showInputBuilder, setShowInputBuilder] = useState(true);
  const [planningState, setPlanningState] = useState<'idle' | 'planning'>('idle');
  const [providerPreference, setProviderPreference] = useState<'auto' | 'google' | 'demo'>(appBootstrap.providerPreference);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [replaceSlotId, setReplaceSlotId] = useState<string | null>(null);
  const [activeStepId, setActiveStepId] = useState<WizardStepId>('locations');
  const itinerarySummaryRef = useRef<HTMLElement | null>(null);
  const pendingPlanScrollRef = useRef(false);

  const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '';
  const wantsGoogle = providerPreference !== 'demo' && Boolean(googleKey);
  const effectiveProviderMode = providerPreference === 'google' ? 'google' : wantsGoogle && googleReady ? 'google' : 'demo';
  const replaceRecommendationTarget = currentPlan?.recommendations.find((item) => item.slotId === replaceSlotId) ?? null;
  const replaceSlotTarget = currentPlan?.slots.find((item) => item.id === replaceSlotId) ?? null;
  const activeStepIndex = Math.max(0, WIZARD_STEPS.findIndex((step) => step.id === activeStepId));
  const activeStep = WIZARD_STEPS[activeStepIndex];
  const nextStep = WIZARD_STEPS[activeStepIndex + 1] ?? null;
  const ActiveStepIcon = activeStep.icon;
  const canAdvanceToNextStep =
    activeStep.id !== 'locations' ||
    (request.origin.label.trim().length > 0 && request.destination.label.trim().length > 0);
  const progressPercent = ((activeStepIndex + 1) / WIZARD_STEPS.length) * 100;
  const departureLabel = request.departureAt ? formatDateLabel(parseDateTimeLocal(request.departureAt)) : 'Choose a departure time';
  const mealWindowSummary = (['breakfast', 'lunch', 'dinner'] as const)
    .map((mealKey) => `${CATEGORY_LABELS[mealKey]} ${request.mealWindows[mealKey].start}-${request.mealWindows[mealKey].end}`)
    .join(' / ');
  const activeCategorySummary =
    request.activeCategories.length > 0
      ? request.activeCategories.map((category) => CATEGORY_LABELS[category]).join(', ')
      : 'No optional stop categories selected yet.';
  const cuisineSummary = preferences.cuisines.length > 0 ? preferences.cuisines.join(', ') : 'No cuisine hints yet';
  const tripFingerprint = buildTripFingerprint(request, preferences);
  const temperamentLabel = TEMPERAMENT_LABELS[preferences.tripTemperament];
  const builderCollapsed = Boolean(currentPlan) && !showInputBuilder;
  const googleTroubleshootingIssue =
    providerPreference === 'demo' ? null : isGoogleIssueMessage(errorMessage) ? errorMessage : googleError;

  useEffect(() => {
    savePreferences(preferences);
    setRequest((previous) => ({ ...previous, preferences }));
  }, [preferences]);

  useEffect(() => {
    if (!currentPlan || !pendingPlanScrollRef.current) {
      return undefined;
    }

    pendingPlanScrollRef.current = false;
    const frameId = window.requestAnimationFrame(() => {
      itinerarySummaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [currentPlan]);

  useEffect(() => {
    let cancelled = false;

    if (!wantsGoogle) {
      setGoogleReady(false);
      setGoogleError(null);
      return undefined;
    }

    loadGoogleMapsApi(googleKey)
      .then(() => {
        if (!cancelled) {
          setGoogleReady(true);
          setGoogleError(null);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setGoogleReady(false);
          setGoogleError(getGoogleErrorMessage(error) ?? error.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [googleKey, wantsGoogle]);

  function updateRequest(patch: Partial<TripPlanningRequest>) {
    setRequest((previous) => ({ ...previous, ...patch }));
  }

  function updatePreferences(patch: Partial<PreferenceProfile>) {
    setPreferences((previous) => ({ ...previous, ...patch }));
  }

  function updatePlace(field: 'origin' | 'destination', place: { label: string; googlePlaceId?: string; lat?: number; lng?: number }) {
    setRequest((previous) => ({
      ...previous,
      [field]: place,
    }));
  }

  function toggleCategory(category: Category) {
    setRequest((previous) => {
      const active = previous.activeCategories.includes(category);
      return {
        ...previous,
        activeCategories: active
          ? previous.activeCategories.filter((value) => value !== category)
          : [...previous.activeCategories, category],
        desiredStopsByCategory: {
          ...previous.desiredStopsByCategory,
          [category]: active ? 0 : Math.max(1, previous.desiredStopsByCategory[category] ?? 1),
        },
      };
    });
  }

  function updateCategoryCount(category: Category, delta: number) {
    setRequest((previous) => {
      const current = previous.desiredStopsByCategory[category] ?? 1;
      return {
        ...previous,
        desiredStopsByCategory: {
          ...previous.desiredStopsByCategory,
          [category]: Math.max(1, Math.min(3, current + delta)),
        },
      };
    });
  }

  function boostCategory(category: Category) {
    setRequest((previous) => {
      const active = previous.activeCategories.includes(category);
      const current = active ? previous.desiredStopsByCategory[category] ?? 1 : 0;

      return {
        ...previous,
        activeCategories: active ? previous.activeCategories : [...previous.activeCategories, category],
        desiredStopsByCategory: {
          ...previous.desiredStopsByCategory,
          [category]: Math.max(1, Math.min(3, current + 1)),
        },
        categoryImportance: {
          ...previous.categoryImportance,
          [category]: 'high',
        },
      };
    });
  }

  function reduceCategory(category: Category) {
    setRequest((previous) => {
      const current = previous.desiredStopsByCategory[category] ?? 1;
      const nextCount = current - 1;

      return {
        ...previous,
        activeCategories: nextCount <= 0 ? previous.activeCategories.filter((value) => value !== category) : previous.activeCategories,
        desiredStopsByCategory: {
          ...previous.desiredStopsByCategory,
          [category]: Math.max(0, nextCount),
        },
      };
    });
  }

  async function handlePlanTrip() {
    const shouldScrollToPlan = showInputBuilder;
    pendingPlanScrollRef.current = false;
    setPlanningState('planning');
    setErrorMessage(null);
    setStatusMessage('');

    try {
      if (providerPreference === 'google' && !googleReady) {
        throw new Error(googleError ?? 'Google browser mode is not ready yet.');
      }

      const provider = effectiveProviderMode === 'google' ? new GooglePlannerProvider() : new MockPlannerProvider();
      const normalizedRequest: TripPlanningRequest = {
        ...request,
        departureAt: parseDateTimeLocal(request.departureAt),
        preferences,
      };
      const plan = await planTrip(normalizedRequest, provider);

      pendingPlanScrollRef.current = shouldScrollToPlan;
      setStatusMessage('Itinerary ready. Review and fine-tune stops below.');
      setShowInputBuilder(false);
      startTransition(() => {
        setCurrentPlan(plan);
      });
    } catch (error) {
      const fallbackMessage = error instanceof Error ? error.message : 'Trip planning failed.';
      setErrorMessage(getGoogleErrorMessage(error) ?? fallbackMessage);
    } finally {
      setPlanningState('idle');
    }
  }

  function handleSaveTrip() {
    if (!currentPlan) {
      return;
    }

    const tripToSave: PlannedTrip = {
      ...currentPlan,
      feedbackEvents: [
        ...currentPlan.feedbackEvents,
        {
          type: 'saved_trip',
          createdAt: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    };

    const { trips: nextTrips, expiredTripCount } = saveTrip(tripToSave);
    setSavedTrips(nextTrips);
    setPreferences((previous) => deriveLearnedPreferences(nextTrips, previous));
    if (expiredTripCount > 0) {
      setSavedTripsNotice(formatExpiredTripNotice(expiredTripCount));
    }
    setStatusMessage('Trip saved locally for this browser.');
  }

  function handleOpenSavedTrip(trip: PlannedTrip) {
    const nextPreferences = trip.request.preferences;

    setCurrentPlan(trip);
    setPreferences(nextPreferences);
    setRequest({
      ...trip.request,
      departureAt: toDateTimeLocalInputValue(trip.request.departureAt),
      preferences: nextPreferences,
    });
    setShowInputBuilder(false);
    setActiveStepId('review');
    setStatusMessage('Loaded a saved itinerary.');
  }

  function handleDeleteTrip(tripId: string) {
    const nextTrips = deleteTrip(tripId);
    setSavedTrips(nextTrips);
    setPreferences((previous) => deriveLearnedPreferences(nextTrips, previous));
    if (currentPlan?.id === tripId) {
      setCurrentPlan(null);
    }
  }

  function handleSwapAlternative(candidate: PlaceCandidate) {
    if (!currentPlan || !replaceSlotId) {
      return;
    }

    setCurrentPlan(replaceRecommendation(currentPlan, replaceSlotId, candidate));
    setReplaceSlotId(null);
    setStatusMessage(`${candidate.name} swapped into the itinerary.`);
  }

  function applyPreset(label: string) {
    const preset = PRESETS.find((item) => item.label === label);
    if (!preset) {
      return;
    }

    const nextRequest = preset.apply({ ...request, preferences });
    setRequest(nextRequest);
    setPreferences(nextRequest.preferences);
  }

  function goToStep(stepId: WizardStepId) {
    setShowInputBuilder(true);
    setActiveStepId(stepId);
  }

  function goToNextStep() {
    if (!nextStep || !canAdvanceToNextStep) {
      return;
    }

    setActiveStepId(nextStep.id);
  }

  function goToPreviousStep() {
    if (activeStepIndex === 0) {
      return;
    }

    setActiveStepId(WIZARD_STEPS[activeStepIndex - 1].id);
  }

  function renderProviderStatus() {
    if (providerPreference === 'demo') {
      return 'Demo provider';
    }

    if (googleReady) {
      return 'Google browser mode';
    }

    if (googleError) {
      return providerPreference === 'auto' ? 'Falling back to demo mode' : 'Google browser mode unavailable';
    }

    return providerPreference === 'auto' ? 'Google loading, demo available' : 'Waiting for Google browser mode';
  }

  function renderBuilderStep() {
    switch (activeStep.id) {
      case 'locations':
        return (
          <div className="wizard-stack">
            <div className="form-grid two-column">
              <PlaceField
                id="origin"
                label="Origin"
                value={request.origin.label}
                placeholder="Starting point"
                googleReady={googleReady}
                onChange={(value) => updatePlace('origin', { label: value })}
                onPlaceSelect={(place) => updatePlace('origin', place)}
              />
              <PlaceField
                id="destination"
                label="Destination"
                value={request.destination.label}
                placeholder="Destination"
                googleReady={googleReady}
                onChange={(value) => updatePlace('destination', { label: value })}
                onPlaceSelect={(place) => updatePlace('destination', place)}
              />
              <label className="field-shell checkbox-shell field-span-two" htmlFor="returnTripEnabled">
                <span className="field-label">Trip shape</span>
                <div className="checkbox-row">
                  <input
                    id="returnTripEnabled"
                    type="checkbox"
                    checked={request.returnTripEnabled}
                    onChange={(event) => updateRequest({ returnTripEnabled: event.target.checked })}
                  />
                  <span>Plan as a same-day out-and-back route</span>
                </div>
              </label>
            </div>
          </div>
        );

      case 'temperament':
        return (
          <div className="wizard-stack">
            <div className="preset-row temperament-presets">
              {PRESETS.map((preset) => (
                <button key={preset.label} className="preset-card" type="button" onClick={() => applyPreset(preset.label)}>
                  <strong>{preset.label}</strong>
                  <span>{preset.summary}</span>
                </button>
              ))}
            </div>

            <div className="settings-grid">
              <article className="settings-card">
                <div className="settings-head">
                  <Users size={18} />
                  <div>
                    <h3>Traveler shape</h3>
                    <p>Party, energy, and stop rhythm.</p>
                  </div>
                </div>

                <label className="field-shell compact-field">
                  <span className="field-label">Temperament</span>
                  <select
                    className="select-input"
                    value={preferences.tripTemperament}
                    onChange={(event) => updatePreferences({ tripTemperament: event.target.value as TripTemperament })}
                  >
                    {(Object.keys(TEMPERAMENT_LABELS) as TripTemperament[]).map((value) => (
                      <option value={value} key={value}>
                        {TEMPERAMENT_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="segmented-grid">
                  {(Object.keys(PARTY_LABELS) as TravelParty[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`segmented-button ${preferences.travelParty === value ? 'active' : ''}`}
                      onClick={() =>
                        updatePreferences({
                          travelParty: value,
                          childFriendly: value === 'family' ? true : preferences.childFriendly,
                        })
                      }
                    >
                      {PARTY_LABELS[value]}
                    </button>
                  ))}
                </div>

                <div className="dual-field-row">
                  <label className="field-shell compact-field">
                    <span className="field-label">Energy curve</span>
                    <select
                      className="select-input"
                      value={preferences.energyCurve}
                      onChange={(event) => updatePreferences({ energyCurve: event.target.value as EnergyCurve })}
                    >
                      {(Object.keys(ENERGY_LABELS) as EnergyCurve[]).map((value) => (
                        <option value={value} key={value}>
                          {ENERGY_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field-shell compact-field">
                    <span className="field-label">Stop rhythm</span>
                    <select
                      className="select-input"
                      value={preferences.stopPacing}
                      onChange={(event) => updatePreferences({ stopPacing: event.target.value as StopPacing })}
                    >
                      {(Object.keys(PACING_LABELS) as StopPacing[]).map((value) => (
                        <option value={value} key={value}>
                          {PACING_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </article>

              <article className="settings-card">
                <div className="settings-head">
                  <SlidersHorizontal size={18} />
                  <div>
                    <h3>Priority mix</h3>
                    <p>Food, scenery, comfort, surprise, and quiet places.</p>
                  </div>
                </div>

                <div className="priority-slider-list">
                  {[
                    ['foodPriority', 'Local food'],
                    ['sceneryPriority', 'Scenery'],
                    ['comfortPriority', 'Comfort'],
                    ['surprisePriority', 'Surprise'],
                    ['quietPriority', 'Quiet gems'],
                  ].map(([key, label]) => {
                    const value = preferences[key as keyof PreferenceProfile] as number;

                    return (
                      <label className="field-shell compact-field" htmlFor={key} key={key}>
                        <span className="priority-label-row">
                          <span className="field-label">{label}</span>
                          <span className="inline-value">{priorityLabel(value)}</span>
                        </span>
                        <input
                          id={key}
                          className="range-input"
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={value}
                          onChange={(event) => updatePreferences({ [key]: Number(event.target.value) } as Partial<PreferenceProfile>)}
                        />
                      </label>
                    );
                  })}
                </div>
              </article>
            </div>

            <div className="fingerprint-panel">
              {tripFingerprint.map((metric) => (
                <article className="fingerprint-card" key={metric.label}>
                  <span className="stats-label">{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <MeterBar className="mini-meter" value={metric.value} decorative />
                </article>
              ))}
            </div>
          </div>
        );

      case 'travel':
        return (
          <div className="wizard-stack">
            <div className="form-grid two-column">
              <label className="field-shell" htmlFor="departureAt">
                <span className="field-label">Departure time</span>
                <input
                  id="departureAt"
                  className="text-input"
                  type="datetime-local"
                  value={request.departureAt}
                  onChange={(event) => updateRequest({ departureAt: event.target.value })}
                />
              </label>

              <div className="provider-status-card">
                <span className="field-label">Current planner source</span>
                <strong>{renderProviderStatus()}</strong>
                <p>Auto falls back to demo mode if Google is unavailable in the browser.</p>
              </div>
            </div>

            <div className="mode-row">
              {(Object.keys(MODE_LABELS) as Array<keyof typeof MODE_LABELS>).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`mode-card ${request.itineraryMode === mode ? 'active' : ''}`}
                  onClick={() => updateRequest({ itineraryMode: mode })}
                >
                  <strong>{MODE_LABELS[mode]}</strong>
                  <span>{MODE_DESCRIPTIONS[mode]}</span>
                </button>
              ))}
            </div>

            <div className="settings-grid">
              <article className="settings-card">
                <div className="settings-head">
                  <Clock3 size={18} />
                  <div>
                    <h3>Detour and cadence</h3>
                    <p>Shape how aggressive the planner is about equal spacing versus speed.</p>
                  </div>
                </div>
                <label className="field-shell compact-field" htmlFor="detourToleranceMinutes">
                  <span className="field-label">Detour tolerance</span>
                  <span className="inline-value">{request.detourToleranceMinutes} minutes</span>
                  <input
                    id="detourToleranceMinutes"
                    className="range-input"
                    type="range"
                    min={5}
                    max={40}
                    step={1}
                    value={request.detourToleranceMinutes}
                    onChange={(event) => updateRequest({ detourToleranceMinutes: Number(event.target.value) })}
                  />
                </label>
                <label className="field-shell compact-field" htmlFor="idealBreakCadenceMinutes">
                  <span className="field-label">Ideal break cadence</span>
                  <span className="inline-value">Every {preferences.idealBreakCadenceMinutes} minutes</span>
                  <input
                    id="idealBreakCadenceMinutes"
                    className="range-input"
                    type="range"
                    min={90}
                    max={240}
                    step={15}
                    value={preferences.idealBreakCadenceMinutes}
                    onChange={(event) => updatePreferences({ idealBreakCadenceMinutes: Number(event.target.value) })}
                  />
                </label>
              </article>

              <article className="settings-card">
                <div className="settings-head">
                  <Compass size={18} />
                  <div>
                    <h3>Planner source</h3>
                    <p>Choose whether to use Google in the browser or the built-in demo provider.</p>
                  </div>
                </div>
                <div className="provider-switcher">
                  {(['auto', 'google', 'demo'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`segmented-button ${providerPreference === value ? 'active' : ''}`}
                      onClick={() => setProviderPreference(value)}
                      disabled={value === 'google' && !googleKey}
                    >
                      {value === 'auto' ? 'Auto' : value === 'google' ? 'Google' : 'Demo'}
                    </button>
                  ))}
                </div>
                <p className="supporting-copy provider-copy">{renderProviderStatus()}</p>
              </article>
            </div>
          </div>
        );

      case 'meals':
        return (
          <div className="wizard-stack">
            <article className="settings-card step-card">
              <div className="settings-head">
                <Utensils size={18} />
                <div>
                  <h3>Meal planning</h3>
                  <p>Infer breakfast, lunch, and dinner against the route timeline.</p>
                </div>
              </div>
              <label className="field-shell compact-field" htmlFor="mealStopCount">
                <span className="field-label">Meal stops</span>
                <select
                  id="mealStopCount"
                  className="select-input"
                  value={request.mealStopCount}
                  onChange={(event) => updateRequest({ mealStopCount: Number(event.target.value) as 0 | 1 | 2 | 3 })}
                >
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
              <div className="meal-window-grid">
                {(['breakfast', 'lunch', 'dinner'] as const).map((mealKey) => (
                  <div className="meal-window-field" key={mealKey}>
                    <span className="field-label">{CATEGORY_LABELS[mealKey]}</span>
                    <div className="meal-window-row">
                      <input
                        className="text-input"
                        type="time"
                        aria-label={`${CATEGORY_LABELS[mealKey]} window start`}
                        title={`${CATEGORY_LABELS[mealKey]} window start`}
                        value={request.mealWindows[mealKey].start}
                        onChange={(event) =>
                          updateRequest({
                            mealWindows: {
                              ...request.mealWindows,
                              [mealKey]: { ...request.mealWindows[mealKey], start: event.target.value },
                            },
                          })
                        }
                      />
                      <input
                        className="text-input"
                        type="time"
                        aria-label={`${CATEGORY_LABELS[mealKey]} window end`}
                        title={`${CATEGORY_LABELS[mealKey]} window end`}
                        value={request.mealWindows[mealKey].end}
                        onChange={(event) =>
                          updateRequest({
                            mealWindows: {
                              ...request.mealWindows,
                              [mealKey]: { ...request.mealWindows[mealKey], end: event.target.value },
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </div>
        );

      case 'stops':
        return (
          <section className="category-section">
            <div className="category-grid">
              {OPTIONAL_CATEGORIES.map((category) => {
                const Icon = CATEGORY_ICONS[category];
                const active = request.activeCategories.includes(category);
                const count = request.desiredStopsByCategory[category] ?? 1;
                const importance = request.categoryImportance[category] ?? 'medium';

                return (
                  <article className={`category-card ${active ? 'active' : ''}`} key={category}>
                    <div className="category-card-head">
                      <div className="category-badge">
                        <Icon size={18} />
                      </div>
                      <div>
                        <h4>{CATEGORY_LABELS[category]}</h4>
                        <p>{active ? 'Included in planning' : 'Excluded from this draft'}</p>
                      </div>
                    </div>
                    <div className="category-card-actions">
                      <button className={`secondary-button ${active ? 'active' : ''}`} type="button" onClick={() => toggleCategory(category)}>
                        {active ? 'Enabled' : 'Enable'}
                      </button>
                      <div className="stepper">
                        <button type="button" onClick={() => updateCategoryCount(category, -1)} disabled={!active || count <= 1}>
                          -
                        </button>
                        <span>{count}</span>
                        <button type="button" onClick={() => updateCategoryCount(category, 1)} disabled={!active || count >= 3}>
                          +
                        </button>
                      </div>
                    </div>
                    <label className="field-shell compact-field">
                      <span className="field-label">Importance</span>
                      <select
                        className="select-input"
                        value={importance}
                        onChange={(event) =>
                          updateRequest({
                            categoryImportance: {
                              ...request.categoryImportance,
                              [category]: event.target.value as 'low' | 'medium' | 'high',
                            },
                          })
                        }
                        disabled={!active}
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </label>
                  </article>
                );
              })}
            </div>
          </section>
        );

      case 'preferences':
        return (
          <div className="wizard-stack">
            <div className="form-grid two-column">
              <label className="field-shell compact-field">
                <span className="field-label">Budget</span>
                <select
                  className="select-input"
                  value={preferences.budgetLevel ?? 'medium'}
                  onChange={(event) => updatePreferences({ budgetLevel: event.target.value as 'low' | 'medium' | 'high' })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="field-shell compact-field">
                <span className="field-label">Hiking appetite</span>
                <select
                  className="select-input"
                  value={preferences.hikingInterest ?? 'moderate'}
                  onChange={(event) =>
                    updatePreferences({ hikingInterest: event.target.value as PreferenceProfile['hikingInterest'] })
                  }
                >
                  <option value="none">None</option>
                  <option value="light">Light</option>
                  <option value="moderate">Moderate</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="field-shell compact-field">
                <span className="field-label">Cuisine hints</span>
                <input
                  className="text-input"
                  value={preferences.cuisines.join(', ')}
                  onChange={(event) =>
                    updatePreferences({
                      cuisines: event.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="Thai, bakery, tacos"
                />
              </label>
              <label className="field-shell compact-field">
                <span className="field-label">Attraction tags</span>
                <input
                  className="text-input"
                  value={preferences.attractionTags.join(', ')}
                  onChange={(event) =>
                    updatePreferences({
                      attractionTags: event.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="landmarks, parks, museums"
                />
              </label>
            </div>

            <div className="toggle-list">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={preferences.avoidChains}
                  onChange={(event) => updatePreferences({ avoidChains: event.target.checked })}
                />
                <span>Avoid chains</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={preferences.childFriendly}
                  onChange={(event) => updatePreferences({ childFriendly: event.target.checked })}
                />
                <span>Child-friendly bias</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={preferences.allowNightOutdoor}
                  onChange={(event) => updatePreferences({ allowNightOutdoor: event.target.checked })}
                />
                <span>Allow dusk or night outdoor activity</span>
              </label>
            </div>

            <div className="learned-grid">
              <article>
                <span className="stats-label">Learned scenic preference</span>
                <strong>{Math.round(preferences.learned.preferScenicStops * 100)}%</strong>
              </article>
              <article>
                <span className="stats-label">Learned local-food bias</span>
                <strong>{Math.round(preferences.learned.preferLocalFood * 100)}%</strong>
              </article>
              <article>
                <span className="stats-label">Preferred coffee cadence</span>
                <strong>{preferences.learned.preferredCoffeeCadenceMinutes} min</strong>
              </article>
              <article>
                <span className="stats-label">Preferred max hike</span>
                <strong>{preferences.learned.preferredMaxHikeMinutes} min</strong>
              </article>
            </div>
          </div>
        );

      case 'review':
        return (
          <div className="wizard-stack">
            <div className="review-grid">
              <article className="review-card">
                <span className="stats-label">Route</span>
                <strong>
                  {request.origin.label || 'Origin'} to {request.destination.label || 'Destination'}
                </strong>
                <p>{request.returnTripEnabled ? 'Same-day out-and-back route.' : 'One-way route.'}</p>
              </article>
              <article className="review-card">
                <span className="stats-label">Travel time</span>
                <strong>{departureLabel}</strong>
                <p>
                  {MODE_LABELS[request.itineraryMode]} mode with up to {request.detourToleranceMinutes} minutes of detour and
                  breaks about every {preferences.idealBreakCadenceMinutes} minutes.
                </p>
              </article>
              <article className="review-card">
                <span className="stats-label">Trip DNA</span>
                <strong>{temperamentLabel}</strong>
                <p>
                  {PARTY_LABELS[preferences.travelParty]} trip, {ENERGY_LABELS[preferences.energyCurve].toLowerCase()} energy,
                  {` ${PACING_LABELS[preferences.stopPacing].toLowerCase()} stops.`}
                </p>
              </article>
              <article className="review-card">
                <span className="stats-label">Meals</span>
                <strong>
                  {request.mealStopCount} meal stop{request.mealStopCount === 1 ? '' : 's'}
                </strong>
                <p>{mealWindowSummary}</p>
              </article>
              <article className="review-card">
                <span className="stats-label">Stop mix</span>
                <strong>
                  {request.activeCategories.length} optional categor{request.activeCategories.length === 1 ? 'y' : 'ies'}
                </strong>
                <p>{activeCategorySummary}</p>
              </article>
              <article className="review-card">
                <span className="stats-label">Preferences</span>
                <strong>Budget: {preferences.budgetLevel ?? 'medium'}</strong>
                <p>
                  {cuisineSummary}. {preferences.childFriendly ? 'Child-friendly bias is on.' : 'Child-friendly bias is off.'}
                </p>
              </article>
            </div>

            <p className="supporting-copy review-note">
              Planner source: {renderProviderStatus()}. Build the itinerary when you are ready, then fine-tune individual stops
              below.
            </p>
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div className="app-shell">
      <header className="hero hero-single panel">
        <div className="hero-copy hero-copy-wide">
          <p className="eyebrow">Route-aware temperament planning</p>
          <h1>Trip Temperament Planner</h1>
          <p className="hero-lede">
            Build a trip from the human texture first: pace, appetite, energy, comfort, scenery, and room for surprise. Then
            tune the proposed itinerary without starting over.
          </p>

          <div className="hero-step-strip">
            {WIZARD_STEPS.map((step, index) => {
              const StepIcon = step.icon;
              const isActive = step.id === activeStep.id;
              const isComplete = index < activeStepIndex;

              return (
                <button
                  key={step.id}
                  className={`hero-step-button ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}`}
                  type="button"
                  onClick={() => goToStep(step.id)}
                >
                  <span className="hero-step-index">{index + 1}</span>
                  <StepIcon size={18} />
                  <span className="hero-step-meta">
                    <strong>{step.label}</strong>
                    <span>{step.caption}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="content-grid">
        <section className="panel builder-panel">
          {builderCollapsed ? (
            <>
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Itinerary active</p>
                  <h2>Trip inputs are hidden</h2>
                  <p className="supporting-copy wizard-description">
                    The itinerary view already reflects your route, timing, and preferences. Reopen the builder only when you want to change the inputs.
                  </p>
                </div>
                <div className="builder-step-status">
                  <span className="mode-chip muted">Builder collapsed</span>
                </div>
              </div>

              <div className="builder-collapsed">
                <div className="info-banner">
                  Click any step above to reopen the wizard, or jump straight back into a specific part of the trip setup.
                </div>
                <div className="builder-collapsed-actions">
                  <button className="secondary-button" type="button" onClick={() => goToStep('temperament')}>
                    Edit questions
                  </button>
                  <button className="ghost-button" type="button" onClick={() => goToStep('locations')}>
                    Jump to locations
                  </button>
                  <button className="ghost-button" type="button" onClick={() => goToStep('travel')}>
                    Jump to travel
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Step {activeStepIndex + 1}</p>
                  <h2>{activeStep.title}</h2>
                  <p className="supporting-copy wizard-description">{activeStep.description}</p>
                </div>
                <div className="builder-step-status">
                  <ActiveStepIcon size={18} />
                  <span className="mode-chip muted">
                    {activeStepIndex + 1} of {WIZARD_STEPS.length}
                  </span>
                </div>
              </div>

              {renderBuilderStep()}

              {activeStepId === 'review' && errorMessage ? <div className="error-banner wizard-banner">{errorMessage}</div> : null}
              {activeStepId === 'review' && googleError && providerPreference !== 'demo' ? (
                <div className="warning-pill wizard-banner">{googleError}</div>
              ) : null}

              <div className="wizard-footer">
                <button className="ghost-button" type="button" onClick={goToPreviousStep} disabled={activeStepIndex === 0}>
                  Back
                </button>
                {nextStep ? (
                  <button className="primary-button" type="button" onClick={goToNextStep} disabled={!canAdvanceToNextStep}>
                    Continue to {nextStep.label}
                  </button>
                ) : (
                  <button className="primary-button" type="button" onClick={handlePlanTrip} disabled={planningState === 'planning'}>
                    {planningState === 'planning' ? 'Planning route...' : 'Build itinerary'}
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="sidebar-stack">
          <section className="panel guide-panel">
            <div className="panel-head compact">
              <div>
                <p className="eyebrow">Progress</p>
                <h2>Quick view</h2>
              </div>
              <span className="mode-chip muted">{Math.round(progressPercent)}%</span>
            </div>

            <MeterBar className="guide-progress-track" value={progressPercent} decorative />

            <div className="guide-summary-grid">
              <article>
                <span className="stats-label">Route</span>
                <strong>
                  {request.origin.label && request.destination.label
                    ? `${request.origin.label} to ${request.destination.label}`
                    : 'Choose locations'}
                </strong>
              </article>
              <article>
                <span className="stats-label">Departure</span>
                <strong>{departureLabel}</strong>
              </article>
              <article>
                <span className="stats-label">Trip DNA</span>
                <strong>{temperamentLabel}</strong>
              </article>
              <article>
                <span className="stats-label">Meals</span>
                <strong>
                  {request.mealStopCount} planned stop{request.mealStopCount === 1 ? '' : 's'}
                </strong>
              </article>
              <article>
                <span className="stats-label">Stops</span>
                <strong>{request.activeCategories.length} enabled</strong>
              </article>
            </div>

            <div className="guide-focus-card">
              <span className="stats-label">Current focus</span>
              <strong>{activeStep.label}</strong>
              <p>{activeStep.description}</p>
            </div>

            <div className="guide-focus-card">
              <span className="stats-label">Fingerprint</span>
              <div className="sidebar-meter-list">
                {tripFingerprint.map((metric) => (
                  <div className="sidebar-meter-row" key={metric.label}>
                    <span>{metric.label}</span>
                    <MeterBar className="mini-meter" value={metric.value} decorative />
                    <strong>{metric.value}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="guide-focus-card">
              <span className="stats-label">Planner source</span>
              <strong>{renderProviderStatus()}</strong>
              <p>Change this in the travel step if you want to switch between Google and the demo provider.</p>
            </div>
          </section>

          {googleTroubleshootingIssue && providerPreference !== 'demo' ? (
            <GoogleTroubleshootingPanel
              issue={googleTroubleshootingIssue}
              providerPreference={providerPreference === 'auto' ? 'auto' : 'google'}
            />
          ) : null}

          <SavedTripsPanel trips={savedTrips} notice={savedTripsNotice} onOpen={handleOpenSavedTrip} onDelete={handleDeleteTrip} />
        </aside>
      </main>

      {currentPlan ? (
        <section className="workspace-grid">
          <section className="panel tune-panel">
            <div className="panel-head compact">
              <div>
                <p className="eyebrow">Fine tune</p>
                <h2>Trip controls</h2>
              </div>
              <div className="summary-head-actions">
                <button className="ghost-button" type="button" onClick={() => goToStep('temperament')}>
                  <ListChecks size={16} />
                  Edit questions
                </button>
                <button className="primary-button" type="button" onClick={handlePlanTrip} disabled={planningState === 'planning'}>
                  <RefreshCw size={16} />
                  {planningState === 'planning' ? 'Rebuilding...' : 'Rebuild itinerary'}
                </button>
              </div>
            </div>

            <div className="tune-grid">
              <article className="tune-card">
                <label className="field-shell compact-field" htmlFor="tuneDetour">
                  <span className="priority-label-row">
                    <span className="field-label">Detour ceiling</span>
                    <span className="inline-value">{request.detourToleranceMinutes} min</span>
                  </span>
                  <input
                    id="tuneDetour"
                    className="range-input"
                    type="range"
                    min={5}
                    max={45}
                    step={1}
                    value={request.detourToleranceMinutes}
                    onChange={(event) => updateRequest({ detourToleranceMinutes: Number(event.target.value) })}
                  />
                </label>
                <label className="field-shell compact-field" htmlFor="tuneCadence">
                  <span className="priority-label-row">
                    <span className="field-label">Break cadence</span>
                    <span className="inline-value">{preferences.idealBreakCadenceMinutes} min</span>
                  </span>
                  <input
                    id="tuneCadence"
                    className="range-input"
                    type="range"
                    min={75}
                    max={240}
                    step={15}
                    value={preferences.idealBreakCadenceMinutes}
                    onChange={(event) => updatePreferences({ idealBreakCadenceMinutes: Number(event.target.value) })}
                  />
                </label>
              </article>

              <article className="tune-card">
                <label className="field-shell compact-field" htmlFor="tuneFood">
                  <span className="priority-label-row">
                    <span className="field-label">Local food</span>
                    <span className="inline-value">{preferences.foodPriority}</span>
                  </span>
                  <input
                    id="tuneFood"
                    className="range-input"
                    type="range"
                    min={0}
                    max={100}
                    value={preferences.foodPriority}
                    onChange={(event) => updatePreferences({ foodPriority: Number(event.target.value) })}
                  />
                </label>
                <label className="field-shell compact-field" htmlFor="tuneScenery">
                  <span className="priority-label-row">
                    <span className="field-label">Scenery</span>
                    <span className="inline-value">{preferences.sceneryPriority}</span>
                  </span>
                  <input
                    id="tuneScenery"
                    className="range-input"
                    type="range"
                    min={0}
                    max={100}
                    value={preferences.sceneryPriority}
                    onChange={(event) => updatePreferences({ sceneryPriority: Number(event.target.value) })}
                  />
                </label>
              </article>

              <article className="tune-card">
                <label className="field-shell compact-field" htmlFor="tuneComfort">
                  <span className="priority-label-row">
                    <span className="field-label">Comfort</span>
                    <span className="inline-value">{preferences.comfortPriority}</span>
                  </span>
                  <input
                    id="tuneComfort"
                    className="range-input"
                    type="range"
                    min={0}
                    max={100}
                    value={preferences.comfortPriority}
                    onChange={(event) => updatePreferences({ comfortPriority: Number(event.target.value) })}
                  />
                </label>
                <label className="field-shell compact-field" htmlFor="tuneSurprise">
                  <span className="priority-label-row">
                    <span className="field-label">Surprise</span>
                    <span className="inline-value">{preferences.surprisePriority}</span>
                  </span>
                  <input
                    id="tuneSurprise"
                    className="range-input"
                    type="range"
                    min={0}
                    max={100}
                    value={preferences.surprisePriority}
                    onChange={(event) => updatePreferences({ surprisePriority: Number(event.target.value) })}
                  />
                </label>
              </article>

              <article className="tune-card tune-category-card">
                <span className="field-label">Stop mix</span>
                <div className="tune-category-list">
                  {TUNE_CATEGORIES.map((category) => {
                    const Icon = CATEGORY_ICONS[category];
                    const count = request.activeCategories.includes(category) ? request.desiredStopsByCategory[category] ?? 1 : 0;

                    return (
                      <div className="tune-category-row" key={category}>
                        <span className="tune-category-name">
                          <Icon size={15} />
                          {CATEGORY_LABELS[category]}
                        </span>
                        <div className="stepper">
                          <button type="button" onClick={() => reduceCategory(category)} disabled={count <= 0} aria-label={`Reduce ${CATEGORY_LABELS[category]}`}>
                            <Minus size={14} />
                          </button>
                          <span>{count}</span>
                          <button type="button" onClick={() => boostCategory(category)} disabled={count >= 3} aria-label={`Add ${CATEGORY_LABELS[category]}`}>
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            </div>
          </section>

          <div className="workspace-top-row">
            <section className="panel workspace-summary-panel" ref={itinerarySummaryRef}>
              <div className="panel-head compact">
                <div>
                  <p className="eyebrow">Current itinerary</p>
                  <h2>{`${currentPlan.request.origin.label} to ${currentPlan.request.destination.label}`}</h2>
                </div>
                <div className="summary-head-actions">
                  <span className="mode-chip">{currentPlan.providerMode === 'google' ? 'Google-backed' : 'Client demo'}</span>
                  <button className="secondary-button" type="button" onClick={handleSaveTrip}>
                    <Bookmark size={16} />
                    Save trip
                  </button>
                </div>
              </div>

              <div className="summary-metrics-grid">
                <article>
                  <span className="stats-label">Base drive</span>
                  <strong>{formatDurationMinutes(currentPlan.route.durationSeconds / 60)}</strong>
                </article>
                <article>
                  <span className="stats-label">Extra time</span>
                  <strong>{formatDurationMinutes(currentPlan.summary.totalExtraMinutes)}</strong>
                </article>
                <article>
                  <span className="stats-label">Distance</span>
                  <strong>{formatDistanceMeters(currentPlan.route.distanceMeters)}</strong>
                </article>
                <article>
                  <span className="stats-label">Planned arrival</span>
                  <strong>{formatClock(currentPlan.summary.plannedArrivalAt)}</strong>
                </article>
              </div>
              <div className="summary-fingerprint">
                {tripFingerprint.map((metric) => (
                  <span className="mode-chip muted" key={metric.label}>
                    {metric.label} {metric.value}
                  </span>
                ))}
              </div>
              <p className="supporting-copy route-note">{currentPlan.route.summaryText}</p>
              {currentPlan.warnings.length > 0 && (
                <div className="warning-list">
                  {currentPlan.warnings.map((warning, index) => (
                    <div className="warning-pill" key={`${warning.message}-${index}`}>
                      {warning.message}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <MapPanel plan={currentPlan} googleReady={googleReady} />
          </div>

          <section className="panel itinerary-panel">
            <div className="panel-head compact">
              <div>
                <p className="eyebrow">Timeline</p>
                <h2>Recommended stops</h2>
              </div>
              {statusMessage ? <span className="mode-chip success">{statusMessage}</span> : null}
            </div>

            {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
            {googleError && providerPreference !== 'demo' ? <div className="warning-pill">{googleError}</div> : null}

            <div className="timeline-list">
              {currentPlan.recommendations.map((recommendation) => {
                const Icon = CATEGORY_ICONS[recommendation.category];
                const slot = currentPlan.slots.find((item) => item.id === recommendation.slotId);
                const scoreRows = [
                  { label: 'Quality', value: recommendation.score.qualityScore },
                  { label: 'Timing', value: recommendation.score.slotFit },
                  { label: 'Taste', value: recommendation.score.preferenceFit },
                  { label: 'Open', value: recommendation.score.openNowFit },
                  { label: 'Low detour', value: 1 - recommendation.score.detourPenalty },
                ];

                return (
                  <article
                    className={`timeline-card ${recommendation.status === 'pinned' ? 'pinned' : ''} ${recommendation.status === 'skipped' ? 'skipped' : ''}`}
                    key={recommendation.slotId}
                  >
                    <div className="timeline-marker">
                      <Icon size={18} />
                    </div>
                    <div className="timeline-body">
                      <div className="timeline-card-head">
                        <div>
                          <p className="eyebrow">{CATEGORY_LABELS[recommendation.category]}</p>
                          <h3>{recommendation.candidate.name}</h3>
                          <p className="supporting-copy">{recommendation.candidate.formattedAddress}</p>
                        </div>
                        <div className="timeline-times">
                          <strong>{formatClock(recommendation.projectedArrivalAt)}</strong>
                          <span>to {formatClock(recommendation.projectedDepartureAt)}</span>
                        </div>
                      </div>
                      <div className="timeline-meta-row">
                        <span>{recommendation.candidate.avgRating.toFixed(1)} stars</span>
                        <span>{recommendation.candidate.ratingCount} reviews</span>
                        <span>{recommendation.candidate.detourMinutes} min detour</span>
                        <span>{Math.round(recommendation.candidate.routeProgressPercent)}% along route</span>
                        {slot ? <span>{formatDurationMinutes(slot.expectedDwellMinutes)} dwell</span> : null}
                        <span>Score {recommendation.score.totalScore.toFixed(2)}</span>
                      </div>
                      <div className="score-breakdown-grid">
                        {scoreRows.map((row) => (
                          <div className="score-row" key={row.label}>
                            <span>{row.label}</span>
                            <MeterBar className="mini-meter" value={clampPercent(row.value * 100)} decorative />
                            <strong>{Math.round(row.value * 100)}</strong>
                          </div>
                        ))}
                      </div>
                      <div className="reason-chip-row">
                        {recommendation.explanation.shortReasons.map((reason) => (
                          <span className="reason-chip" key={reason}>
                            {reason}
                          </span>
                        ))}
                      </div>
                      <p className="timeline-summary">{recommendation.explanation.summary}</p>
                      <div className="timeline-actions">
                        <button className="secondary-button" type="button" onClick={() => setReplaceSlotId(recommendation.slotId)}>
                          Replace
                        </button>
                        <button
                          className={`ghost-button ${recommendation.status === 'pinned' ? 'active' : ''}`}
                          type="button"
                          onClick={() =>
                            setCurrentPlan((previous) => (previous ? pinRecommendation(previous, recommendation.slotId) : previous))
                          }
                        >
                          {recommendation.status === 'pinned' ? 'Unpin' : 'Pin'}
                        </button>
                        <button
                          className={`ghost-button ${recommendation.status === 'skipped' ? 'active' : ''}`}
                          type="button"
                          onClick={() =>
                            setCurrentPlan((previous) => (previous ? skipRecommendation(previous, recommendation.slotId) : previous))
                          }
                        >
                          {recommendation.status === 'skipped' ? 'Restore' : 'Skip'}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </section>
      ) : null}

      <ReplaceDrawer
        recommendation={replaceRecommendationTarget}
        slot={replaceSlotTarget}
        onClose={() => setReplaceSlotId(null)}
        onSelectAlternative={handleSwapAlternative}
      />

      <footer className="site-footer panel">
        <span className="site-footer-label">More projects and writing</span>
        <a className="site-footer-link" href="https://maxwellmetzner.github.io/">
          maxwellmetzner.github.io
        </a>
      </footer>
    </div>
  );
}

export default App;
