import { startTransition, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BatteryCharging,
  Bookmark,
  Clock3,
  Compass,
  Coffee,
  Fuel,
  Mountain,
  Route,
  Sparkles,
  Sun,
  Trees,
  Utensils,
  Wallet,
} from 'lucide-react';
import { MapPanel } from './components/MapPanel';
import { PlaceField } from './components/PlaceField';
import { ReplaceDrawer } from './components/ReplaceDrawer';
import { SavedTripsPanel } from './components/SavedTripsPanel';
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
import { deleteTrip, deriveLearnedPreferences, loadPreferences, loadSavedTrips, savePreferences, saveTrip } from './lib/storage';
import {
  formatClock,
  formatDateLabel,
  formatDistanceMeters,
  formatDurationMinutes,
  parseDateTimeLocal,
  toDateTimeLocalInputValue,
} from './lib/utils';
import type { Category, PlannedTrip, PlaceCandidate, PreferenceProfile, TripPlanningRequest } from './types/trip';

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

const PRESETS: Array<{
  label: string;
  summary: string;
  apply: (request: TripPlanningRequest) => TripPlanningRequest;
}> = [
  {
    label: 'Fast lunch run',
    summary: 'One meal stop, one coffee, low detour pressure.',
    apply: (request) => ({
      ...request,
      itineraryMode: 'fastest_reasonable',
      mealStopCount: 1,
      activeCategories: ['coffee'],
      desiredStopsByCategory: { coffee: 1 },
      detourToleranceMinutes: 12,
      categoryImportance: { coffee: 'medium', lunch: 'high' },
    }),
  },
  {
    label: 'Scenic arc',
    summary: 'Outdoor-forward trip with a stronger attraction appetite.',
    apply: (request) => ({
      ...request,
      itineraryMode: 'experience_focused',
      mealStopCount: 1,
      activeCategories: ['coffee', 'scenic_overlook', 'hike', 'attraction'],
      desiredStopsByCategory: { coffee: 1, scenic_overlook: 1, hike: 1, attraction: 1 },
      detourToleranceMinutes: 26,
      categoryImportance: {
        coffee: 'medium',
        scenic_overlook: 'high',
        hike: 'high',
        attraction: 'medium',
        lunch: 'medium',
      },
    }),
  },
  {
    label: 'Family buffer',
    summary: 'More predictable breaks and kid-friendly weighting.',
    apply: (request) => ({
      ...request,
      itineraryMode: 'best_overall',
      mealStopCount: 2,
      activeCategories: ['coffee', 'rest_stop', 'attraction'],
      desiredStopsByCategory: { coffee: 1, rest_stop: 1, attraction: 1 },
      detourToleranceMinutes: 16,
      preferences: {
        ...request.preferences,
        childFriendly: true,
        idealBreakCadenceMinutes: 120,
      },
      categoryImportance: {
        coffee: 'medium',
        rest_stop: 'high',
        attraction: 'medium',
        lunch: 'high',
        dinner: 'medium',
      },
    }),
  },
];

type WizardStepId = 'locations' | 'travel' | 'meals' | 'stops' | 'preferences' | 'review';

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

function App() {
  const initialTrips = loadSavedTrips();
  const initialPreferences = deriveLearnedPreferences(initialTrips, loadPreferences());
  const initialRequest = createDefaultTripRequest();
  initialRequest.preferences = initialPreferences;
  initialRequest.departureAt = toDateTimeLocalInputValue(initialRequest.departureAt);

  const [preferences, setPreferences] = useState<PreferenceProfile>(initialPreferences);
  const [savedTrips, setSavedTrips] = useState<PlannedTrip[]>(initialTrips);
  const [request, setRequest] = useState<TripPlanningRequest>(initialRequest);
  const [currentPlan, setCurrentPlan] = useState<PlannedTrip | null>(null);
  const [planningState, setPlanningState] = useState<'idle' | 'planning'>('idle');
  const [providerPreference, setProviderPreference] = useState<'auto' | 'google' | 'demo'>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? 'auto' : 'demo',
  );
  const [googleReady, setGoogleReady] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [replaceSlotId, setReplaceSlotId] = useState<string | null>(null);
  const [activeStepId, setActiveStepId] = useState<WizardStepId>('locations');

  const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '';
  const wantsGoogle = providerPreference !== 'demo' && Boolean(googleKey);
  const effectiveProviderMode = providerPreference === 'google' ? (googleReady ? 'google' : 'google') : wantsGoogle && googleReady ? 'google' : 'demo';
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
    .join(' · ');
  const activeCategorySummary =
    request.activeCategories.length > 0
      ? request.activeCategories.map((category) => CATEGORY_LABELS[category]).join(', ')
      : 'No optional stop categories selected yet.';
  const cuisineSummary = preferences.cuisines.length > 0 ? preferences.cuisines.join(', ') : 'No cuisine hints yet';

  useEffect(() => {
    savePreferences(preferences);
    setRequest((previous) => ({ ...previous, preferences }));
  }, [preferences]);

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
          setGoogleError(error.message);
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

  async function handlePlanTrip() {
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

      setStatusMessage('Itinerary ready. Review and fine-tune stops below.');
      startTransition(() => {
        setCurrentPlan(plan);
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Trip planning failed.');
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

    const nextTrips = saveTrip(tripToSave);
    setSavedTrips(nextTrips);
    setPreferences((previous) => deriveLearnedPreferences(nextTrips, previous));
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
            <div className="preset-row">
              {PRESETS.map((preset) => (
                <button key={preset.label} className="preset-card" type="button" onClick={() => applyPreset(preset.label)}>
                  <strong>{preset.label}</strong>
                  <span>{preset.summary}</span>
                </button>
              ))}
            </div>

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
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <header className="hero hero-single panel">
        <div className="hero-copy hero-copy-wide">
          <p className="eyebrow">Route-aware recommendations</p>
          <h1>Trip Planner</h1>
          <p className="hero-lede">
            A guided trip planner that moves through locations, travel timing, meals, stops, and preferences one step at a
            time so the route is easier to shape before you build the itinerary.
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

            <div className="guide-progress-track" aria-hidden="true">
              <div className={`guide-progress-fill step-${activeStepIndex + 1}`} />
            </div>

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
              <span className="stats-label">Planner source</span>
              <strong>{renderProviderStatus()}</strong>
              <p>Change this in the travel step if you want to switch between Google and the demo provider.</p>
            </div>
          </section>

          <SavedTripsPanel trips={savedTrips} onOpen={handleOpenSavedTrip} onDelete={handleDeleteTrip} />
        </aside>
      </main>

      {currentPlan ? (
        <section className="workspace-grid">
          <div className="workspace-top-row">
            <section className="panel workspace-summary-panel">
              <div className="panel-head compact">
                <div>
                  <p className="eyebrow">Current itinerary</p>
                  <h2>{`${currentPlan.request.origin.label} to ${currentPlan.request.destination.label}`}</h2>
                </div>
                <div className="summary-head-actions">
                  <span className="mode-chip">{effectiveProviderMode === 'google' ? 'Google-backed' : 'Client demo'}</span>
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
                        <span>Score {recommendation.score.totalScore.toFixed(2)}</span>
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
    </div>
  );
}

export default App;
