import { useEffect, useState } from 'react';
import { getTypingNames } from '../presence/participantFeatures';
export default function TypingIndicator({ records, participants = [], username, offset = 0 }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!records || !Object.keys(records).length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);
  }, [records]);
  const names = getTypingNames(records, participants, username, Math.max(now, Date.now()) + offset);
  if (!names.length) return null;
  const text = names.length === 1 ? `${names[0]} is typing…` : `${names.slice(0, 2).join(' and ')}${names.length > 2 ? ` and ${names.length - 2} others` : ''} are typing…`;
  return <p className="typing-notice" role="status" aria-label="Room typing status">{text}</p>;
}
