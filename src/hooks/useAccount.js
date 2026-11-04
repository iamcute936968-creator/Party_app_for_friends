import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAccountActions } from '../auth/accountActions';

export function useAccount(auth, sdk, roomActive, entryPending, isEntryPending) {
  const [user, setUser] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [collision, setCollision] = useState(false);
  const boundary = useRef({ roomActive, entryPending, isEntryPending });
  boundary.current = { roomActive, entryPending, isEntryPending };
  const blocked = useCallback(() => boundary.current.roomActive || boundary.current.entryPending || boundary.current.isEntryPending?.(), []);
  const transition = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = sdk.onAuthStateChanged(auth, value => { if (mounted.current) setUser(value); },
      () => { if (mounted.current) setError('Your account is unavailable. Please try again.'); });
    return () => { mounted.current = false; unsubscribe?.(); };
  }, [auth, sdk]);
  const actions = useMemo(() => createAccountActions(auth, sdk, blocked), [auth, sdk, blocked]);
  const run = method => {
    if (transition.current) return transition.current;
    if (blocked()) {
      setError('Finish entering or leave your room before changing your account.');
      return Promise.resolve();
    }
    setPending(true); setError(''); setCollision(false);
    transition.current = actions[method]().catch(reason => {
      if (mounted.current) {
        setCollision(reason.code === 'account-collision');
        setError(reason.code === 'account-collision'
          ? 'This Google account already exists. Choose Use existing Google account to switch to it.'
          : 'Could not update your account. Please try again.');
      }
    }).finally(() => {
      transition.current = null;
      if (mounted.current) setPending(false);
    });
    return transition.current;
  };
  return { user, pending, error, collision, isTransitioning: () => Boolean(transition.current),
    connectGoogle: () => run('connectGoogle'), useExistingGoogleAccount: () => run('useExistingGoogleAccount'), disconnect: () => run('disconnect') };
}
