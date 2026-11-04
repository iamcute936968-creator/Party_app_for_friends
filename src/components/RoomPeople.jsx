import { useEffect, useRef, useState } from 'react';
import { Users, Mic, MicOff, X } from 'lucide-react';
import { ParticipantAvatar } from './ParticipantAvatar';
import { isVoiceActive } from '../voice/voiceState';
export default function RoomPeople({ room, participants, username, participantFeatures, isHost, moderation, connectionStatus, close, returnFocus }) {
  const dialog = useRef(null), [moderationTarget, setModerationTarget] = useState(null);
  useEffect(() => {
    const node = dialog.current, previous = returnFocus?.current || document.activeElement;
    if (node?.showModal) node.showModal(); else node?.setAttribute('open', '');
    return () => { node?.close?.(); if (previous?.isConnected) previous.focus(); };
  }, [returnFocus]);
  return <dialog ref={dialog} className="room-people-dialog" aria-label="Room people" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <header><h2>Your people</h2><button className="stage-button" type="button" aria-label="Close people" onClick={close}><X aria-hidden="true" /></button></header>
          <section className="participants-panel">
            <h2><Users aria-hidden="true" />Participants ({participants.length})</h2>
            <ul>{participants.map((name) => <li key={name}>
              <ParticipantAvatar name={name} profile={name === username && participantFeatures ? { avatar: participantFeatures.avatar } : room?.profiles?.[name]} />
              <span className="participant-name">{name}</span>{name === room?.host && <span className="participant-role">Host</span>}
              {name === username && <span className="participant-role">You</span>}
              {isVoiceActive(room?.voice?.[name]) && <span className="participant-voice" aria-label={`${name} microphone ${room.voice[name].muted ? 'muted' : 'on'}`}>
                {room.voice[name].muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
                {room.voice[name].speaking && !room.voice[name].muted && <span role="status" aria-label={`${name} speaking`}>Speaking</span>}
              </span>}
              <span className="participant-online" aria-label="Online" />
              {isHost && moderation && name !== room?.host && name !== username && <span className="participant-moderation">
                <button type="button" disabled={moderation.pending || connectionStatus !== 'connected'} aria-label={`Remove ${name}`} onClick={() => setModerationTarget({ name, ban: false })}>Remove</button>
                <button type="button" disabled={moderation.pending || connectionStatus !== 'connected'} aria-label={`Ban ${name}`} onClick={() => setModerationTarget({ name, ban: true })}>Ban</button>
              </span>}
            </li>)}</ul>
            {isHost && moderation && <div className="room-moderation">
              {moderationTarget && <div role="group" aria-label={`Moderate ${moderationTarget.name}`}>
                <p>{moderationTarget.ban ? `Ban ${moderationTarget.name} from this room?` : `Remove ${moderationTarget.name} from this room? They can rejoin with the invite.`}</p>
                <button className="room-button room-button-secondary" type="button" disabled={moderation.pending || connectionStatus !== 'connected'} onClick={async () => {
                  await moderation.remove(moderationTarget.name, moderationTarget.ban); setModerationTarget(null);
                }}>{moderationTarget.ban ? 'Confirm ban' : 'Confirm removal'}</button>
                <button className="room-button room-button-quiet" type="button" disabled={moderation.pending} onClick={() => setModerationTarget(null)}>Cancel</button>
              </div>}
              {moderation.error && <p role="alert">{moderation.error}</p>}
              <details><summary>Banned members ({moderation.banned?.length || 0})</summary>
                <p>Bans apply to an account in this room. Someone using a new guest identity may be able to join again.</p>
                <ul>{moderation.banned?.map(item => <li key={item.uid}><span>{item.name}</span>
                  <button className="room-button room-button-quiet" type="button" disabled={moderation.pending || connectionStatus !== 'connected'} aria-label={`Unban ${item.name}`} onClick={() => { void moderation.unban(item.uid); }}>Unban</button>
                </li>)}</ul>
              </details>
            </div>}
            {participantFeatures?.error && <p className="participant-profile-error" role="status">{participantFeatures.error}</p>}
          </section>

  </dialog>;
}
