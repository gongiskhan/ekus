'use client';

type BadgeVariant = 'running' | 'completed' | 'failed' | 'disabled' | 'stopped';

interface StatusBadgeProps {
  variant: BadgeVariant;
  label?: string;
  className?: string;
}

const variantStyles: Record<BadgeVariant, { bg: string; text: string; dot: string }> = {
  running: { bg: 'rgba(217, 119, 6, 0.12)', text: '#b45309', dot: '#d97706' },
  completed: { bg: 'rgba(5, 150, 105, 0.12)', text: '#047857', dot: '#059669' },
  failed: { bg: 'rgba(220, 38, 38, 0.12)', text: '#b91c1c', dot: '#dc2626' },
  stopped: { bg: 'rgba(107, 114, 128, 0.12)', text: '#4b5563', dot: '#6b7280' },
  disabled: { bg: 'rgba(107, 114, 128, 0.12)', text: '#4b5563', dot: '#6b7280' },
};

const defaultLabels: Record<BadgeVariant, string> = {
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  disabled: 'Disabled',
};

export function StatusBadge({ variant, label, className = '' }: StatusBadgeProps) {
  const styles = variantStyles[variant];
  const displayLabel = label || defaultLabels[variant];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${className}`}
      style={{ background: styles.bg, color: styles.text }}
    >
      {variant === 'running' ? (
        <span
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ background: styles.dot }}
        />
      ) : (
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: styles.dot }}
        />
      )}
      {displayLabel}
    </span>
  );
}
