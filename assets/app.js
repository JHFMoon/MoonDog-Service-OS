(function () {
  "use strict";
  const writeAuthority = globalThis.MoonDogWriteAuthority;
  if (!writeAuthority) throw new Error("Workspace write guard is unavailable.");
  const authorityDot = document.getElementById("writeAuthorityDot");
  function renderWriteAuthority() { if (!authorityDot) return; authorityDot.dataset.editable = String(writeAuthority.canWrite); authorityDot.title = authorityDot.ariaLabel = writeAuthority.canWrite ? "Workspace writable" : "Folder permission required"; }
  globalThis.addEventListener("moondog-write-authority", renderWriteAuthority);
  renderWriteAuthority();
  const responsiveRefinements = document.createElement("style"); responsiveRefinements.textContent = `.performance-svg{display:block;width:100%;height:auto;aspect-ratio:760/260}.meeting-cycle-label{display:block;margin-top:1px;font-size:11px;line-height:1.1;letter-spacing:.12em;color:#76d7b2}.meeting-cycle-delta{display:block;font-style:normal;font-size:10px;line-height:1.1;letter-spacing:.04em;color:#b9ced6}.meeting-v3-nps .meeting-cycle-delta{font-size:11px;margin-top:3px}.trend-coverage-summary{margin-top:14px;padding-top:12px;border-top:1px solid #d6e2e7}.trend-coverage-summary>strong{display:block;margin-bottom:7px}.trend-coverage-grid{display:flex;flex-wrap:wrap;gap:7px}.trend-coverage-grid span{padding:6px 9px;border-radius:8px;background:#eef5f7;font-size:12px}.previous-month-totals{margin-top:18px}.previous-month-totals .month-total-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:8px;margin:12px 0}.previous-month-totals .month-total-grid div,.previous-month-totals .month-advisor-row{padding:10px;border-radius:9px;background:#f3f7f8}.previous-month-totals .month-total-grid span,.previous-month-totals .month-advisor-row span{display:block;font-size:11px;color:#59717a}.previous-month-totals .month-total-grid strong{font-size:18px}.month-advisor-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.month-advisor-row strong{display:block;margin-bottom:5px}.month-advisor-metrics{font-size:12px;line-height:1.5}`; document.head.append(responsiveRefinements);
  const correctionStyles=document.createElement("style");correctionStyles.textContent=".month-correction-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0;padding:10px 12px;border:1px solid #dfbd69;border-radius:9px;background:#fff8e5;color:#6b5316}.month-correction-notice button{white-space:nowrap}.voice-mode-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.customer-voice-manager [hidden]{display:none!important}.voice-use-full{align-self:flex-start}@media(max-width:760px){.voice-mode-grid{grid-template-columns:1fr}}";document.head.append(correctionStyles);
  // Runtime packages are generated only after trusted proof gates pass.\n  const VERSION = "0.10.17";
  globalThis.MoonDogInstalledVersion = VERSION;
  const BUILD_DATE = "2026-10-07";
  const DB_NAME = "moondog-operations-local";
  const HANDLE_KEY = "working-folder";
  const STATE_PATH = ["data", "current-state.json"];
  const SETTINGS_PATH = ["data", "settings.json"];
  const SOURCE_ADAPTER_BOOTSTRAP_PATH = ["data", "source-adapter-bootstrap.json"];
  const APPOINTMENTS_PATH = ["data", "appointments.json"];
  const PERFORMANCE_PATH = ["data", "advisor-performance.json"];