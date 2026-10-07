# Operating intelligence: local sources, daily priorities, and meeting cards

This is an offline-first feature set. It is not a cloud service, a report publisher, a
live integration with DealerCentral, or an automatic source-data generator.

## Home: data first, then work

The compact **Data needed** strip is shown only when the existing source-freshness
rules identify a useful missing or stale source. It shows the source/report,
represented date when known, a short reason, and where to obtain it.
**Update** opens the local file picker. **Not now** records a protected
deferral without claiming the missing data was received. A successful validated
import clears the relevant source request. Source locations can be corrected
under Tools → Import or refresh data, and that correction is saved locally.

Home then presents one primary task plus at most four short next priorities.
Related tasks for the same RO are grouped. Closed ROs no longer produce live RO
follow-ups. There is no extra “Wins Today” task feed and no extra manager cleanup
step after a source-backed issue resolves.

## How cadence learns

Accepted import observations, successful Update choices, and Not now choices
are stored with the existing **protected settings** under:

`System Files/Workspace/data/settings.json → future.refreshCadence`

No report content, customer identity, VIN, or store-specific metric is written
into this learned-cadence summary. The record keeps a short rolling history
of the source and observations to learn typical import times after at least
four separate source-date observations. A single late import does not
immediately change the expected time. Not now briefly defers a reminder
but does not mark the data as complete. Safety-critical current Open RO
evidence is not suppressed solely because a refresh was deferred.

Public GitHub updates cannot overwrite this record. It is covered by the
existing settings backup/recovery flow. The public code contains only generic
source labels, safe example locations, and reusable logic.

## Comparison integrity

- SAPR is authoritative for reported days worked/working days.
- An in-progress SAPR covering today's operating day uses that day as
  **half completed** for pacing, with the original reported count preserved.
- Prior-year SAPR must be selected by the **closest verified working-day count**,
  not simply by matching calendar dates.
- Comparisons more than one working day apart are not automatically treated
  as equivalent; the app can suggest an approximate prior-year SAPR pull
  and marks that date as an estimate until the real report is verified.
- All unavailable data remain unknown, not zero.
- Existing source parser validation and authority checks are retained.

## Advisor Meeting: one slide at a time

The Meeting view uses one Store card, then one full advisor card at a time,
in alphabetical name order. The cards repeat every 30 seconds by default.
The setting under **Advisor Meeting → TV meeting cards** allows 10–120 seconds
per card and Auto, 16:9, or 9:16 layout. Auto responds to screen orientation.
Cards are recomposed; they are not a miniature copy of the six-lane scoreboard.

The TV presenter **reads existing meeting data**; it does not keep independent
statistics. Store customer voice appears on the Store slide, not individual
advisor slides. Pause, Next, Full screen, and Show overview remain available.

## One-update compatibility

The installed 0.10.9+ updater has a deliberately fixed application-file
allowlist. New generic modules live in `src/`, but are embedded in the
existing approved runtime files by
`python3 scripts/build_operating_modules.py`. Do not make the updater
write unapproved application paths or anything under protected Workspace.
The publication workflow verifies that generated runtime matches the source.

## What this does not claim

It does not fetch new reports without your providing them or the existing
folder watch receiving them. A generic source may cover several metrics,
but the UI must not infer coverage, import success, or source agreement from
a filename alone. Current parser and validation rules determine coverage,
and stronger verified evidence cannot be replaced by a guess.
