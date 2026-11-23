---
name: product-spec
description: Use when you need to know what the product must do. Covers the users, the glossary (dose, slot, schedule, intake event, inventory, refill, caregiver, patient, device), and every caregiver-app feature with acceptance criteria. Load before building or changing any user-facing feature, or when unsure what a term means.
---

# Product spec: MIRA prototype

## Users
- **Caregiver:** a family member or helper who sets up the pillbox and is told when something goes wrong. Often not technical, sometimes older. Uses the mobile app.
- **Patient:** takes the medicine at home from the pillbox. Never uses the app. Interacts only with the pillbox (alarm, voice, lids, camera button).
- One caregiver can manage several patients. Several caregivers can share one patient (invite by code).

## Glossary (use these words exactly in code and UI)
| Term | Meaning |
|---|---|
| **Device** | A registered ESP32. `pillbox` (main board, 5 slots) + its camera `pillbox-cam`. Belongs to one patient. |
| **Slot** | One of the 5 compartments (1–5) in the pillbox, each with a lid switch. One medicine per slot. |
| **Medicine** | A drug a patient takes: name, strength, form, dose amount, instructions, slot, barcode, expiry, quantity, thresholds, reference photos. |
| **Schedule** | One daily dose time of one medicine (`08:00`). A medicine taken 3×/day has 3 schedules. Has days-of-week (stored; device repeats daily). |
| **Dose** | One schedule occurring on one day. Device `id` = schedule id. |
| **Intake event** | Something the device reported (`due`, `taken`, `missed`, ...). Stored raw in `device_events`, idempotent. |
| **Intake record** | The outcome of one dose on one date: `due` → `taken` (with delay) or `missed`. Basis for history and adherence. |
| **Inventory** | Current pill count (`qty`) of a medicine. Goes down by the dose amount on `taken`. |
| **Refill** | Topping up inventory. Reminder fires when `qty / daily usage ≤ refill lead time (days)`. |
| **Expired** | The medicine's expiry date (entered by the caregiver) is before today. |
| **Low stock** | `qty ≤ low-stock threshold`. |
| **Alert** | Push notification + in-app inbox entry for a caregiver. |
| **Scan** | A photo from the camera, identified against the patient's medicines. |

## Status words (UI and API enums)
Dose status: `upcoming`, `due`, `taken`, `late` (taken, more than 15 min after time), `missed`, `expired`.
Device status: `online` (seen within 3 min), `offline`.

## Features (summary; full acceptance criteria in [features.md](features.md))
1. **Account:** sign up / sign in, JWT session that survives app restarts, sign out.
2. **Patients and sharing:** create a patient, invite another caregiver with a 6-character code, join with the code.
3. **Device:** pair a pillbox by typing its id. Shows online/offline, last seen, and each slot's state.
4. **Medicines:** CRUD with barcode (camera or typed), expiry, quantity, low-stock threshold, refill lead time, and reference photos (front/back/side).
5. **Schedules:** several dose times per medicine, days of week stored. The device gets only today's active doses.
6. **Today:** a live timeline of today's doses with status, updated in realtime over WebSocket.
7. **History:** by day and by medicine (on time / late / missed), adherence %, date range filter.
8. **Alerts:** missed, taken (optional), low stock/refill, expiry (30/7/0 days + due while expired), pillbox offline > 10 min, unknown scan. Push + inbox.
9. **Scans:** list with photo, result, matched medicine. Correcting a scan adds the photo as a new reference image.
10. **Dashboard:** a card per patient with today's progress, next dose, active alerts, low stock, expiring soon, device status.
11. **Settings:** notification preferences, time zone (default Asia/Manila), profile, sign out, delete account and data.

## Business rules that are easy to get wrong
- **Adherence %** = taken (on time + late) ÷ (taken + missed) for the range. Upcoming and due doses are excluded. With no data, show "–", not 0%.
- **Late** = taken more than 15 min after the scheduled time (setting `LATE_AFTER_MINUTES`).
- **Daily usage** = dose amount × number of active schedules for the medicine.
- **Expired always wins:** a due dose for an expired medicine shows `expired`, and the device announces it.
- **Delete account:** removes the caregiver. A patient is deleted with all its data only when no other caregiver remains on it.
- **Demo seed:** one caregiver `demo@example.com` / `demo1234`, one patient "Lola Rosa", device `pillbox`, 3 medicines in slots 1–3 (one expired, one low).
