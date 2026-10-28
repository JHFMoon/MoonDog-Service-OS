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
4. **Sustain:** run the viewport regression matrix in CI, track measured exceptions, and perform the 30-second find/understand/act task review before a Beta is recommended for Stable. PRs #550 and #551 expanded the Clean Install Proof artifact: synthetic file:// testing covers ten routes across ten documented viewports, CSS zoom-equivalent widths, text contrast, labeled controls, keyboard focus, unclipped long RO fields, the nine-run Open RO save/read-back task and six additional nine-run task journeys, with duration/clicks/field entries/scroll/error evidence. This is browser-automated evidence, not physical-device/native-zoom/OneDrive verification. The broader original issue #60 cold/warm start, reconnect, interrupted-save end-to-end effort, remaining source-confidence, navigation/Settings and update-feedback requirements remain open in the authoritative matrix.

Do not claim Stage 2–4 complete until their browser evidence exists. Do not promote Stable without James's explicit approval. No dealership operational data may be used in public test fixtures.

## Synthetic interrupted-save and reconnect task proof (current Beta engineering gate)

The independent, protected Clean Install Proof addition in PR #566 exercises the actual packaged Chromium Open RO editor and working-folder control with a memory-only File System Access-compatible folder. One backup write is deliberately rejected before the operational state can be committed. The test requires the previous RO state to remain durable, the unsaved draft to remain editable, a later retry to read back the intended manager update, and a subsequent folder reconnection to restore that update without losing its source identity. It measures nine attempts with elapsed milliseconds, actual UI clicks and field entries, scroll distance, expected-fault count, read-back success and browser errors, reporting p50/p95 in the browser proof artifact. Its synthetic fixtures never connect to a real Workspace. This is *conditional verification*: the evidence exists only after the exact-head protected Clean Install Proof and separately reviewed bootstrap merge pass.

The full engineering acceptance can then use both these recovery measurements and the pre-existing route/viewport, keyboard, long text, Meeting and normal Open RO task proofs. Physical Windows Edge, native zoom and real OneDrive latency remain optional follow-up and are not claimed as tested.
