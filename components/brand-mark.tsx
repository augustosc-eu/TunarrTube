export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="24" height="24" rx="7" fill="var(--accent)" />
      <path d="M8 8.5 13 13.5 18 8.5" stroke="var(--accent-contrast)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 13.5V19" stroke="var(--accent-contrast)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
