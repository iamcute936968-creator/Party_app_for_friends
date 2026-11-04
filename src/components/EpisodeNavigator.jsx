import { useMemo, useState } from 'react';
import './AnimePage.css';

const EMPTY = [];
const RANGE_SIZE = 100;

export default function EpisodeNavigator({ episodes = EMPTY, selectedNumber, onSelect, onHighlight, disabled = false, getAriaLabel }) {
  const items = useMemo(() => {
    const unique = new Map();
    for (const item of Array.isArray(episodes) ? episodes : EMPTY) {
      if (Number.isSafeInteger(item?.number) && item.number > 0 && !unique.has(item.number)) unique.set(item.number, item);
    }
    return [...unique.values()].sort((a, b) => a.number - b.number);
  }, [episodes]);
  const [rangeChoice, setRangeChoice] = useState(null);
  const [jump, setJump] = useState('');
  const [error, setError] = useState('');
  const selectedIndex = items.findIndex(item => item.number === selectedNumber);
  const selectionKey = `${selectedNumber ?? ''}/${items.map(item => item.number).join(',')}`;
  const range = rangeChoice?.key === selectionKey ? rangeChoice.value : Math.floor(Math.max(0, selectedIndex) / RANGE_SIZE);
  const ranges = Array.from({ length: Math.ceil(items.length / RANGE_SIZE) }, (_, index) => ({
    start: items[index * RANGE_SIZE].number,
    end: items[Math.min(items.length, (index + 1) * RANGE_SIZE) - 1].number,
  }));
  const select = item => {
    if (disabled || !item) return;
    setError('');
    setRangeChoice({ key: selectionKey, value: Math.floor(items.indexOf(item) / RANGE_SIZE) });
    onSelect?.(item);
  };
  const go = () => {
    if (disabled) return;
    const number = /^[1-9][0-9]*$/.test(jump.trim()) ? Number(jump.trim()) : NaN;
    const item = items.find(candidate => candidate.number === number);
    if (item) select(item);
    else setError('That episode number is not listed.');
  };

  return <div className="episode-navigator" role="group" aria-label="Episode navigation">
    {items.length === 0 ? <p>No episodes are available.</p> : <>
      <div className="episode-navigation-toolbar">
        <button className="room-button room-button-secondary" type="button" disabled={disabled || selectedIndex <= 0}
          onClick={() => select(items[selectedIndex - 1])}>Previous episode</button>
        <button className="room-button room-button-secondary" type="button" disabled={disabled || selectedIndex < 0 || selectedIndex === items.length - 1}
          onClick={() => select(items[selectedIndex + 1])}>Next episode</button>
        <label>Episode range<select aria-label="Episode range" value={range} disabled={disabled} onChange={event => setRangeChoice({ key: selectionKey, value: Number(event.target.value) })}>
          {ranges.map((item, index) => <option key={index} value={index}>{item.start}–{item.end}</option>)}
        </select></label>
        <label>Episode number<input type="text" inputMode="numeric" pattern="[0-9]*" value={jump} disabled={disabled}
          onChange={event => { setJump(event.target.value); setError(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); go(); } }} /></label>
        <button className="room-button room-button-secondary" type="button" disabled={disabled} onClick={go}>Go to episode</button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="episode-grid">
        {items.slice(range * RANGE_SIZE, (range + 1) * RANGE_SIZE).map(item => <button key={item.number} type="button"
          className="episode-grid-button" disabled={disabled} aria-label={getAriaLabel ? getAriaLabel(item) : `Watch episode ${item.number}`}
          aria-current={item.number === selectedNumber ? 'true' : undefined} title={`Episode ${item.number}${item.title ? ` — ${item.title}` : ''}`}
          onMouseEnter={() => onHighlight?.(item)} onFocus={() => onHighlight?.(item)}
          onClick={() => select(item)}>{item.number}</button>)}
      </div>
    </>}
  </div>;
}
