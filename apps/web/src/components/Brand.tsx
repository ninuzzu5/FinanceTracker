export function Brand({ large = false }: { large?: boolean }) {
  return <div className={`brand${large ? " brand-large" : ""}`}>
    <svg className="brand-mark" viewBox="0 0 40 40" fill="currentColor" aria-hidden="true">
      <rect x="3" y="24" width="8" height="12" rx="1" />
      <rect x="16" y="14" width="8" height="22" rx="1" />
      <rect x="29" y="4" width="8" height="32" rx="1" />
    </svg>
    <span>Finance<span className="brand-accent">Tracker</span></span>
  </div>;
}
