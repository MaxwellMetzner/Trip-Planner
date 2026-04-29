interface MeterBarProps {
  value: number;
  max?: number;
  className?: string;
  decorative?: boolean;
  ariaLabel?: string;
}

export function MeterBar({
  value,
  max = 100,
  className = 'mini-meter',
  decorative = false,
  ariaLabel,
}: MeterBarProps) {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
  const accessibilityProps = decorative ? ({ 'aria-hidden': 'true' } as const) : ariaLabel ? ({ 'aria-label': ariaLabel } as const) : {};

  return <progress className={className} max={max} value={safeValue} {...accessibilityProps} />;
}