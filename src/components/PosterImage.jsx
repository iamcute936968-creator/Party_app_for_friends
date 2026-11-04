import { useState } from 'react';
function Poster({ src, alt, fallback }) {
  const [status, setStatus] = useState(src ? 'loading' : 'error');
  return <span className="poster-image" aria-busy={status === 'loading'}>
    {status === 'loading' && <span className="skeleton-shape poster-image-loading" aria-hidden="true" />}
    {status === 'error' ? <span className="poster-image-fallback" role="img" aria-label={alt}>{fallback}</span>
      : <img src={src} alt={alt} data-ready={status === 'ready'} loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setStatus('ready')} onError={() => setStatus('error')} />}
  </span>;
}
export default function PosterImage(props) { return <Poster key={props.src || ''} {...props} />; }
