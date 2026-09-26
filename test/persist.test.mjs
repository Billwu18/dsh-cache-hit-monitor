/**
 * Remount test for the cache-hit monitor.
 *
 * Switching to another sidebar tab unmounts this pane's body, and a plain
 * useState would silently drop everything the user had recorded. Two things
 * are supposed to prevent that: `keepMounted: true` on the tab definition, and
 * the module-level store cache that this file actually exercises.
 *
 * It mounts the real Instrument, feeds it an updated token snapshot so a
 * request settles, clicks the real depth button, throws the whole mount away,
 * mounts again, and asserts the second mount came back with the history and
 * the chosen depth intact.
 */
import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";
// tests/ and src/ live side by side, so the bundle is one directory up.
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(dir, "client.js"), "utf8");

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (registration) => { captured = registration; } } };
// The component's clock effect must not keep the process alive.
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
new Function(source)();

/* ------------------------------------------------------- per-instance hooks */

let instance = null;
let cursor = 0;

function sameDeps(a, b) {
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
  return true;
}

const reactStub = {
  createElement: (type, props, ...children) => {
    const merged = Object.assign({}, props || {});
    if (merged.children === undefined) merged.children = children.length === 1 ? children[0] : children;
    return { type, props: merged };
  },
  useState: (init) => {
    const slot = cursor;
    cursor += 1;
    const hooks = instance.hooks;
    if (!(slot in hooks)) hooks[slot] = { value: typeof init === "function" ? init() : init };
    const cell = hooks[slot];
    return [cell.value, (next) => { cell.value = typeof next === "function" ? next(cell.value) : next; }];
  },
  // No layout in the harness, so the grid keeps its fallback column count.
  useRef: () => ({ current: null }),
  useLayoutEffect: () => {},
  useEffect: (fn, deps) => {
    const slot = cursor;
    cursor += 1;
    const hooks = instance.hooks;
    if (!(slot in hooks)) hooks[slot] = { deps: null, ran: false };
    const cell = hooks[slot];
    if (!cell.ran || !sameDeps(cell.deps, deps)) {
      cell.deps = deps;
      cell.ran = true;
      fn();
    }
  },
};

/* ------------------------------------------------------------- load + wire it */

const bundle = captured.factory((specifier) => {
  if (specifier === "react") return reactStub;
  throw new Error("unexpected module request: " + specifier);
});

const registrations = [];
const ctx = {
  effect: (fn) => fn(),
  get: () => undefined,
  locale: { register: () => () => {}, bind: () => (key) => key },
  inject: (deps, callback) =>
    callback({
      sidebarRightTabs: { register: (definition) => { registrations.push({ kind: "tab", definition }); return () => {}; } },
      slots: {
        inject: (key, cb) => { const r = cb(); return typeof r === "function" ? r : () => {}; },
        register: (options, component) => { registrations.push({ kind: "slot", options, component }); return () => {}; },
      },
    }),
};

bundle.apply(ctx);
const tabDefinition = (registrations.find((r) => r.kind === "tab") || {}).definition;
const body = registrations.find((r) => r.kind === "slot" && r.options.name === "sidebar.right.pane.tab");
if (!body || typeof body.component !== "function") throw new Error("body seat was not registered");

/* ---------------------------------------------------------------- mini render */

function flatten(list, out) {
  for (const item of list) {
    if (Array.isArray(item)) flatten(item, out);
    else if (item !== null && item !== undefined && item !== false) out.push(item);
  }
  return out;
}

/**
 * A real tree walk: every component position keeps its own hook instance across
 * renders, exactly like react does, so an update reuses the Instrument's state
 * while a fresh mount starts from nothing.
 */
function renderNode(node, path, mountPoint) {
  if (Array.isArray(node)) return flatten(node, []).map((kid, i) => renderNode(kid, path + "," + i, mountPoint));
  if (node === null || node === undefined || typeof node === "boolean") return null;
  if (typeof node !== "object") return null;

  if (typeof node.type === "function") {
    const name = node.type.name || "anonymous";
    const key = name + path;
    if (!mountPoint.instances[key]) mountPoint.instances[key] = { hooks: [] };
    const own = mountPoint.instances[key];
    mountPoint.byName[name] = own;
    const previous = instance;
    const previousCursor = cursor;
    instance = own;
    cursor = 0;
    const out = renderNode(node.type(node.props || {}), path + ">", mountPoint);
    instance = previous;
    cursor = previousCursor;
    return out;
  }

  const kids = flatten([node.props ? node.props.children : null], []);
  return { tag: node.type, props: node.props || {}, children: kids.map((kid, i) => renderNode(kid, path + "." + i, mountPoint)) };
}

/** One mount. Rendering again into the same mount point is a normal update. */
function mount(current, totals, projection) {
  const target = current === undefined ? { instances: {}, byName: {}, tree: null } : current;
  const previous = instance;
  const previousCursor = cursor;
  const tree = renderNode(
    body.component({
      sessionId: "s1",
      t: (key) => key,
      useProjection: (key) => (key === "tokenUsage" ? totals : projection),
    }),
    "",
    target,
  );
  instance = previous;
  cursor = previousCursor;
  target.tree = tree;
  return target;
}

function instrumentOf(mounted) {
  const found = mounted.byName.Instrument;
  if (!found) throw new Error("the Instrument component never rendered");
  return found;
}

/** Click the real depth button, so the component's own setter runs. */
function clickDepth(mounted, label) {
  const found = [];
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    if (typeof node.props.onClick === "function" && node.props.children === label) found.push(node.props.onClick);
    (node.children || []).forEach(walk);
  })(mounted.tree);
  if (found.length !== 1) throw new Error("expected exactly one button labelled " + label + ", found " + found.length);
  const previous = instance;
  instance = instrumentOf(mounted);
  found[0]();
  instance = previous;
}

/* ------------------------------------------------------------------ the test */

const snap = (read, uncached) => ({ cacheReadTokens: read, cacheWriteTokens: 200, uncachedInputTokens: uncached, outputTokens: 5000 });
const pressure = { pressureTokens: 120000, projectedTokens: 0, contextWindow: 200000 };

const first = mount(undefined, snap(9730, 70), pressure);
const depthAtStart = instrumentOf(first).hooks[0].value;
// A request settles: the totals move, so the delta becomes one recorded event.
mount(first, snap(12150, 90), pressure);
const recorded = instrumentOf(first).hooks[1].value.events.length;

// The user picks the deepest board, then switches to another sidebar tab.
clickDepth(first, "9");
const depthPicked = instrumentOf(first).hooks[0].value;

// Switching back remounts the pane body from nothing.
const second = mount(undefined, snap(12150, 90), pressure);
const restored = instrumentOf(second).hooks[1].value.events.length;
const depthAfter = instrumentOf(second).hooks[0].value;

/* -------------------------------------------------------------------- check */

console.log("keepMounted  :", tabDefinition.keepMounted, "(on the tab definition)");
console.log("mount 1 store:", recorded, "event(s) recorded");
console.log("mount 2 store:", restored, "event(s) restored");
console.log("depth        :", JSON.stringify(depthAtStart), "-> clicked 9 rows ->", JSON.stringify(depthPicked), "-> remount reads", JSON.stringify(depthAfter));

const checks = [
  ["tab definition keeps the body mounted", tabDefinition.keepMounted === true],
  ["mount 1 recorded the settled request", recorded === 1],
  ["mount 2 restored the history", restored === 1],
  ["depth click reached the component", depthPicked === "l"],
  ["mount 2 restored the chosen depth", depthAfter === "l"],
];

let ok = true;
console.log("");
for (const [label, pass] of checks) {
  if (!pass) ok = false;
  console.log((pass ? "  PASS  " : "  FAIL  ") + label);
}
console.log("\nPERSIST:", ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
