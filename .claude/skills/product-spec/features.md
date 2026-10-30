# Features: acceptance criteria

Each criterion is testable. "AC" items marked (API) are covered by pytest; (UI) by Jest/RNTL or a manual check.

## 1. Account
- AC1 (API) `POST /api/v1/auth/signup {email, password>=8, name}` creates a caregiver and returns access + refresh tokens. A duplicate email returns 409 `email_taken`.
- AC2 (API) `POST /auth/login` with a wrong password returns 401 `invalid_credentials`, and the message does not say which field was wrong.
- AC3 (API) `POST /auth/refresh` rotates the refresh token. The old one is then rejected.
- AC4 (UI) The tokens are stored in expo-secure-store. Reopening the app goes straight to the dashboard.
- AC5 (UI) Sign out clears the tokens and the query cache, and unregisters the push token.

## 2. Patients and sharing
- AC1 (API) Creating a patient makes the creator its `owner`.
- AC2 (API) `POST /patients/{id}/invites` returns a 6-character code (no 0/O/1/I) that is valid for 7 days and can be used once.
- AC3 (API) `POST /invites/accept {code}` adds the caregiver as a `member`. An expired or used code returns 400 `invite_invalid`.
- AC4 (API) A caregiver who is not linked to a patient gets 404 for all of that patient's resources (no existence leak).

## 3. Device
- AC1 (API) `POST /patients/{id}/device {deviceId}` registers `deviceId` and `cameraId` (default `<deviceId>-cam`). An id already paired elsewhere returns 409.
- AC2 (API) `GET /patients/{id}/device` returns `status` online if `last_seen` is within 3 min, plus `lastSeen` and `slots[1..5]` with `{slot, medicineName|null, lidOpen|null, lastEventAt}`.
- AC3 (UI) Offline shows a red "Offline" badge with an icon and "Last seen 12 min ago".

## 4. Medicines
- AC1 (API) Required: name, doseAmount (int ≥1, default 1), qty (≥0). Optional: strength, form, doseUnit, instructions (≤200), slot (1–5, unique per patient among active medicines), barcode (digits 8–14 or free text ≤64), expiryDate, lowStockThreshold (default 5), refillLeadDays (default 3).
- AC2 (API) A slot already taken returns 409 `slot_taken`.
- AC3 (API) Reference photos: `POST /medicines/{id}/photos` (multipart, `angle` = front|back|side), JPEG/PNG ≤ 8 MB. Stores the embedding. Max 12 per medicine.
- AC4 (UI) A barcode can be scanned with the phone camera (EAN-13/EAN-8/UPC/Code128/QR) or typed.
- AC5 (UI) Expiry is chosen with a date picker, never typed free-form.

## 5. Schedules
- AC1 (API) CRUD `/medicines/{id}/schedules {time "HH:MM", daysOfWeek [0..6] (Mon=0), active}`. The schedule id is the device dose id.
- AC2 (API) `GET /api/schedule` lists only active schedules of active, slotted medicines of the device's patient whose daysOfWeek include today (PH), sorted by time then slot, at most 20.
- AC3 (API) Editing a time keeps the same id.

## 6. Today
- AC1 (API) `GET /patients/{id}/today` returns every dose of today with status upcoming/due/taken/late/missed/expired, `takenAt`, `delayMinutes`.
- AC2 (UI) A `taken` event shows up on screen within 2 s through WebSocket, with no pull-to-refresh needed.

## 7. History
- AC1 (API) `GET /patients/{id}/history?from&to` (max 92 days) returns per-day rows, per-medicine totals, and adherence %.
- AC2 (UI) The range picker has quick chips: 7 days, 30 days, custom.

## 8. Alerts
- AC1 (API) Each rule produces at most one alert per dedup key per caregiver (see **notifications-jobs**).
- AC2 (API) `GET /alerts` lists newest first and is paginated. `POST /alerts/{id}/read` and `/alerts/read-all` mark alerts read.
- AC3 A `missed` event produces an inbox entry and a WebSocket message in under 2 s, and push within 5 s when a token exists.
- AC4 Preferences turn each type on or off. `taken` is off by default.

## 9. Scans
- AC1 (API) Every scan is saved with its image, result JSON, method, score and duration, and kept for 30 days.
- AC2 (API) `POST /scans/{id}/correct {medicineId|null}` sets the corrected medicine and adds the image as a reference photo (`angle=correction`).
- AC3 (UI) The list shows a thumbnail, the result word + icon, the medicine, and the time.

## 10. Dashboard
- AC1 (API) `GET /dashboard` returns one card per patient: takenToday/totalToday, nextDose, unreadAlerts, lowStock[], expiringSoon[] (≤30 days), device status.

## 11. Settings
- AC1 (API) `PATCH /me` changes name, timezone (an IANA zone), and notification prefs.
- AC2 (API) `DELETE /me` deletes the caregiver and orphaned patients with all their data and files. Returns 204.
