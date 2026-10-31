"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = source.indexOf("  let arrivalStatusWriteBusy = false;");
const end = source.indexOf("  function renderArrivals()", start);
assert.ok(start >= 0 && end > start, "production Arrivals status-save boundary exists");
const production = source.slice(start, end);
const day = "2026-10-31";
const clone = value => JSON.parse(JSON.stringify(value));

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(options = {}) {
  const initial = {
    updatedAt: "prior-revision",
    days: {
      [day]: {
        date: day,
        sourceFile: "synthetic-appointments.xlsx",
        appointments: [{
          id: "synthetic-appointment-1", guest: "Synthetic Guest",
          advisor: "Synthetic Advisor", time: "09:30",
          arrivalStatus: "Scheduled", statusUpdatedAt: null
        }]
      }
    }
  };
  const model = { appointments: clone(initial) };
  const events = [], writes = [], history = [], statuses = [];
  const ctx = vm.createContext({
    model, ui: { appointmentDate: { value: day } },
    APPOINTMENTS_PATH: ["data", "appointments.json"],
    stamp: () => "synthetic-stamp",
    now: () => "2026-10-31T16:00:00.000Z",
    structuredClone,
    writeJson: async (file, value) => {
      const name = Array.isArray(file) ? file.join("/") : String(file);
      events.push("write:" + name);
      writes.push({ name, value: clone(value) });
      if (options.onWrite) await options.onWrite(name, model);
    },
    addHistory: async (type, message, detail) => {
      events.push("history");
      history.push({ type, message, detail: clone(detail) });
    },
    renderArrivals: () => events.push("render"),
    status: (message, level) => statuses.push({ message, level })
  });
  vm.runInContext(production + "\nthis.saveArrival = updateArrivalStatus;", ctx);
  return { initial, model, ctx, events, writes, history, statuses };
}

test("backup refusal retains original Arrivals status and redraws the select", async () => {
  const h = harness({onWrite: async name => {
    if (name.startsWith("backups/")) throw Error("Synthetic backup permission denied");
  }});
  await assert.rejects(h.ctx.saveArrival("synthetic-appointment-1", "Arrived"), /backup permission denied/);
  assert.deepEqual(h.model.appointments, h.initial);
  assert.deepEqual(h.events, ["write:backups/synthetic-stamp-appointments-status.json", "render"]);
  assert.equal(h.history.length, 0);
  assert.equal(h.statuses.length, 0);
});

test("failed main write/readback never publishes unsaved Arrivals manager status", async () => {
  for (const failure of ["Synthetic write denied", "Synthetic read-back mismatch"]) {
    const h = harness({onWrite: async name => {
      if (name === "data/appointments.json") throw Error(failure);
    }});
    const oldReference = h.model.appointments;
    await assert.rejects(h.ctx.saveArrival("synthetic-appointment-1", "Arrived"), new RegExp(failure));
    assert.strictEqual(h.model.appointments, oldReference);
    assert.deepEqual(h.model.appointments, h.initial);
    assert.equal(h.writes[0].value.days[day].appointments[0].arrivalStatus, "Scheduled");
    assert.equal(h.writes[1].value.days[day].appointments[0].arrivalStatus, "Arrived");
    assert.equal(h.history.length, 0);
    assert.equal(h.events.at(-1), "render");
    assert.equal(h.statuses.length, 0);
  }
});

test("unverified pending main write cannot appear as an arrived appointment", async () => {
  const hold = deferred(), started = deferred();
  const h = harness({onWrite: async name => {
    if (name === "data/appointments.json") { started.resolve(); await hold.promise; }
  }});
  const original = h.model.appointments;
  const saving = h.ctx.saveArrival("synthetic-appointment-1", "Arrived");
  await started.promise;
  assert.strictEqual(h.model.appointments, original);
  assert.equal(h.model.appointments.days[day].appointments[0].arrivalStatus, "Scheduled");
  assert.equal(h.history.length, 0, "history must wait for verified persistence");
  hold.resolve();
  await saving;
  assert.notStrictEqual(h.model.appointments, original);
  assert.equal(h.model.appointments.days[day].appointments[0].arrivalStatus, "Arrived");
  assert.equal(h.model.appointments.days[day].appointments[0].statusUpdatedAt, "2026-10-31T16:00:00.000Z");
  assert.equal(h.history.length, 1);
  assert.equal(h.history[0].detail.before, "Scheduled");
  assert.equal(h.history[0].detail.after, "Arrived");
  assert.equal(h.statuses[0].level, "success");
  assert.deepEqual(original, h.initial, "verified save cannot mutate original source snapshot");
  assert.ok(h.events.indexOf("history") > h.events.indexOf("write:data/appointments.json"));
});

test("a competing completed import during backup refuses to overwrite changed source authority", async () => {
  const h = harness({onWrite: async name, model => {
    if (name.startsWith("backups/")) model.appointments = clone({
      updatedAt: "new-import-revision",
      days: { [day]: { date: day, appointments: [] } }
    });
  }});
  await assert.rejects(h.ctx.saveArrival("synthetic-appointment-1", "Arrived"), /Appointments changed while/);
  assert.equal(h.model.appointments.updatedAt, "new-import-revision");
  assert.equal(h.writes.some(write => write.name === "data/appointments.json"), false);
  assert.equal(h.history.length, 0);
});

test("unknown appointment id does not write, publish or add history", async () => {
  const h = harness();
  await h.ctx.saveArrival("synthetic-missing", "Arrived");
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.model.appointments, h.initial);
});


test("overlapping same-tab Arrivals status changes cannot overwrite one another", async () => {
  const gate = deferred(), started = deferred();
  const h = harness({onWrite: async name => {
    if (name === "data/appointments.json") { started.resolve(); await gate.promise; }
  }});
  const first = h.ctx.saveArrival("synthetic-appointment-1", "Arrived");
  await started.promise;
  await assert.rejects(
    h.ctx.saveArrival("synthetic-appointment-1", "No Show"),
    /Arrivals status save is already in progress/
  );
  assert.equal(h.model.appointments.days[day].appointments[0].arrivalStatus, "Scheduled");
  gate.resolve();
  await first;
  assert.equal(h.model.appointments.days[day].appointments[0].arrivalStatus, "Arrived");
  assert.equal(h.writes.filter(write => write.name === "data/appointments.json").length, 1);
});

test("failure releases same-tab save exclusion for a safe retry", async () => {
  let failed = false;
  const h = harness({onWrite: async name => {
    if (name === "data/appointments.json" && !failed) {
      failed = true;
      throw Error("Synthetic transient save lock");
    }
  }});
  await assert.rejects(h.ctx.saveArrival("synthetic-appointment-1", "Arrived"), /transient save lock/);
  assert.equal(h.model.appointments.days[day].appointments[0].arrivalStatus, "Scheduled");
  await h.ctx.saveArrival("synthetic-appointment-1", "Arrived");
  assert.equal(h.model.appointments.days[day].appointments[0].arrivalStatus, "Arrived");
  assert.equal(h.history.length, 1, "history only records the verified retry");
});
