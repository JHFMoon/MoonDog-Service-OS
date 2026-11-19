"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "assets/styles.css"), "utf8");
const app = fs.readFileSync(path.join(root, "assets/app.js"), "utf8");

test("returning Home cannot erase its visible page title through icon-only navigation", () => {
  const home = html.match(/<button\b([^>]*\bdata-view="home"[^>]*)>([\s\S]*?)<\/button>/);
  assert.ok(home, "Home navigation button exists");
  assert.match(home[1], /\baria-label="Home"/);
  assert.match(home[1], /\baria-current="page"/);
  assert.match(home[2], /<svg\b[\s\S]*?<\/svg>/);
  assert.match(home[2], /<span class="sr-only">Home<\/span>/);
  const name = home[2].replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").trim();
  assert.equal(name, "Home", "Production navigateTo reads button.textContent for page title");
  assert.match(app, /ui\.pageTitle\.textContent=button\.textContent;/);
  assert.match(app, /button\.setAttribute\("aria-current","page"\)/);
  assert.match(styles, /\.sr-only\s*\{[^}]*position:absolute!important;[^}]*width:1px!important;/);
});

test("page change announces meaningful heading and status remains accessible", () => {
  assert.match(html, /<h1 id="pageTitle" aria-live="polite" aria-atomic="true">Home<\/h1>/);
  assert.match(html, /id="status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(styles, /:focus-visible/);
});

test("novice folder help uses native disclosure, exact known layout, and safe guidance", () => {
  assert.match(html, /<details class="connection-help" id="connectionHelp">/);
  assert.match(html, /<summary>First time here\? Find the right MoonDog folder<\/summary>/);
  assert.match(html, /00 - OPEN DASHBOARD\.html/);
  assert.match(html, /System Files/);
  assert.match(html, /Do not select or replace/);
  assert.match(html, /Workspace/);
  assert.match(html, /href="https:\/\/jhfmoon\.github\.io\/MoonDog-Service-OS\/"/);
  assert.match(html, /internet required/);
  assert.match(styles, /\.connection-help summary\{[^}]*min-height:46px/);
  assert.doesNotMatch(html, /<script[^>]*>[\s\S]*?\.createWritable\(/);
});

test("all three primary report selectors have a specific accessible label", () => {
  const labels = {
    performanceSourceSelect: /Service Advisor Performance report/,
    appointmentSource: /today’s appointment report/,
    sourceSelect: /Open RO workbook/
  };
  for (const [id, description] of Object.entries(labels)) {
    const match = html.match(new RegExp("<select\\b([^>]*\\bid=\"" + id + "\"[^>]*)>"));
    assert.ok(match, "Required selector exists: " + id);
    assert.match(match[1], /\baria-label="[^"]+"/);
    assert.match(match[1], description);
    assert.match(match[1], /\bdisabled\b/, "A report cannot be imported before connection");
  }
});
