/**
 * Structural render check for the cache-hit monitor's Instrument component.
 *
 * There is no react/react-dom on this machine, so instead of pixels this runs
 * the real component tree through a tiny renderer: elements become plain
 * objects, function components are invoked, and hooks are served from a
 * deterministic stub (the store is seeded so the grid actually has history).
 * That is enough to prove the panel draws, that no undefined/NaN leaked into a
 * style, and that the palette's one-red rule survived the restyle.
 */
import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";
// tests/ and src/ live side by side, so the bundle is one directory up.
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(dir, "client.js"), "utf8");

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (registration) => { captured = registration; } } };
new Function(source)();

/* ---------------------------------------------------------------- react stub */

let hookIndex = 0;
const unkeyed = [];

const EVENT_COUNT = 200;
const seededEvents = [];
for (let i = 0; i < EVENT_COUNT; i += 1) {
  const ticks = new Date(2026, 0, 1, 0, 0, 0).getTime() + i * 1000;
  seededEvents.push({ read: 900 + (i % 7) * 10, write: 80, uncached: 20 + (i % 5), output: 300, at: ticks });
}
const seededStore = { session: "s1", events: seededEvents, prev: null };

const reactStub = {
  // React folds the variadic children into props.children; a component such as
  // Panel reads them from there, so the stub has to do the same or the whole
  // subtree silently renders empty.
  createElement: (type, props, ...children) => {
    const merged = Object.assign({}, props || {});
    if (merged.children === undefined) merged.children = children.length === 1 ? children[0] : children;
    return { type, props: merged };
  },
  useState: (init) => {
    const index = hookIndex;
    hookIndex += 1;
    if (index === 1) return [seededStore, () => {}]; // Instrument's `store`
    return [typeof init === "function" ? init() : init, () => {}];
  },
  useEffect: () => {},
  useRef: () => ({ current: null }),
  // The real grid measures its own column count; the harnesses have no layout,
  // so they keep the fallback and the effect is never asked to run.
  useLayoutEffect: () => {},
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
  locale: { register: () => () => {}, bind: () => (key) => "T:" + key },
  inject: (deps, callback) =>
    callback({
      sidebarRightTabs: { register: () => () => {} },
      slots: {
        inject: (key, cb) => { const r = cb(); return typeof r === "function" ? r : () => {}; },
        register: (options, component) => { registrations.push({ options, component }); return () => {}; },
      },
    }),
};

bundle.apply(ctx);
const body = registrations.find((r) => r.options && r.options.name === "sidebar.right.pane.tab");
if (!body || typeof body.component !== "function") throw new Error("body seat was not registered");

/* ---------------------------------------------------------------- mini render */

function flatten(list, out) {
  for (const item of list) {
    if (Array.isArray(item)) flatten(item, out);
    else if (item !== null && item !== undefined && item !== false) out.push(item);
  }
  return out;
}

function render(node) {
  if (Array.isArray(node)) return { tag: "#frag", props: {}, children: flatten(node, []).map(render) };
  if (node === null || node === undefined || typeof node === "boolean") return { tag: "#empty", props: {}, children: [] };
  if (typeof node !== "object") return { tag: "#text", props: {}, text: String(node), children: [] };
  if (typeof node.type === "function") {
    hookIndex = 0; // each component gets its own hook order
    return render(node.type(node.props || {}));
  }
  const raw = node.props ? node.props.children : null;
  const kids = flatten([raw], []);
  // React only demands keys for children that arrive as an array, and it
  // demands them of the RAW items — a function component's returned element is
  // not the list child, the component element is. Checking after expansion
  // would flag every component that returns a single element.
  if (Array.isArray(raw)) {
    for (const item of kids) {
      if (item === null || typeof item !== "object" || item.type === undefined) continue;
      if (item.props === undefined || item.props.key === undefined) {
        const text = [];
        (function collect(n) {
          if (!n || typeof n !== "object") return;
          if (n.tag === "#text") { text.push(n.text); return; }
          (n.children || []).forEach(collect);
        })(render(item));
        unkeyed.push(String(item.type) + " <" + text.join(" ").slice(0, 30) + ">");
      }
    }
  }
  return { tag: node.type, props: node.props || {}, children: kids.map(render) };
}

const tree = render(body.component({
  sessionId: "s1",
  t: (key) => "T:" + key,
  useProjection: (key) =>
    key === "tokenUsage"
      ? { cacheReadTokens: 9730, cacheWriteTokens: 200, uncachedInputTokens: 70, outputTokens: 5000 }
      : { pressureTokens: 120000, projectedTokens: 0, contextWindow: 200000 },
}));

/* ------------------------------------------------------------------ walk it */

const all = [];
(function walk(node) {
  all.push(node);
  for (const kid of node.children) walk(kid);
})(tree);

let dots = 0;          // dot-matrix glyph dots (absolutely placed circles)
let cells = 0;         // reactor-core cell containers (grid items)
let cellDots = 0;      // the round dot sitting inside each reactor cell
let lamps = 0;         // Bar lamps (round, but capped by maxWidth inside their cell)
let registerRows = 0;
let redNodes = 0;
const badStyles = [];

for (const node of all) {
  const style = node.props && node.props.style;
  if (style && typeof style === "object") {
    for (const key of Object.keys(style)) {
      const value = style[key];
      if (typeof value === "string" && (value.includes("undefined") || value.includes("NaN"))) {
        badStyles.push(key + "=" + value);
      }
    }
    if (style.position === "absolute" && style.borderRadius === "50%") dots += 1;
    if (style.aspectRatio === "1 / 1") {
      if (style.maxWidth !== undefined) lamps += 1;
      else if (typeof style.width === "string") cellDots += 1;
      else cells += 1;
    }
    if (style.textAlign === "right") registerRows += 1;
    const flat = Object.values(style).join(" ");
    if (flat.includes("#d71921")) redNodes += 1;
  }
}

/* --------------------------------------------------------------- expectations */

const expectedDots = "97.3".length * 35; // 4 glyphs x 5x7 matrix
const expectedCells = 6 * 24;           // depth "m" = 6 rows x 24 fallback columns
const expectedLamps = 4 * 22 + 28 + 24;  // 4 register rows (LAMPS=22) + hit bar + pressure bar

const checks = [
  ["instrument renders", all.length > 50],
  ["dot-matrix dots = " + expectedDots, dots === expectedDots],
  ["reactor cells = " + expectedCells, cells === expectedCells],
  ["reactor cell dots = " + expectedCells, cellDots === expectedCells],
  ["bar lamps = " + expectedLamps, lamps === expectedLamps],
  ["register rows = 4", registerRows === 4],
  ["exactly one red element", redNodes === 1],
  ["no undefined/NaN in any style", badStyles.length === 0],
  ["every array child has a key", unkeyed.length === 0],
];

console.log("rendered nodes   :", all.length);
console.log("dot-matrix dots  :", dots, "(expected " + expectedDots + ")");
console.log("reactor cells    :", cells, "(expected " + expectedCells + ")");
console.log("reactor cell dots:", cellDots, "(expected " + expectedCells + ")");
console.log("bar lamps        :", lamps, "(expected " + expectedLamps + ")");
console.log("register rows    :", registerRows);
console.log("red elements     :", redNodes);
if (badStyles.length) console.log("bad styles       :", badStyles.slice(0, 8));
console.log("unkeyed children :", unkeyed.length);
for (const u of [...new Set(unkeyed)].slice(0, 20)) console.log("      " + u);

let ok = true;
for (const [label, pass] of checks) {
  console.log((pass ? "  PASS  " : "  FAIL  ") + label);
  if (!pass) ok = false;
}
console.log("\nRENDER:", ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
