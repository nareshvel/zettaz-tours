# Safari Date Picker — Issue & Fix

**Date:** 2026-09-16  
**Affects:** All pages using `TenantDateInput` + finance-partners settlement dialog  
**Browsers confirmed broken:** Safari (all versions)  
**Browsers confirmed working after fix:** Safari, Chrome, Firefox

---

## The Problem

### Root Cause

Every date field in the app used a native `<input type="date">` under the hood. The visible field was a styled overlay (a `<span>` with the formatted date + a calendar icon), but clicking the field triggered the browser's built-in calendar popup.

**Chrome** renders a modern calendar popover — full-month grid, solid filled circle on the selected day, "Clear" and "Today" links, clean typography.

**Safari** renders its own legacy compact picker — a small inline widget with arrow navigation, no helper links, and completely different styling that cannot be controlled with CSS.

There is no CSS or HTML attribute that makes both browsers show the same thing. The only reliable cross-browser fix is a fully custom calendar component.

### Secondary Issue — Truncated Input Width

In compact toolbar contexts (e.g. Day Board, assignment planners), the date trigger field had no explicit `min-width`. On narrow viewports or when the date format produces a longer string (e.g. `16/09/2026`), the field clipped the text and the calendar icon.

### Third Issue — Raw `input[type=date]` in Finance Dialog

The "Generate settlement" dialog in `finance-partners.tsx` used bare `<input type="date">` elements outside of `TenantDateInput`, bypassing the fix entirely and leaving Safari users with the broken native picker.

---

## Files Changed

| File | Change |
|---|---|
| `apps/web/components/common.tsx` | Replaced native `<input type="date">` in `TenantDateInput` with custom `CalendarPicker` component; changed outer wrapper from `<label>` to `<div>`; stabilised `onClose` with `useCallback` |
| `apps/web/components/finance-partners.tsx` | Replaced raw `input[type=date]` fields in `GenerateDialog` with `TenantDateInput`; added `session` prop |
| `apps/web/app/globals.css` | Added custom calendar CSS (`.tdp-*`); added global `min-width: 140px` for compact date controls; added `min-width: 148px` override for the day-board toolbar |
| `apps/web/components/views.tsx` | Patched 2 filter outside-click handlers (departures + reservations) to ignore clicks inside `#tdp-popup` |
| `apps/web/components/administration.tsx` | Patched 1 filter outside-click handler |
| `apps/web/components/booking.tsx` | Patched 1 filter outside-click handler |
| `apps/web/components/catalog-assignments.tsx` | Patched 1 filter outside-click handler |
| `apps/web/components/catalog-schedules.tsx` | Patched 1 filter outside-click handler |
| `apps/web/components/dispatch.tsx` | Patched 1 filter outside-click handler |
| `apps/web/components/reports.tsx` | Patched 1 filter outside-click handler |

---

## The Fix

### 1. Custom `CalendarPicker` React Component (`common.tsx`)

`TenantDateInput` no longer renders a native `<input type="date">`. Instead:

- The trigger is a styled `<span>` (role="button") that opens a portal-based popup on click.
- The popup is a fully custom React calendar rendered into `document.body` via `createPortal`.
- Positioning uses `useLayoutEffect` (fires before paint — no flash) to measure the anchor's `getBoundingClientRect()`, then clamps the popup's left edge so it never overflows the right side of the viewport.
- The popup is `visibility: hidden` until positioned, preventing the top-left flash.
- Closing works on outside `mousedown` via a document-level listener.

**Calendar features:**
- Month/year header with ↑ ↓ navigation buttons
- Single-letter day-of-week columns (S M T W T F S)
- Solid filled circle (`--accent` teal) on the selected date
- Today highlighted in teal text when not selected
- `min` / `max` props disable out-of-range days
- **Clear** and **Today** action links in the footer
- Fully keyboard accessible (Enter / Space opens the trigger)

### 2. Global Compact-Control Min-Width (`globals.css`)

```css
/* Added globally — affects every compact toolbar date field */
.compact-control .tenant-date-input {
  min-width: 140px;
}

/* Day-board toolbar override — slightly wider for the full date + icon */
.board-trip-toolbar-controls .compact-control .tenant-date-input {
  min-width: 148px;
}
```

### 3. Finance Partners Settlement Dialog (`finance-partners.tsx`)

`GenerateDialog` now accepts a `session` prop and uses `TenantDateInput` for both "Period start" and "Period end" fields, making them consistent with the rest of the app and fixing the Safari rendering.

### 4. Filter Popovers — Outside-Click Guard (`views.tsx` and 7 other files)

Every filter popover uses a `document.addEventListener("mousedown", ...)` listener to detect outside clicks and close the popover. Because the calendar portal renders at `document.body` — outside the filter's `filterRef` DOM subtree — any click inside the calendar was incorrectly treated as an outside click, closing the popover before a date could be selected.

**Fix pattern applied to all 8 filter outside-click handlers:**

```js
// Before
!filterRef.current.contains(event.target as Node)

// After
!filterRef.current.contains(event.target as Node) &&
!document.getElementById("tdp-popup")?.contains(event.target as Node)
```

The `id="tdp-popup"` on the calendar portal div serves as a cross-component signal: any DOM element can test whether a click landed inside an open calendar without needing a shared ref or context.

---

## Regressions Introduced and Resolved

### ❌ Regression 1 — CSS broke on most date pickers after first pass

**Symptom:** Removing the native `<input type="date">` also removed the DOM node that all existing CSS rules targeted (`input` inside `.tenant-date-input` — border, height, background, padding, context overrides).

**Fix:** Added a structural dummy `<input type="text" readOnly>` with `pointer-events: none` so all existing CSS selectors continue to match without the element being interactive.

### ❌ Regression 2 — Calendar not appearing in filter popovers

**Symptom:** Clicking a date field inside a filter popover (departures, reservations, catalog, etc.) would immediately close the popover rather than showing the calendar.

**Cause:** The calendar portal renders at `document.body`, outside the filter popover's `filterRef`. The filter's outside-click `mousedown` listener saw any calendar click as "outside the filter" and closed the popover.

**Fix:** Added `&& !document.getElementById("tdp-popup")?.contains(event.target as Node)` guard to all 8 affected outside-click handlers. See section 4 above.

### ❌ Regression 3 — Calendar picker immediately closes on click (double-toggle)

**Symptom:** Clicking a date field appeared to do nothing — the calendar would flicker open and immediately close. Affected the Day Board picker after the filter outside-click patches were applied.

**Root Cause — HTML `<label>` native click-forwarding:**

The `TenantDateInput` wrapper was a `<label>` element. HTML labels have built-in browser behavior: when a click event bubbles *through* a label and the click target is not a natively labelable element (button, input, select, etc.), the browser immediately dispatches a second synthetic click at the label's associated control — in this case the dummy `<input>` inside the field.

This forwarding happens during the native DOM bubble phase, **before** React's delegated event system processes anything. So React's `e.preventDefault()` in the label's `onClick` handler fires too late — the label has already forwarded the click.

The forwarded click on the dummy input then bubbles back up through the span, hits React's delegated listener at the root, and triggers the span's `onClick` a second time, calling `setOpen` twice:

1. Original click → span `onClick` → `setOpen(false → true)` ✓ opens
2. Label-forwarded click on dummy → bubbles through span → span `onClick` → `setOpen(true → false)` ✗ immediately closes

Net result: calendar appears to not open at all.

**Fix:** Replaced `<label>` with `<div>` as the outer wrapper of `TenantDateInput`. The CSS classes (`.field`, `.compact-control`, `.tenant-date-control`) are all class-based — no CSS selects on the `label` element type — so the change is visually and functionally transparent. `<div>` has no native click-forwarding behavior, eliminating the double-toggle.

**Also added:** `useCallback` for the `onClose` handler passed to `CalendarPicker`, so the outside-click `useEffect` inside `CalendarPicker` does not re-register its document listener on every parent render.

```tsx
// Before — inline arrow recreated every render, causing useEffect to re-run
onClose={() => setOpen(false)}

// After — stable reference via useCallback
const handleClose = useCallback(() => setOpen(false), []);
// ...
onClose={handleClose}
```

**Key lesson: never use `<label>` as a layout wrapper around a custom interactive component.** Only use `<label>` when its native click-forwarding behaviour is intentional (i.e. when the associated control is a real native input that should receive focus/activation). For custom pickers, dialogs, or toggle buttons, use `<div>` or `<span>` with appropriate ARIA attributes (`role`, `aria-haspopup`, `aria-expanded`, `tabIndex`).

---

## Testing Checklist

- [x] Day Board — date field shows full date, calendar opens on click, selected date highlighted, Clear/Today work
- [x] Safari — calendar popup looks identical to Chrome
- [x] Filter popovers (departures, reservations, catalog, assignments) — calendar opens inside the popover without closing it
- [x] Finance → Partners → Generate settlement — Period start/end use the custom picker
- [x] Compact date fields in other toolbars (Reports, Catalog Assignments, Document Library, Catalog Schedules) — not truncated
- [ ] `min` / `max` constraints still respected (out-of-range days dimmed and unclickable)
- [ ] Keyboard: Tab to field, Enter/Space opens picker, Escape or outside click closes it
- [ ] Mobile Safari — popup clamped within viewport width

---

## Design Tokens Used

The calendar popup uses only existing CSS variables — no new colours introduced:

| Token | Usage |
|---|---|
| `--accent` | Selected day fill, action link colour |
| `--ink` | Day numbers, month label |
| `--muted` | Day-of-week headers, nav arrows |
| `--line` | Popup border, footer separator |
| `--bg` | Hover background on unselected days |
| `--soft` | Action link hover background |
