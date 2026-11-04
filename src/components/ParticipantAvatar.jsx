import { AVATARS, avatarFor } from '../presence/participantFeatures';
import { normalizeAccountProfile } from '../auth/accountProfile';
import './ParticipantAvatar.css';
export function ParticipantAvatar({ name = '', profile }) {
  const photoURL = normalizeAccountProfile(profile).photoURL;
  return <span className={`participant-initial avatar-${avatarFor(name, profile)}`} aria-hidden="true">{Array.from(name.trim()).slice(0, 1).join('').toUpperCase() || '?'}
    {photoURL && <img key={photoURL} src={photoURL} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}</span>;
}
export function AvatarPicker({ value = 'slate', onChange }) {
  return <label className="avatar-picker">Your avatar colour<select value={value} onChange={event => onChange?.(event.target.value)}>
    {AVATARS.map(avatar => <option key={avatar} value={avatar}>{avatar[0].toUpperCase() + avatar.slice(1)}</option>)}
  </select></label>;
}
