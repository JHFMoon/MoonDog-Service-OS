"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const html = readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const visible = (tag, id) => {
  const match = html.match(new RegExp('<' + tag + '[^>]*\\bid="' + id + '"[^>]*>([^<]*)</' + tag + '>'));
  assert.ok(match, "shipped index.html contains " + id);
  return match[1];
};

test("the shipped Arrivals and porter view distinguish an unverified schedule from a verified zero", () => {
  const before = {
    count: visible("p", "arrivalCount"),
    scheduled: visible("small", "printScheduled"),
    total: visible("strong", "arrivalTotal"),
    printTotal: visible("strong", "printAtGlance"),
  };
  assert.equal(before.count, "Today’s schedule not verified");
  assert.equal(before.scheduled, "Appointment source not verified");
  assert.equal(before.total, "—");
  assert.equal(before.printTotal, "—");

  const after = {
    importGuidance: html.includes("Import a verified Service Daily Log or PreRO to display today’s appointments."),
    sourceSelectionDisabled: /id="appointmentSource" disabled/.test(html),
    printDisabled: /id="printArrivals" class="primary" disabled/.test(html),
    editableArrivalTracking: /id="arrivalTimeline" class="arrival-timeline"/.test(html),
  };
  assert.equal(after.importGuidance, true);
  assert.equal(after.sourceSelectionDisabled, true, "initial unconnected import must stay disabled");
  assert.equal(after.printDisabled, true, "porter print must stay disabled before a verified source");
  assert.equal(after.editableArrivalTracking, true, "existing arrivals rendering target remains present");
});
