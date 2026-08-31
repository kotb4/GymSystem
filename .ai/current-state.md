# Current Development State

- **Last updated:** 2026-08-31
- **Current objective:** Member photo display at check-in/reception + webcam capture implemented; committed + pushed to GitHub
- **Status:** TASK-018 (member photo display + camera capture) complete — all verification green, committed and pushed
- **Last agent/tool:** opencode (this session)

## Active tasks

- None open. TASK-018 (member photo at check-in/reception + camera capture) is complete, verified, and pushed. Earlier TASK-017 (loyalty) is also complete. Optional future follow-ups are tracked in `.ai/tasks.md`.

## What was most recently completed (handoff context)

### TASK-018 — Member photo display + camera capture (2026-08-31)
The member's photo now appears at check-in and on the reception page, and operators can set the photo either by uploading a file or by capturing it live with the webcam.

Most of the plumbing already existed: `members.photo_file_id` (migration v6), `setMemberPhoto`/`removeMemberPhoto` RPC, `api.files.upload`/`url`, and photo display + file-upload + remove in the member profile header. What was missing and added here:

**Backend** — `src/core/services/attendance.service.ts`: `CheckInResult` success variant gained `photoFileId: string | null`, populated from the already-loaded `member.photo_file_id` in both the normal and trial success returns. Reception needed no change (its `member` already carried `photoFileId`).

**Frontend rendering**:
- `src/pages/checkin-page.tsx` — `SuccessPanel` shows an `<img>` (or `Avatar` fallback).
- `src/pages/reception-page.tsx` — `StatusPanel` shows the photo (or icon fallback); `SearchRow` shows a thumbnail (or `CircleUserRound`).

**Camera capture** — NEW `src/components/ui/camera-capture.tsx` modal (`getUserMedia` → `<video>` preview → draw-to-`<canvas>` → `File` → standard upload+set flow). Wired into `src/pages/member-profile/header.tsx`: a camera button + the file-pick button, both via shared `applyPhotoFile(file)`. Gated by `members.edit`. Graceful Arabic fallback errors when camera unavailable/denied.

**i18n** — `members.formPhotoCamera`, `members.cameraTitle`, `members.cameraCapture`, `members.cameraDenied`, `members.cameraUnavailable`.

**Secure-context note:** camera works because the app opens on `http://127.0.0.1:8890`. Over plain-HTTP LAN IP (`http://192.168.x.x`) the browser blocks `getUserMedia`; the error message points the operator to file upload.

## Verification (this session)

- `npm test` — **424/424** pass in 33 files.
- `npm run typecheck` — clean; `npm run typecheck:server` — clean.
- `npm run build` — OK (pre-existing seed.ts `import.meta` CJS esbuild warning is non-fatal).
- `node scripts/check-rpc-consistency.cjs` — ok (273 registry entries, no missing).
- `npx vitest run tests/i18n-coverage.test.ts` — 3/3 pass.

## Files changed (TASK-018)

- `src/core/services/attendance.service.ts` — `CheckInResult.photoFileId` (type + both success returns).
- `src/pages/checkin-page.tsx` — photo in `SuccessPanel` (+ `Avatar` import; dropped unused `CheckCircle2`).
- `src/pages/reception-page.tsx` — photo in `StatusPanel` + `SearchRow`.
- `src/components/ui/camera-capture.tsx` — NEW webcam capture modal.
- `src/pages/member-profile/header.tsx` — camera button + modal + shared `applyPhotoFile`; image-pick button.
- `src/i18n/ar.ts` — 5 camera/photo keys.

## Database changes

- None (photo storage/column/RPC already existed).

## Known issues / follow-ups

- Browser camera capture is NOT live-tested this session (needs a real webcam session).
- If the app is ever accessed over plain-HTTP LAN IP, webcam capture is blocked by the browser (secure-context restriction); file upload still works.

## Blockers

- None.
