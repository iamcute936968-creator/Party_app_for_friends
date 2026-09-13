# Watch Party

A social web app for watching video content together with friends. Watch Party synchronizes YouTube playback across a small room (target 2-6 participants), with in-room chat and peer-to-peer screen sharing.

The project started as a simple YouTube watch-together prototype and is being evolved into a polished social watch-party platform. It has been used in real watch sessions, including with friends in different countries.

## Current features

- Create and join watch rooms
- Synchronized YouTube playback - the host is the playback authority; members follow shared playback state and re-sync when drift exceeds a threshold
- In-room chat
- Screen sharing via peer-to-peer WebRTC
- Real-time participant list

## Technology and architecture

- **React 19** frontend built with **Vite 7**
- **Tailwind CSS 3** for styling
- **Firebase Realtime Database** for shared room state, chat, presence, and WebRTC signaling
- **YouTube IFrame Player API** for playback
- **WebRTC** for peer-to-peer screen sharing
- **Lucide** icons

The app is a React frontend with no custom backend: Firebase Realtime Database acts as the shared room-state and signaling layer. While playing, the host periodically reports the playback position; members compare against their own position and hard-seek when drift is too large. Screen sharing uses P2P WebRTC with Firebase signaling. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project documentation

- [Project context](docs/PROJECT_CONTEXT.md) - product goals, technology constraints, milestone history
- [Architecture](docs/ARCHITECTURE.md) - current system architecture and rules
- [Development rules](docs/DEVELOPMENT_RULES.md) - change process, review policy, coding restrictions
- [Playback sync specification](docs/PLAYBACK_SYNC_SPEC.md) - draft spec for the planned synchronization redesign
- [Roadmap](docs/ROADMAP.md) - completed milestones and planned work

## Local development

Requires Node.js and npm.

```bash
npm install
npm run dev
```

Other scripts:

```bash
npm run build    # production build
npm run preview  # preview the production build
npm run lint     # ESLint
```

Room state, chat, and signaling rely on the Firebase Realtime Database configured in the app.

## Current status and roadmap

Completed stability milestones (branch `fix/foundation-stability`):

- Chat concurrency fix (Firebase push-key messages, backward-compatible reader)
- Screen-share leave safety (a viewer leaving no longer tears down another user's share)
- YouTube API loading race fix (guarded player initialization)
- Reduced paused playback writes

**In progress:** Milestone 4B - playback synchronization architecture. A reference-clock synchronization model is under consideration, but implementation is on hold pending architecture review. See [docs/PLAYBACK_SYNC_SPEC.md](docs/PLAYBACK_SYNC_SPEC.md).

**Planned (not yet implemented):** improved drift correction and buffering, continue watching, persistent avatars and richer presence, voice chat, improved screen sharing (including TURN infrastructure when justified), reactions, wishlist, watch history, and media search/metadata integrations. See the [roadmap](docs/ROADMAP.md) for details.

## Known limitations

- Playback sync is based on the host's periodically reported position, which can be affected by network latency and stale values
- WebRTC has no TURN server, so screen sharing may fail on restrictive networks
- Viewer-initiated screen sharing has connection limitations
- Late joiners do not reliably receive an already-active screen share
