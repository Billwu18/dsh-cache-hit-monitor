import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";
// tests/ and src/ live side by side, so the bundle is one directory up.
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(dir, "client.js"), "utf8");

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (registration) => { captured = registration; } } };
new Function(source)();

if (captured === null) throw new Error("bundle did not register itself with __ModuleLoader__.load");
if (typeof captured.factory !== "function") throw new Error("registration has no factory");

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: () => [undefined, () => {}],
  useEffect: () => {},
};
const bundle = captured.factory((specifier) => {
  if (specifier === "react") return reactStub;
  throw new Error("unexpected module request: " + specifier);
});

const registrations = [];
const tabDefinitions = [];
const effects = [];
const t = (key) => "T:" + key;

const ctx = {
  effect: (fn, label) => { effects.push(label); return fn(); },
  get: () => undefined,
  locale: { register: () => () => {}, bind: () => t },
  inject: (deps, callback) => {
    const handle = callback({
      sidebarRightTabs: { register: (definition) => { tabDefinitions.push(definition); return () => {}; } },
      slots: {
        inject: (key, cb) => { registrations.push({ slot: key }); const result = cb(); return typeof result === "function" ? result : () => {}; },
        register: (options, component) => { registrations.push({ options, component }); return () => {}; },
      },
    });
    return { dispose: () => handle && handle() };
  },
};

bundle.apply(ctx);

const byName = {};
for (const entry of registrations) if (entry.options) byName[entry.options.name] = entry.options;
const body = registrations.find((r) => r.options && r.options.name === "sidebar.right.pane.tab");

console.log("module id          :", captured.id);
console.log("bundle.name        :", bundle.name);
console.log("inject             :", JSON.stringify(bundle.inject));
console.log("effects            :", JSON.stringify(effects));
console.log("tab type           :", tabDefinitions.map((d) => d.id + " / kind=" + d.kind + " / guide=" + d.guide.length + " / title=" + typeof d.title).join(", "));
console.log("declared seats     :", registrations.filter((r) => r.slot).map((r) => r.slot).join(", ") || "(none)");
console.log("body registration  :", JSON.stringify(byName["sidebar.right.pane.tab"]));
console.log("title registration :", JSON.stringify(byName["sidebar.right.pane.tab.title"]));
console.log("body component     :", typeof body.component);
console.log("guide[0] keys      :", JSON.stringify(Object.keys(tabDefinitions[0].guide[0])));
console.log("guide[0].title()   :", tabDefinitions[0].guide[0].title(), "| desc:", tabDefinitions[0].guide[0].description());

const ok =
  captured.id === "dsh-cache-hit-monitor" &&
  bundle.name === "dsh-cache-hit-monitor" &&
  typeof bundle.apply === "function" &&
  tabDefinitions.length === 1 &&
  tabDefinitions[0].id === "dsh-cache-hit-monitor" &&
  tabDefinitions[0].kind === "dsh-cache-hit-monitor" &&
  typeof tabDefinitions[0].title === "function" &&
  tabDefinitions[0].guide.length === 1 &&
  // The pane body owns the recorded history; without keepMounted a tab switch
  // unmounts it and the board silently resets to empty.
  tabDefinitions[0].keepMounted === true &&
  typeof tabDefinitions[0].guide[0].id === "string" &&
  typeof tabDefinitions[0].guide[0].title === "function" &&
  (byName["sidebar.right.pane.tab"] || {}).key === "dsh-cache-hit-monitor" &&
  (byName["sidebar.right.pane.tab"] || {}).locale === "dsh-cache-hit-monitor" &&
  (byName["sidebar.right.pane.tab.title"] || {}).key === "dsh-cache-hit-monitor" &&
  typeof body.component === "function";
console.log("\nWIRING:", ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
