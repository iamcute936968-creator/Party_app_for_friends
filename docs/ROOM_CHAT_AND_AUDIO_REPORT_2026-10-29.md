# Room chat, audio and loading release — 29 October 2026

Published at https://partyapp-fun.netlify.app.

- Frontend deployment: `6ae3640349fef63bdde0ddaa`.
- Firebase database rules published and read back exactly; normalized SHA-256: `cc7bddd834713f477418a37efc01ade237142975a88b5aefcbc92d9811b56fb8`.
- Cloud Run backend remains `party-media-proxy-ux20261029`.
- Previous frontend deployment retained: `6ae3209d73a5e7ecc09d97f2`.

## What changed

- Each private room has **Watch** and **Chat** tabs using its existing invite and members. Switching tabs preserves the player and live voice session.
- Watch has an aligned Play/Browse/Voice toolbar and a compact reaction picker: Like, Love, Applause, Happy, Sad, Laugh and Surprised. The large React row was removed. Desktop player height is bounded so the toolbar remains visible.
- People, presence and host moderation are in a People dialog. The duplicate room avatar picker was removed; profile controls remain in Account.
- Library, resume controls and private uploads are available through Browse media → Library. Members retain access; resuming the shared clock remains host-only.
- Own text messages can be edited for **three minutes**, enforced by Firebase rules using a trusted creation timestamp. Older legacy messages cannot be edited.
- Voice notes support explicit recording, preview, cancel, send and authenticated playback. Limits are **15 seconds**, **128 KiB per note** and **20 stored recording slots per room**. New recordings prefer empty slots; old own recordings may be replaced when full. New downloads expire after 24 hours; expiry alone does not physically delete stored bytes.
- Recording uses an owned microphone stream or clones of an already-open room microphone. Stopping a recording does not stop or unmute the original live microphone. Changing tabs cancels pending capture or stops recording; leaving releases resources.
- The host can confirm **Clear stored voice notes** to remove recording payloads and their audio-message references together.
- Fullscreen conversation supports edited messages and loading voice notes.

## Items 5, 6, 7 and 9

**5 — Verified Dub:** Mobile Suit Gundam: The Witch from Mercury episodes **1 and 2** have fixed official English-Dub YouTube sources. The UI supports solo playback and Watch together. Host Sub/Dub changes update the shared source and reset playback to zero because the cuts differ. This is limited coverage, not a claim that every anime has Dub. Unmapped episodes remain explicitly unavailable. Sources: [episode 1](https://www.youtube.com/watch?v=cq8zYG_hivI), [episode 2](https://www.youtube.com/watch?v=bRqqvwxlPFA).

**6 — Loading performance:** Public catalogue lists reuse recent results for 30 seconds, with a bounded in-memory cache. Private requests, credentials, audio payloads and playback streams are excluded. Browser tests prove returning to Movies adds no catalogue request, while changing search fetches fresh results. The home background changed from 1,965,055 bytes to 84,018 bytes: approximately **96% smaller**.

**7 — Broader playback checks:** On the current Windows network, real decoding and advancing clocks were observed for Naruto episodes 1 and 220, Tokyo Ghoul:re episode 1, Big Buck Bunny, and TV title 1399 at S1E1, S1E2 and S2E1. The three anime samples loaded English subtitle cues. External movie-player JavaScript errors were recorded separately; they did not prevent these sampled videos from playing. Movie/TV subtitle selection and universal catalogue availability were not established.

**9 — Lint:** The App.jsx backlog and remaining repository lint errors/warnings were cleared. `npm run lint` completes with zero findings.

## Verification

| Check | Result | Scope |
| --- | --- | --- |
| `npm test -- --reporter=dot` | **677 passed**, 97 files | Unit and integration tests |
| `npm run test:rules` | **49 passed** | Real local Auth/RTDB emulators; allow and rejection cases |
| `npm run test:rtc` | **7 passed** | Native browser media with local Firebase emulators and synthetic devices |
| Targeted Playwright browser suite | **52 checks passed** across runs | Desktop/mobile Chromium and WebKit |
| Final layout/fullscreen rerun | **20 passed** | Includes toolbar visibility after the desktop height adjustment |
| `npm run lint` | Passed | Zero errors/warnings |
| Build and deployed asset checks | Passed | Published JS/CSS/font bytes match the tested artifact |
| Post-deployment frontend checks | **7 groups passed** | Public origin, real catalogue/manga data, responsive layout; no preview transport bridge |
| Post-deployment room checks | Passed | Two real Firebase identities, text edit, recording send/download/decode, reactions, cleanup |
| Post-deployment Dub checks | Passed | Solo source switching and shared room Sub/Dub changes at position zero |

The native RTC scenario also verifies automatic 15-second recording stop, original microphone mute preservation, audio RTP, reconnection, screen video and revocation. The message editor's accessible label was corrected after a native browser test exposed an exact-label failure.

Production tests used newly created QA rooms and identities. Those rooms, recordings, access records and test identities were removed afterward. No Git staging, commit or push was performed; both existing Git index hashes were preserved.

## Security review

- **Medium, fixed after approval:** `database.rules.json` recording-slot deletion and `useRoomChat.js` cleanup. An authorized member could fill all 20 slots and then be removed, leaving remaining members unable to record for 24 hours. The emulator reproduced this. The approved fix permits active-host deletion of recording slots and audio-message references, preserves the prohibition on rewriting another member's payload, and leaves text/system deletion denied. Exhaustion → removal → cleanup → new host/member recording passes; production cleanup was also verified.
- **No additional confirmed finding in this scoped review.** Checks covered foreign/expired edits, immutable authorship, ancestor-write bypass attempts, private/revoked/expired recording access, payload/message binding, MIME/base64/size boundaries, escaped message/reaction rendering, capture cancellation and resource ownership. A production unauthenticated voice-note path read returned HTTP 401. Production rules matched the tested version exactly.

## Remaining limits

- Physical iPhone/Safari recording, real microphone sound quality, Iran/VPN networks and long endurance sessions remain unverified.
- Windows WebKit and mobile viewports do not substitute for a physical iPhone.
- Provider availability can vary by title, region and time; seven sampled streams do not establish that the entire catalogue works.
- More Dub episodes/titles require independently verified sources. Audio language labels use official release metadata; the automated runtime checks did not include a human listening assessment.
- Voice-note duration is bounded by the client recorder; the server validates bounded metadata and bytes, not decoded audio duration. The scoped review is not a claim that the whole application is completely secure.
- The native Android companion remains on hold.

Detailed receipts and scripts are in `C:\Users\ay936.DESKTOP-I7JB4HJ\.codex\tmp\watch-party-chat-20261029`.
