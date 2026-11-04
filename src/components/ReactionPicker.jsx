import { useEffect, useRef, useState } from 'react';
import { Smile } from 'lucide-react';
import { reactionOptions } from '../reactions/options';
export default function ReactionPicker({ send, disabled }) {
  const [open, setOpen] = useState(false), host = useRef(null), trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!host.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="reaction-picker" ref={host}>
    <button ref={trigger} className="room-button room-button-secondary" type="button" aria-label="Reactions" title="Reactions" aria-expanded={open} onClick={() => setOpen(value => !value)}><Smile aria-hidden="true" /></button>
    {open && <div className="reaction-picker-options" role="group" aria-label="Send a reaction">{reactionOptions.map(option => <button className="room-button room-button-quiet" type="button" key={option.kind} disabled={disabled} aria-label={`React with ${option.label}`} onClick={() => { send?.(option.kind); setOpen(false); trigger.current?.focus(); }}><option.Icon aria-hidden="true" /><span>{option.label}</span></button>)}</div>}
  </div>;
}
