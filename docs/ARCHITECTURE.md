# Watch Party — Current Architecture

## High-level architecture

The current application is a React frontend using Firebase Realtime Database as the shared room state and signaling layer.

```text
React App
   |
   +-- App.jsx
   |     |
   |     +-- Room lifecycle
   |     +-- Firebase room state
   |     +-- YouTube playback
   |     +-- Chat
   |     +-- Presence
   |     +-- Screen-share coordination
   |
   +-- Home.jsx
   |
   +-- Room.jsx
   |
   +-- useWebRTC.js
          |
          +-- Screen-sharing WebRTC
          +-- Firebase signaling
```

## Current Firebase room shape

Conceptually:

```text
/rooms/{roomId}
  id
  host
  roomName
  createdAt
  participants/{username}: true

  videoId
  videoSource: "youtube" | "drive"
  isPlaying
  currentTime

  isSharing
  shareHost

  messages/
    {pushKey}/...

  webrtc/
    offers/
    answers/
    ice/
```

The exact implementation should always be checked against the source code before changing the schema.

## Authority

The host is currently the authority for shared playback.

Members consume the shared playback state.

Do not introduce multiple competing playback authorities without an explicit architectural reason.

## Current playback model

The current system uses:

- Host YouTube player
- Host periodic Firebase synchronization while playing
- Host event-based Firebase updates
- Member Firebase listener
- Member drift comparison
- Hard seek when drift exceeds the current threshold

Milestone 4A reduced unnecessary paused writes but did not redesign synchronization.

## Current WebRTC model

Screen sharing uses peer-to-peer WebRTC with Firebase signaling.

Current target is a small room, approximately 2–6 participants.

Known limitations include:

- No TURN server
- Viewer-initiated screen sharing has connection limitations
- Late joiners do not reliably receive an already-active screen share

These are separate concerns from Milestone 4B.

## Important architectural rules

### Do not mix unrelated changes

Playback synchronization work must not silently become:

- a WebRTC rewrite
- a chat rewrite
- an App.jsx refactor
- a styling redesign
- a Firebase migration
- a TypeScript migration

### Preserve rollback points

Each milestone should:

- change as few files as practical
- have a single clear purpose
- build successfully
- be independently reviewable
- be committed before the next risky milestone

## Future direction

The application may eventually be separated into focused hooks/services such as:

- room lifecycle
- video synchronization
- chat
- presence
- voice
- screen sharing

However, this is a future refactoring decision.

**Do not perform that refactor merely to implement Milestone 4B.**
