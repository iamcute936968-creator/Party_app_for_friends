# Watch Party — Playback Synchronization Specification

## Status

**DRAFT — ARCHITECTURE REVIEW PENDING**

This document records the problem and candidate design. It is intentionally not an implementation specification yet.

Claude Opus 4.6 is reviewing the architecture before implementation.

## Problem

The current playback model periodically sends the host's current YouTube position to Firebase.

That model can suffer from:

- network latency
- stale position values
- unnecessary writes
- jitter
- repeated correction
- buffering interactions
- synchronization feedback loops

Milestone 4A already reduced paused-state writes.

## Candidate reference-clock model

A possible future model is:

```js
{
  playbackState: "PLAYING" | "PAUSED",
  anchorTime: 125.4,
  updatedAt: <server timestamp>
}
```

Interpretation:

- `anchorTime` is the video position at the synchronization anchor.
- `updatedAt` represents the server-side time associated with that anchor.
- While playing, expected position advances from the anchor.
- While paused, expected position remains at the anchor.

Conceptually:

```text
expectedPosition =
  anchorTime + elapsedServerTime
```

## Candidate clock mechanism

Firebase can provide:

- server timestamps
- `/.info/serverTimeOffset`

However, server timestamps and client/server offset are not automatically a perfect synchronization system.

The final approach must account for network delay and realistic client clock behavior.

## Questions that must be resolved before implementation

1. Is reference-clock synchronization actually the best model for this application?
2. Should Firebase remain the source of truth?
3. Should the system use:
   - currentTime
   - anchorTime + updatedAt
   - server timestamps
   - serverTimeOffset
   - a hybrid?
4. How should play be represented?
5. How should pause be represented?
6. How should seek be represented?
7. How should late joiners calculate their position?
8. How should buffering work?
9. Should host buffering affect other participants?
10. How should ended videos be represented?
11. How should loading a new video work?
12. How should synchronization-caused YouTube events be distinguished from genuine user actions?
13. How should feedback loops be prevented?
14. How should disconnect/reconnect work?
15. How should out-of-order updates be handled?
16. What drift correction thresholds are appropriate?

## Important design constraint

Do NOT automatically adopt:

```text
<1.5s  = ignore
1.5–3s = playbackRate correction
>3s    = hard seek
```

Those values are only an earlier proposal.

The final architecture review must justify its own thresholds and correction strategy.

## Buffering principle

A host entering a temporary YouTube buffering state is not necessarily equivalent to the shared room intentionally pausing.

The final design must explicitly distinguish:

```text
player temporarily buffering
```

from:

```text
shared playback intentionally paused
```

Do not automatically stop every member merely because one player's buffer is temporarily exhausted.

## Feedback-loop principle

Synchronization commands can themselves cause YouTube `onStateChange` events.

For example:

```text
Firebase update
    ↓
member seekTo()
    ↓
YouTube event
    ↓
possible Firebase write
```

The implementation must prevent this from becoming a feedback loop.

## Migration principle

Do not remove the existing synchronization mechanism in the first step.

A safer migration is expected to be incremental:

1. Introduce new synchronization data alongside the existing model.
2. Produce new host synchronization events.
3. Teach members to consume the new model.
4. Validate all playback scenarios.
5. Remove legacy periodic synchronization only after validation.

The exact sequence remains subject to the Opus architecture review.

## Test scenarios

At minimum, validate:

- host play
- host pause
- host seek
- rapid seek
- new video
- video ended
- member joins while paused
- member joins while playing
- member leaves
- host leaves/rejoins
- Firebase reconnect
- member reconnect
- temporary host buffering
- temporary member buffering
- slow network
- multiple members
- simultaneous UI/player events
