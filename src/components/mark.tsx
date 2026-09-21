export function TapeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      fill="none"
    >
      <rect x="3" y="7" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <rect x="11" y="7" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
      <path d="M21 16h8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
