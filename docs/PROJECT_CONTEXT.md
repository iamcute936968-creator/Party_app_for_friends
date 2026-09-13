# Watch Party — Project Context

## What this project is

Watch Party is a social web application for watching video content together with friends.

The project started as a simple YouTube watch-together prototype and is being evolved into a polished 2–6 person social watch-party platform.

This is a real project that has already been used multiple times by the developer and friends, including friends in different countries. Therefore, **existing working behavior is valuable and must be preserved during improvements**.

## Core product goals

- Create and join watch rooms
- Synchronize YouTube playback between participants
- Host/member permissions
- Room invites
- Real-time participant presence
- Chat
- Screen sharing
- Microphone/voice chat
- Speaking indicator
- Typing indicator
- Reactions
- Online/offline presence
- Wishlist
- Watched/history
- Continue watching
- Movie/anime search and metadata
- Legitimate external content/metadata integrations
- User/community uploaded media where the uploader has the necessary rights
- Strong mobile experience
- Professional UI that feels deliberately designed rather than AI-generated

## Current technology

- React 19
- Vite 7
- Tailwind CSS 3
- Firebase Realtime Database
- YouTube IFrame Player API
- WebRTC for screen sharing
- Motion / Motion for React for deliberate animation
- Lucide icons
- shadcn/ui

### Important technology constraints

- Keep Tailwind CSS.
- Do not replace Firebase just for architectural fashion.
- Do not introduce a backend unless a concrete requirement justifies it.
- Do not introduce an SFU for the current 2–6 participant target without strong evidence that P2P is insufficient.
- Do not scrape third-party streaming sites.
- Metadata APIs do not grant streaming/distribution rights.

## Stable baseline

Current stable commit:

`d8f9d83`

Commit:

`fix(sync): reduce paused playback writes`

The working tree was clean at this baseline.

## Completed milestones

### Milestone 1 — Chat concurrency

Commit:

`d55c38f`

Changed chat writes from array read-modify-write to Firebase push-key entries.

The reader remains backward compatible with old array-based messages.

### Milestone 2 — Screen-share leave behavior

Commit:

`a496a14`

A viewer leaving a room no longer tears down another participant's active screen share.

Only the actual share owner performs the shared database teardown.

### Milestone 3 — YouTube API loading race

Commit:

`12f7807`

Added YouTube API readiness state and guarded player creation against the API loading after the video ID.

### Milestone 4A — Reduce paused playback writes

Commit:

`d8f9d83`

The host's periodic synchronization loop no longer writes to Firebase while paused.

The host still persists pause state through the YouTube state-change handler.

## Current Milestone

Milestone 4B is focused on playback synchronization architecture.

We are considering a reference-clock / anchor-time architecture, but **implementation must wait until the architecture review is complete**.

Claude Opus 4.6 is being used as the senior architecture reviewer.

Do not implement the new synchronization architecture before that review is accepted.

## Product principle

This project has real users and real usage history.

Prefer:

1. Small changes
2. Stable intermediate commits
3. Independent review
4. Build verification
5. Easy rollback

Avoid giant rewrites.
