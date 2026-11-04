import { useState } from 'react';
import { normalizeAccountProfile } from '../auth/accountProfile';

function ProfileForm({ profile, saveProfile, disabled }) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [sharePhoto, setSharePhoto] = useState(profile.sharePhoto);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const submit = async event => {
    event.preventDefault();
    if (saving || disabled) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      await saveProfile(normalizeAccountProfile({ displayName, photoURL: profile.photoURL, sharePhoto }));
      setSaved(true);
    } catch { setError('Could not save your profile. Please try again.'); }
    finally { setSaving(false); }
  };
  return <form className="entry-form account-profile-form" onSubmit={submit}>
    <div className="account-avatar" aria-hidden="true">
      {sharePhoto && profile.photoURL && !photoFailed
        ? <img src={profile.photoURL} alt="" referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)} />
        : <span>{Array.from(displayName.trim())[0]?.toUpperCase() || 'G'}</span>}
    </div>
    <label>Display name<input value={displayName} maxLength={40} disabled={disabled || saving}
      onChange={event => { setDisplayName(event.target.value); setSaved(false); }} /></label>
    {profile.photoURL && <label className="account-photo-consent"><input type="checkbox" checked={sharePhoto} disabled={disabled || saving}
      onChange={event => { setSharePhoto(event.target.checked); setSaved(false); }} />Share Google photo with room</label>}
    <button className="room-button room-button-primary" type="submit" disabled={disabled || saving}>{saving ? 'Saving profile…' : 'Save profile'}</button>
    {saved && <p role="status">Profile saved.</p>}
    {error && <p role="alert">{error}</p>}
  </form>;
}

function AccountContent({ account, library, profile, saveProfile }) {
  const [actionError, setActionError] = useState('');
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [importError, setImportError] = useState('');
  const signedIn = Boolean(account.user && !account.user.isAnonymous);
  const normalized = normalizeAccountProfile({ displayName: profile?.displayName || account.user?.displayName,
    photoURL: profile?.photoURL, sharePhoto: profile?.sharePhoto });
  const run = async action => {
    setActionError('');
    try { await action?.(); }
    catch { setActionError('Could not update your account. Please try again.'); }
  };
  const importGuest = async () => {
    if (importing || account.pending) return;
    setImporting(true); setImported(false); setImportError('');
    try { await library.importGuest(); setImported(true); }
    catch { setImportError('Could not import your guest library. Please try again.'); }
    finally { setImporting(false); }
  };
  return <section className="account-panel" aria-label="Your account">
    <div className="account-panel-heading">
      <h2>{signedIn ? normalized.displayName || 'Google account' : 'Guest account'}</h2>
      <p>{signedIn ? 'Your viewing library can follow you between devices.' : 'Sign in with Google to sync your viewing library between devices.'}</p>
    </div>
    <div className="account-actions">
      {signedIn
        ? <button className="room-button room-button-secondary" type="button" disabled={account.pending} onClick={() => run(account.disconnect)}>Sign out</button>
        : <button className="room-button room-button-primary" type="button" disabled={account.pending} onClick={() => run(account.connectGoogle)}>Continue with Google</button>}
      {account.collision && <button className="room-button" type="button" disabled={account.pending}
        onClick={() => run(account.useExistingGoogleAccount)}>Use existing Google account</button>}
    </div>
    {account.pending && <p role="status">Updating your account…</p>}
    {account.error && <p role="alert">{account.error}</p>}
    {actionError && <p role="alert">{actionError}</p>}
    {signedIn && saveProfile && <ProfileForm key={JSON.stringify([normalized.displayName, normalized.photoURL, normalized.sharePhoto])}
      profile={normalized} saveProfile={saveProfile} disabled={account.pending} />}
    {signedIn && library && <div className="account-cloud-library">
      {library.cloudStatus === 'syncing' && <p role="status">Syncing your cloud library…</p>}
      {library.cloudStatus === 'synced' && <p role="status">Cloud library is up to date.</p>}
      {(library.cloudStatus === 'error' || library.cloudError) && <p role="alert">Your cloud library is unavailable. Please try again.</p>}
      {library.guestItemCount > 0 && typeof library.importGuest === 'function' && <button className="room-button" type="button"
        disabled={account.pending || importing} onClick={importGuest}>{importing ? 'Importing guest library…' : 'Import guest library'}</button>}
      {imported && <p role="status">Guest library imported.</p>}
      {importError && <p role="alert">{importError}</p>}
    </div>}
  </section>;
}

export default function AccountPanel({ account = null, library = null, profile = null, saveProfile } = {}) {
  return account ? <AccountContent key={account.user?.uid || 'guest'} account={account} library={library} profile={profile} saveProfile={saveProfile} /> : null;
}
