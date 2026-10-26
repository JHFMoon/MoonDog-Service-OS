# MoonDog 30-Second UX Standard

Status: Beta rollout in measured increments; not a Stable-release authorization.

## Outcome, for every screen

Within 30 seconds a manager can **find** the needed information, **understand** its meaning and freshness, and **act** using the next accessible control. The primary hierarchy is: what is happening, what needs attention, and what action comes next. Prioritize CSI, comebacks, inspections, gross, and CP sales when operational urgency is comparable.

## Non-negotiable responsive behavior

- No horizontal page scrolling at any supported viewport; no removing columns, metrics, or actions to achieve that. Use fluid grids, labeled record cards, wrapping, and vertical continuation.
- Vertical scrolling is allowed on manager screens and portrait displays. Present the next action before supporting details; do not bury it behind unrelated summary cards.
- On the rotating Advisor Meeting, **1920×1080 at 16:9** is the primary TV canvas and should be readable without scrolling; portrait layouts may continue vertically while preserving content.
- Never use `overflow-x:hidden`, `display:none`, ellipses, or reduced font size to conceal meaningful information. Visibility may change only when the same content is available in another clear, immediately accessible presentation.
- Keep original values, underlying data, accuracy gates, freshness labels, editor controls, keyboard access, import/export, print and updater behavior. This is a presentation-only initiative.
- Long names, vehicle descriptions, amounts, source statuses and next actions must wrap rather than be clipped. Unknown data remains unknown; visual polish cannot imply verified numbers.
- Preserve accessible focus outlines, semantic labels, touch-size controls, and reduced-motion support.

## Responsive acceptance matrix

At minimum inspect **320×568**, **390×844**, **768×1024**, **900×1600** (portrait), **1080×1920** (9:16), **1280×720**, **1366×768**, **1600×900**, **1920×1080**, and **2560×1440**. Exercise 125% and 150% browser zoom on representative landscape and portrait layouts. Check navigation, Home/Manager Attention, Open RO Control, Arrivals, Assign Next, Advisor Performance, Tools, Imports, Settings and the Meeting screen, including empty, stale, long text and high-count states.

Passing means: no unintended horizontal overflow, no clipped or inaccessible source field, controls still actionable, clear reading order, all important states remain visible, and the user can locate the relevant action within 30 seconds in a realistic task. A static CSS check alone does **not** prove full-device compatibility.

## Rollout and proof

1. **Foundation:** documented contract; preserve Source in narrow Open RO cards; reflow advisor comparison and arrival cards; remove task-text truncation. Verify existing publication and clean-install checks.
2. **TV presenter:** expand synthetic browser proof to portrait, short/long labels, 16:9 at 1080p, and zoom-equivalent widths; correct measured clipping without hiding information.
3. **Remaining screens:** inspect and repair narrow/zoom overflow in Home, Tools, Assign Next, Imports/Exports and Settings; run route and keyboard checks.
4. **Sustain:** run the viewport regression matrix in CI, track measured exceptions, and perform the 30-second find/understand/act task review before a Beta is recommended for Stable. The clean-install artifact now includes a measured synthetic Open RO search/edit/note/save/read-back task (duration, clicks, field entries, scroll distance and failed-sample rate on 2,100 records); this covers that task only and does not complete the full viewport, zoom, accessibility or screen matrix.

Do not claim Stage 2–4 complete until their browser evidence exists. Do not promote Stable without James's explicit approval. No dealership operational data may be used in public test fixtures.
