'use client';

interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
}

export function GlassPanel({ children, className = '' }: GlassPanelProps) {
  return (
    <div className={`glass w-full px-4 py-3 ${className}`}>
      {children}
    </div>
  );
}
