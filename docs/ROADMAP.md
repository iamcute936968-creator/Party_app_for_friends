# Watch Party — Roadmap

## Completed

### Milestone 1
**Chat concurrency**

- Firebase push-key messages
- Backward-compatible message reader
- Completed and reviewed

### Milestone 2
**Screen-share leave safety**

- Viewer leaving does not stop another user's active share
- Completed and reviewed

### Milestone 3
**YouTube API loading race**

- Explicit YouTube API readiness
- Safe player initialization
- Completed and reviewed

### Milestone 4A
**Reduce paused playback writes**

- Periodic host synchronization does not write while paused
- Event-based pause persistence remains
- Completed and reviewed

## Current

### Milestone 4B
**Playback synchronization architecture**

Goal:

Build a production-quality synchronization model for a 2–6 person watch party without a giant rewrite.

Status:

**Architecture review pending.**

The candidate direction is reference-clock synchronization, but this is not approved for implementation until the senior architecture review is complete.

## Planned 4B sequence

The final sequence will be determined after architecture review, but the preferred principle is:

```text
Architecture decision
        ↓
Small schema/data-model addition
        ↓
Host event production
        ↓
Member consumption
        ↓
Scenario validation
        ↓
Legacy sync removal
```

Do not jump directly to the final state.

## Later milestones

### Playback UX
- Better drift correction
- Better buffering behavior
- Continue watching
- Better late-join experience

### Presence
- Persistent avatars
- Online/offline status
- Speaking indicator
- Typing indicator
- Better participant identity

### Voice
- Microphone support
- Remote audio
- Mute/unmute
- Speaking detection

### Screen sharing
- Improve viewer-initiated sharing
- Late-join screen-share support
- TURN infrastructure when justified

### Social features
- Reactions
- Wishlist
- Watched history
- Continue watching

### Content
- Movie/anime metadata
- Legitimate external providers
- Rights-cleared user uploads
- Shared media library
- Object storage/CDN for uploaded content

### Product quality
- Mobile-first improvements
- Error boundaries
- Better UX instead of `alert()`
- Better accessibility
- Tests
- TypeScript where justified
- Component/service decomposition when it reduces complexity

## Architecture boundaries

Do not prematurely implement:

- Node/Express backend
- SFU
- microservices
- full state-management rewrite
- complete App.jsx rewrite
- unrelated UI redesign

Those may become appropriate later if actual product requirements justify them.
