---
name: medicine-vision
description: Use when working on the package scan pipeline in services/api/src/vision (the Gemini call, the checks in code, fuzzy name matching), its 10-second time budget, thresholds, reference photos, or evaluating accuracy with make eval-vision.
---

# Medicine vision pipeline (Gemini free tier)

## Goal
Identify which of **this box's registered medicines** is in a 1024x768 JPEG of the package, and answer `POST /api/scan` in **under 10 s** (the camera gives up at 15 s). If unsure, answer `{"found":false}`: a wrong "identified" is worse than "not found". Never a 5xx to the camera.

## Flow (`src/vision/pipeline.ts`, called by `scanService.scan`)
1. **Gemini call** (`gemini.ts`, `@google/genai`, model `GEMINI_MODEL`, key `GEMINI_API_KEY`): send the JPEG inline (base64) plus the box's medicines as JSON (`id, name, strength, barcode`, nothing about the patient). `responseMimeType: "application/json"` with a response schema: `{ medicineId | null, readName, readStrength, readExpiry | null, confidence 0-1 }`. The system prompt says: answer `null` when unsure, never guess.
2. **Decide in code, not in the model:**
   - `medicineId` must be one of this box's medicines **and** `confidence >= SCAN_MIN_CONFIDENCE` (0.7) → match, `method="llm"`, `score=confidence`.
   - `medicineId` is `null` → fuzzy match `readName` + `readStrength` against the registered names (`match.ts`, `fastest-levenshtein`): name similarity >= `SCAN_FUZZY_THRESHOLD` (0.8), a different known strength rules a candidate out, and the winner must lead the runner-up by 0.1 → `method="ocr"`.
   - Anything else (unknown id, low confidence) → not found.
3. **The answer comes from MySQL** (`scanAnswer`): `name, dose, instructions, expiry, slot, qty, low, expired` are read from the matched medicine's row and cut to the camera limits (31 / 19 / 63). Nothing the model read is echoed. `readExpiry` is stored on the scan (`scans.read_expiry`, shown in the app as `ocrExpiry`) as information only.
4. **Failures** (timeout, 429, missing key, bad reply, anything) → `{"found":false}` and a logged reason (`no_key | timeout | rate_limited | bad_response | error | busy | local_rate_limit | low_confidence | no_match`). The scan photo and result are still saved.

## Add a medicine by scanning it ("learn")
`POST /patients/:id/scans/learn` sets a Redis flag `scan:learn:<patient>` for 3 minutes. The next scan from that person's VOICE then calls Gemini even with no registered medicines (`identify(..., { learn: true })`), stores what it read in `scans.read_name / read_strength / read_expiry`, files the scan under that person, skips the unknown-package alert, and clears the flag. The box still gets `{"found":false}`. The app (`VoiceScanSheet`) polls the newest scan and fills the add-medicine form.

## Reading first, a labelled guess second
The prompt asks Gemini to read the printed text first (`source: "printed"`). Only when the name is unreadable may it recognise a well-known product by packaging (`source: "appearance"`), never above 0.9 confidence and never inventing a name. In code (`pipeline.ts`): a registered medicine matched by look needs `SCAN_MIN_CONFIDENCE_LOOKS` (0.9) instead of 0.7; a guessed name is never fuzzy-matched; `SCAN_GUESS_FROM_LOOKS=false` ignores guesses entirely. The scan row keeps `guessed`, and the app shows guesses as guesses ("check it carefully"). The same reader serves `POST /patients/:id/medicines/read-package` (phone photo, not stored).

## Suggestion for the box
A scan that matches nothing registered but where the AI read a name answers `{"found":false,"guess":"<name strength, max 31>","guessed":<bool>}` (`guessed` = from looks only). Every scan asks the AI, including boxes with no medicines yet. Nothing read = exactly `{"found":false}`.

## Budget and limits
- `AbortController` aborts the Gemini call at `GEMINI_TIMEOUT_MS` (8000), never later than the budget; a backstop `Promise.race` against `SCAN_BUDGET_SECONDS` (9) covers a client that ignores the signal. The route's total stays under 10 s.
- **One scan at a time per box:** a Redis lock `scan:<device pk>` (15 s TTL). A second press meanwhile is answered `found:false` without calling Gemini (`reason=busy`).
- **Free-tier quota:** `GEMINI_MAX_PER_MINUTE` (10) counted in Redis; over it the scan answers `found:false` (`reason=local_rate_limit`) instead of collecting 429s. Real 429s are logged as `gemini_429`.
- **Privacy:** Google may use free-tier inputs to improve its products. The notice is in the app's Settings screen and in `docs/setup.md`. The key lives only in `.env` (server). Never in the app, the firmware or git.

## Reference photos
Taken in the app (medicine → Photos) or created by correcting a scan; stored under `SCAN_DIR/refs/` and shown in the app. They are sent to Gemini (max one per medicine, max 4 medicines, 512 px) only when `SCAN_USE_REFERENCES=true`, because they add upload time. Corrections (`POST /patients/:id/scans/:scanId/correct`) copy the scan photo in as `angle=correction`.

## Logging
One line per scan: `scan_done scanId method score reason ms_gemini ms_total`. No image content, no medicine names, no text the model read.

## Evaluating (`make eval-vision`)
```
services/api/tests/vision_samples/
  <medicine name exactly as seeded>/*.jpg   expected = that medicine
  none/*.jpg                                expected = not found
```
`scripts/eval-vision.ts` registers the three demo medicines in memory, sends each sample to the **real** Gemini model (one at a time, `EVAL_PAUSE_MS` apart to respect the free tier) and prints per-sample expected / got / method / confidence / ms, then accuracy, wrong-medicine count and p50/p95/max ms. Exit code 1 if accuracy < 0.8, any wrong medicine, or max ms > budget. Add real photos from the camera to the same folders. Needs `GEMINI_API_KEY`.

## Tuning
Change `SCAN_MIN_CONFIDENCE` / `SCAN_FUZZY_THRESHOLD` only with eval results in the commit message. Wrong matches must stay at 0.

## Tests (Gemini is always faked: `tests/helpers.ts` `FakeVision`)
- `tests/contract/scan.test.ts`: answer shape and values from the DB, flags, limits, 415/413/403, every failure mode → 200 `found:false`, a hanging client answered inside the budget, one-at-a-time, local quota, only this box's medicines sent.
- `tests/vision/scans.test.ts`: confidence boundary, backstop, fuzzy path, reference photos, correction, privacy.
- `tests/unit/vision.test.ts`: fuzzy rules and reply parsing.
