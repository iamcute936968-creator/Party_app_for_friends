export default function LoadingSkeleton({ label = 'Loading catalogue…', variant = 'grid', count = 10 }) {
  return <div className="loading-skeleton" data-layout={variant} role="status" aria-label={label} aria-live="polite" aria-busy="true">
    <span className="loading-message">{label}</span>
    <div className={`skeleton-layout skeleton-${variant}`} aria-hidden="true">
      {variant === 'grid' ? Array.from({ length: count }, (_, i) => <div className="skeleton-card" key={i}><div className="skeleton-shape skeleton-poster" /><div className="skeleton-shape skeleton-line" /><div className="skeleton-shape skeleton-line skeleton-short" /></div>)
        : variant === 'detail' ? <><div className="skeleton-shape skeleton-poster" /><div className="skeleton-copy"><div className="skeleton-shape skeleton-title" /><div className="skeleton-shape skeleton-line skeleton-short" /><div className="skeleton-shape skeleton-paragraph" /><div className="skeleton-shape skeleton-line" /></div></>
        : variant === 'player' ? <div className="skeleton-shape skeleton-player" />
        : Array.from({ length: 5 }, (_, i) => <div className="skeleton-shape skeleton-row" key={i} />)}
    </div>
  </div>;
}
