/* Browser-only preference. Never persists MoonDog operational information. */
(function (root) {
  "use strict";
  const KEY = "moondog-device-start-view-v1";
  const ALLOWED = Object.freeze(["home", "open-ro", "arrivals", "performance", "assign-next"]);
  const allowed = value => ALLOWED.includes(value);
  function readLanding() {
    try {
      const value = root.localStorage?.getItem(KEY);
      return allowed(value) ? value : "home";
    } catch (_) { return "home"; }
  }
  function writeLanding(view) {
    if (!allowed(view)) return false;
    try {
      const store = root.localStorage;
      if (!store || typeof store.setItem !== "function" || typeof store.removeItem !== "function") return false;
      if (view === "home") store.removeItem(KEY);
      else store.setItem(KEY, view);
      return true;
    } catch (_) { return false; }
  }
  const api = Object.freeze({ readLanding, writeLanding, allowedViews: ALLOWED });
  root.MoonDogDevicePreferences = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
