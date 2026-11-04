# Manga implementation and verification — 27 October 2026

Implemented locally. The frontend, media proxy and Firebase rules have **not been deployed** by this task. One medium security finding is reported below and awaits approval before remediation.

## What is available

- Open **Anime → Manga**. The five main navigation destinations remain intact.
- Browse and search MangaDex titles, view covers, descriptions, authors and genres, and open English chapter lists. The initial catalogue includes only titles marked `safe` by the provider.
- Read a chapter inside Watch Party, one image at a time. Use Previous/Next, arrow keys, or the page-number field. Failed pages have an explicit retry and do not replace the last successful bookmark.
- Save titles, open Saved manga, or resume from Continue reading. Chapter numbers such as `1.5` remain intact.
- Guest records remain in browser storage. Signed-in account records use a separate, owner-only Firebase branch and follow the account across devices. Importing guest history requires an explicit action.
- Desktop and mobile layouts share the existing charcoal/coral design. Reader pages and chapter credits link to MangaDex and the listed scanlation groups.
- Chapters linked by MangaDex to external publishers remain external links. Availability varies by title, translation and removals. This does not establish that every manga or chapter is available.

Reading is individual. Shared manga-room reading, offline downloads, additional translation languages, native mobile apps and deployment are outside this change.

## Interfaces and operational requirements

`media-proxy/lib/manga.cjs` uses the fixed MangaDex API, validates title/chapter relationships, resolves provider image assignments internally and proxies covers/pages. Client requests supply UUIDs and page numbers; they cannot supply arbitrary image URLs. Responses reject redirects, unexpected image types, invalid signatures and images exceeding 8 MiB. Metadata is bounded, cached and queued.

Routes:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/manga?search=...&page=1` | Catalogue/search |
| GET | `/api/manga/:id` | Title details |
| GET | `/api/manga/:id/cover` | Cover image |
| GET | `/api/manga/:id/chapters?page=1` | English chapters |
| GET | `/api/manga/:id/chapters/:chapterId` | Bound chapter metadata |
| GET | `/api/manga/:id/chapters/:chapterId/pages/:index` | One page image; zero-based index |

The optional image `attempt=0..99` query supports retries without accepting a source URL. Catalogue pagination stops at 50 pages and chapter feeds at 500 pages rather than offering a link that the backend would reject.

Private saved state is `accounts/:uid/mangaLibrary`. At most 50 records contain only `id`, `title`, `chapterId`, `page`, `saved` and `updatedAt`. No image URLs, access tokens or chapter image assignments are saved to Firebase or browser storage.

The optional backend environment setting `MANGA_BLOCKED_IDS` accepts comma-separated title UUIDs to remove titles from access when a removal request must be honored. This is owner configuration, not a public API.

MangaDex's published requirements include source/group attribution, proxying API and image traffic, limits on commercial use, and honoring applicable group removal requests. Keep this integration ad-free and without paid access unless the provider permits a different arrangement. The client preserves image-node path tokens and reports image outcomes to the fixed provider report endpoint when required. See [MangaDex API documentation](https://api.mangadex.org/docs/), [integration limitations](https://api.mangadex.org/docs/2-limitations/) and [chapter delivery documentation](https://api.mangadex.org/docs/04-chapter/retrieving-chapter/).

No new paid resource, provider account or dependency was installed. Images use normal HTTPS/backend bandwidth; they do not use the TURN relay quota. Deployment would need the frontend, backend and database rules together, followed by production validation and a check of the existing hosting allowances.

## Tests and results

Test-first failures were observed for missing manga API/library/reader behavior, the unimplemented Firebase branch, manga navigation, empty saved collections during an outstanding catalogue request, and pagination bounds. Each functional change then passed its affected unit/integration checks.

| Check | Command | Result |
| --- | --- | --- |
| Frontend unit and integration | `node node_modules/vitest/vitest.mjs run tests/unit tests/integration --maxWorkers=3` | **424 passed**, 70 files |
| Backend unit, integration and HTTP regressions | `npm test` in `media-proxy` | **63 unit + 16 integration + 38 HTTP = 117 passed** |
| Firebase Auth/Database rules | `firebase emulators:exec --only database,auth --project demo-watch-party --config firebase.emulators.json "node --test --test-force-exit tests/rules/database.test.mjs"` | **27 passed** |
| Chromium/WebKit desktop and mobile browser regressions | `node node_modules/@playwright/test/cli.js test --workers=3` | **200 passed, 4 skipped** |
| Real local account integration | Auth/Database `emulators:exec` running `playwright.rtc.config.js` with `account-sync.spec.js` and `manga-account.spec.js` | **2 passed** |
| Scoped ESLint | `node node_modules/eslint/bin/eslint.js src/manga src/components/MangaPage.jsx src/components/MangaReader.jsx src/hooks/useMangaLibrary.js src/hooks/useHomeNavigation.js src/components/Home.jsx` | **Passed** |
| Production build | `node node_modules/vite/bin/vite.js build` | **Passed**; existing large HLS chunk warning |
| Local security rejection checks | Artifact `security-checks.cjs` | **14 passed** |

The four browser skips are the existing Windows WebKit H.264 playback limitations in `anime-room.spec.js` and `media-playback.spec.js`, each on desktop/mobile. All manga browser checks ran and passed.

`App.jsx` retains **21 existing ESLint errors and 4 warnings**. Comparing diagnostic messages against the pre-change snapshot confirmed no additional diagnostics. The complete application lint gate is therefore not clean; the manga files and changed Home/navigation code pass the scoped check.

Real local Firebase integration verified that two separate browser contexts for the same account resume the same manga position, while another account cannot read its history. Google OAuth itself is substituted only within the Auth emulator; this is not a new live Google sign-in claim.

## Live provider evidence and coverage limits

A local frontend and the actual new backend routes successfully searched MangaDex, loaded the Yotsuba to! title and English chapter feed, decoded its cover and two chapter images at **1080 × 1535**, changed pages and restored page 2 after reload in a 390-pixel mobile layout. No browser page errors or horizontal overflow were observed. This is a representative live source check, not proof of the entire catalogue.

The observed live images came from the MangaDex upload host, for which node reporting was not required. Successful/failed external-node reports were verified with injected local responses, including their fixed destination and payload; actual network-node delivery/report acknowledgement was not observed in this sample.

Browser regression source responses and images are controlled fixtures. The live source check used Firebase fixtures, while the separate account checks used real local Firebase emulators. No production deployment, physical Android/iPhone check, load test or memory-exhaustion attack was performed.

## Security finding — approval required before remediation

- **Medium: image downloads have no global concurrency limit or in-flight deduplication.** Affected: `media-proxy/lib/manga.cjs:139` (`image`) and `media-proxy/server.cjs:267` (image-route request budget). After warming a valid chapter assignment, four simultaneous requests for the same page URL started four separate held image downloads while the metadata queue remained empty. The reproduction retained only **4 KiB** of synthetic JPEG fixture data, made **no external requests**, and did not attempt memory exhaustion. Each real download can retain up to **8 MiB**; the route permits **120 requests per IP per minute**, without an aggregate concurrency bound. A burst can amplify memory/backend-bandwidth consumption and disrupt the shared media proxy. Suggested fix: a bounded global image queue, sharing identical in-flight requests, an aggregate byte budget and cancellation for abandoned downloads. **Reported to the user; no security fix applied pending approval**, as required by the project's AGENTS.md.

Other local checks rejected non-provider hosts, nested/lookalike domains, userinfo/ports, encoded path separators, redirects, SVG/HTML, MIME/signature mismatches and oversized images. Removal blocks prevented metadata/image access before upstream calls. Firebase tests rejected unauthenticated/cross-account reads and writes, invalid UUIDs/page bounds and extra URL fields. Detached old reader-image events did not save stale bookmarks. No additional confirmed findings were identified within this scope; this does not establish complete security.

## Evidence and workspace preservation

Receipts and screenshots are in `C:\Users\ay936.DESKTOP-I7JB4HJ\.codex\tmp\watch-party-manga-20261027`:

- `verification.json`, `live-manga.json`, `live-manga-search.png`, `live-manga-chapters.png`, `live-manga-reader-desktop.png`, `live-manga-reader-mobile.png`
- `frontend-full.log`, `backend-final.log`, `rules-red.log`, `rules-green.log`, `browser-final.log`, `manga-accounts.log`, `build-final.log`
- `security-checks.cjs/json`, `security-concurrency.cjs/json`, `app-lint-baseline.json`, `changed-baseline-files.json`

The pre-existing source/test/config snapshot covered 202 files. Only 12 baseline files changed, all within this feature's frontend navigation/account wiring, Firebase rules/tests, or backend manga route/test registration. Existing work outside that scope was preserved. The Git index is unchanged; no files were staged or committed.
