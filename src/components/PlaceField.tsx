import { useEffect, useRef } from 'react';
import type { PlaceInput } from '../types/trip';

interface PlaceFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  googleReady: boolean;
  onChange: (nextValue: string) => void;
  onPlaceSelect: (place: PlaceInput) => void;
}

export function PlaceField({
  id,
  label,
  value,
  placeholder,
  googleReady,
  onChange,
  onPlaceSelect,
}: PlaceFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  useEffect(() => {
    if (!googleReady || !inputRef.current || autocompleteRef.current) {
      return;
    }

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      fields: ['formatted_address', 'geometry', 'name', 'place_id'],
      types: ['geocode'],
    });

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      const labelText = place.formatted_address ?? place.name ?? inputRef.current?.value ?? '';
      onChange(labelText);
      onPlaceSelect({
        label: labelText,
        googlePlaceId: place.place_id,
        lat: place.geometry?.location?.lat(),
        lng: place.geometry?.location?.lng(),
      });
    });

    autocompleteRef.current = autocomplete;

    return () => {
      if (autocompleteRef.current) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
        autocompleteRef.current = null;
      }
    };
  }, [googleReady, onChange, onPlaceSelect]);

  return (
    <label className="field-shell" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input
        ref={inputRef}
        id={id}
        className="text-input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(nextValue);
          onPlaceSelect({ label: nextValue });
        }}
      />
    </label>
  );
}
