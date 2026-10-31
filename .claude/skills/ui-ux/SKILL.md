---
name: ui-ux
description: Use when designing or building any screen or component in apps/mobile. Covers the caregiver-app design system (tokens for color, type, spacing), status colors with icon+word, accessibility rules for older, non-technical users, empty/loading/error states, plain wording, and the per-screen review checklist.
---

# UI/UX design system: caregiver app

## Who we design for
Caregivers, often family members who are not technical, and some of them older. They glance at the app when worried. Every screen must answer "is Lola OK?" in 2 seconds.

## Hard rules
- **Text:** body ≥ 16 pt. Use `<AppText>` only, never raw `<Text>`. Font scaling stays on (`allowFontScaling` default). Layouts must survive 200% scale (wrap, never truncate key info).
- **Touch targets:** ≥ 48×48 dp (`minHeight: 48`, `hitSlop` for icons).
- **Contrast:** WCAG AA (4.5:1 text, 3:1 large text and icons) in **both** themes. Tokens are pre-checked; do not invent colors.
- **Color is never the only signal:** status = icon + word (+ color). Use `<StatusBadge status="missed" />`.
- **Every interactive element** has `accessibilityRole` and an `accessibilityLabel` when its text is not self-explanatory.

## Status tokens (`src/theme/tokens.ts`)
| status | word | icon (Ionicons) | light fg / bg | dark fg / bg |
|---|---|---|---|---|
| taken | Taken | `checkmark-circle` | `#1B6E2D` / `#E3F4E6` | `#7DDB8F` / `#12321A` |
| late | Taken late | `time` | `#1B6E2D` / `#E3F4E6` | `#7DDB8F` / `#12321A` |
| due | Due now | `alarm` | `#8A5300` / `#FFF1D6` | `#FFC766` / `#3A2A06` |
| upcoming | Upcoming | `ellipse-outline` | `#3D4451` / `#EEF0F3` | `#C5CAD3` / `#262A31` |
| missed | Missed | `close-circle` | `#B3261E` / `#FDE7E5` | `#FF8A80` / `#3B1412` |
| expired | Expired | `warning` | `#7B1FA2` / `#F3E5F7` | `#E1A6F0` / `#33163D` |
| lowStock | Low stock | `cube` | `#A04500` / `#FFE9D9` | `#FFB27A` / `#3A2210` |
| online / offline | Online / Offline | `wifi` / `cloud-offline` | taken / missed colors |  |

## Base tokens
- **Spacing (dp):** `xs 4, sm 8, md 12, lg 16, xl 24, xxl 32`. Screen gutter = `lg`; gap between cards = `md`.
- **Type scale (pt, lineHeight):** `caption 14/20` (metadata only), `body 17/24`, `bodyStrong 17/24 600`, `title 20/28 600`, `headline 24/32 700`, `display 32/40 700`.
- **Radius:** `sm 10, md 14, lg 20, xl 28, pill`. Buttons, chips and badges are pills; cards use `lg`.
- **Elevation:** `<Card>` has a soft shadow in light mode and a 1 px border in dark mode (shadows vanish on dark). `tone="tinted"` (primarySoft) highlights one thing per screen, such as "Next dose".
- **Neutral colors:** `bg, surface, surfaceAlt, border, text, textMuted, primary, primarySoft, onPrimary, accent, accentSoft, danger, focus, shadow` (light + dark in `tokens.ts`). Primary = `#2E4FD8` light / `#9FB2FF` dark. Every pair is checked by `__tests__/contrast.test.ts`.
- **Brand:** the app and the device are both **VOICE**. `<Brand>` (sign-in/sign-up) shows the app icon. Icons are drawn by `tools/icons/make_icons.py` (speech bubble + capsule on primary blue); re-run it to change them.
- **Decor:** `IconCircle` (icon on a soft tinted square, decorative), `Avatar` (initials), `SectionHeader`. Home leads with a greeting; patient screens lead with "Next up", then doses grouped Morning / Afternoon / Evening.
- **Themes:** follow the system (`useColorScheme`), with an override in Settings (System/Light/Dark).

## Components (`src/components/`)
`Screen` (safe area + scroll + pull-to-refresh), `AppText`, `Button` (primary/secondary/danger, loading state, full width), `IconButton`, `TextField` (label above, helper, error below, never placeholder-only), `NumberField`, `DateField`, `TimeField`, `Select`/`SegmentedControl`, `Switch` row, `Card`, `ListItem`, `StatusBadge`, `ProgressRing`/`ProgressBar` (with a "3 of 5 taken" text), `EmptyState`, `ErrorState`, `Skeleton`, `Banner` (offline/expired warnings), `ConfirmDialog`.

## States (every data screen has all four)
1. **Loading:** `Skeleton` shapes that match the final layout. No bare spinners for full screens.
2. **Empty:** an icon + a one-line explanation + one primary action ("No medicines yet. Add the first one.").
3. **Error:** `ErrorState` with a plain message ("We couldn't reach the VOICE server.") + a **Try again** button that calls `refetch()`.
4. **Content:** with pull-to-refresh.
Offline API (network error) shows a top `Banner`, and cached data stays visible.

## Language
- **Plain words:** "VOICE" (the device is never called "pillbox" in the UI), "Medicine", "Taken", "Missed", "Running low". Never "event", "payload", "sync", or "device id" (say "VOICE code"). The firmware's fixed id `pillbox` is data, not a name.
- **Sentence case.** Times are shown in the caregiver's 12-hour format with AM/PM ("8:00 AM"), relative where helpful ("12 min late").
- **Errors** say what happened and what to do: "That code has expired. Ask for a new one."
- **Destructive actions** use a `ConfirmDialog` that names the thing: "Delete Losartan 50mg?"

## Forms that are hard to get wrong
- Labels always visible. Units next to the field ("tablets"). Sensible defaults (dose 1, low stock 5, refill 3 days).
- Pickers for dates, times, slots (1–5 buttons that show which slots are used). No free typing of dates.
- Validate on blur and on submit with zod. Show errors under the field and focus the first one with an error.
- The submit button shows loading and is disabled while submitting. Never lose typed data on an error.

## Screen review checklist (run on every screen, Milestone 7)
- [ ] Body text ≥16 pt; works at 200% font scale with no clipped key info
- [ ] All targets ≥48 dp; icon buttons have labels
- [ ] Status always shows icon + word
- [ ] Contrast checked in light and dark
- [ ] Loading skeleton, empty state, and error with retry all present
- [ ] Screen reader order makes sense; headers have `accessibilityRole="header"`
- [ ] Plain wording; no jargon or ids shown
- [ ] Destructive actions confirmed; forms keep data on error
- [ ] Realtime updates do not jump the scroll position
