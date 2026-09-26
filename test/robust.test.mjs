/**
 * Robustness harness for the cache-hit monitor.
 *
 * A throwing component does not merely look wrong — the slot system retires the
 * whole entry, so the pane goes blank. This drives the real Instrument through
 * the inputs that are actually reachable: a missing or throwing projection
 * seat, junk numbers where token counts should be, no session, no translate
 * seat, and event histories from empty to absurd. Every case must render
 * without throwing and without leaking `undefined`/`NaN` into a style string.
 *
 * It also checks locale coverage: every key the component asks for must exist
 * in both dictionaries, or a Chinese user sees a raw key in the UI.
 */
import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";
// tests/ and src/ live side by side, so the bundle is one directory up.
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(dir, "client.js"), "utf8");

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (registration) => { captured = registration; } } };
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
new Function(source)();

/* ---------------------------------------------------------------- react fake */

let hookIndex = 0;
let activeStore = { session: "s1", events: [], prev: null };

const reactStub = {
  createElement: (type, props, ...children) => {
    const merged = Object.assign({}, props || {});
    if (merged.children === undefined) merged.children = children.length === 1 ? children[0] : children;
    return { type, props: merged };
  },
  useState: (init) => {
    const index = hookIndex;
    hookIndex += 1;
    if (index === 1) return [activeStore, () => {}];
    if (init === 24) return [24, () => {}]; // ReactorGrid's measured columns
    return [typeof init === "function" ? init() : init, () => {}];
  },
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useLayoutEffect: () => {},
};

const bundle = captured.factory((specifier) => {
  if (specifier === "react") return reactStub;
  throw new Error("unexpected module request: " + specifier);
});

/* ------------------------------------------------------------- load + wire it */

const registrations = [];
const dictionaries = {};
const ctx = {
  effect: (fn) => fn(),
  get: () => undefined,
  locale: {
    register: (ns, dicts) => { dictionaries[ns] = dicts; return () => {}; },
    bind: () => (key) => key,
  },
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

function renderNode(node, depth) {
  if (Array.isArray(node)) return flatten(node, []).map((kid) => renderNode(kid, depth));
  if (node === null || node === undefined || typeof node === "boolean") return null;
  if (typeof node !== "object") return null;
  if (typeof node.type === "function") {
    const own = depth === 0;
    const previous = hookIndex;
    if (!own) hookIndex = 0;
    const out = renderNode(node.type(node.props || {}), depth + 1);
    if (!own) hookIndex = previous;
    return out;
  }
  const kids = flatten([node.props ? node.props.children : null], []);
  return { tag: node.type, props: node.props || {}, children: kids.map((kid) => renderNode(kid, depth)) };
}

function run(props, store) {
  activeStore = store;
  hookIndex = 0;
  const result = { nodes: 0, bad: [], threw: null };
  try {
    const tree = renderNode(body.component(props), 0);
    const walk = (node) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== "object") return;
      result.nodes += 1;
      const style = node.props && node.props.style;
      if (style && typeof style === "object") {
        for (const key of Object.keys(style)) {
          const value = style[key];
          if (typeof value === "string" && (value.includes("undefined") || value.includes("NaN"))) {
            result.bad.push(key + "=" + value);
          }
        }
      }
      (node.children || []).forEach(walk);
    };
    walk(tree);
  } catch (error) {
    result.threw = error && error.message ? error.message : String(error);
  }
  return result;
}

/* ------------------------------------------------------------------ scenarios */

const totalsOk = { cacheReadTokens: 9730, cacheWriteTokens: 200, uncachedInputTokens: 70, outputTokens: 5000 };
const pressureOk = { pressureTokens: 120000, projectedTokens: 0, contextWindow: 200000 };
const proj = (totals, pressure) => (key) => (key === "tokenUsage" ? totals : pressure);

const mkEvents = (n, mutate) => {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const ev = { read: 1000 + (i % 7) * 50, write: 60, uncached: 20, output: 200, at: Date.now() - i * 1000 };
    out.push(mutate ? mutate(ev, i) : ev);
  }
  return out;
};
const store = (events) => ({ session: "s1", events, prev: null });

const base = { sessionId: "s1", t: (key) => key, useProjection: proj(totalsOk, pressureOk) };

const scenarios = [
  ["happy path, 50 requests", base, store(mkEvents(50))],
  ["no projection seat", { sessionId: "s1", t: (k) => k }, store(mkEvents(50))],
  ["projection throws", { ...base, useProjection: () => { throw new Error("foreign harness"); } }, store(mkEvents(50))],
  ["projection returns null", { ...base, useProjection: () => null }, store(mkEvents(50))],
  [
    "projection returns junk",
    { ...base, useProjection: () => ({ cacheReadTokens: "abc", cacheWriteTokens: NaN, uncachedInputTokens: Infinity, outputTokens: -500, pressureTokens: undefined, contextWindow: -1 }) },
    store(mkEvents(20)),
  ],
  ["projection returns a string", { ...base, useProjection: () => "nope" }, store(mkEvents(20))],
  ["no session id", { ...base, sessionId: undefined }, store(mkEvents(20))],
  ["no translate seat", { sessionId: "s1", useProjection: proj(totalsOk, pressureOk) }, store(mkEvents(20))],
  ["empty history", base, store([])],
  ["a single request", base, store(mkEvents(1))],
  ["events with junk numbers", base, store(mkEvents(30, (ev) => ({ ...ev, read: NaN, write: -1, uncached: undefined, output: Infinity })))],
  ["events missing all fields", base, store(mkEvents(30, () => ({})))],
  ["10k requests", base, store(mkEvents(10000))],
  ["zero-token request", base, store([{ read: 0, write: 0, uncached: 0, output: 0, at: Date.now() }])],
  ["all-cache-hit request", base, store([{ read: 5000, write: 0, uncached: 0, output: 10, at: Date.now() }])],
  ["pressure window zero", { ...base, useProjection: proj(totalsOk, { pressureTokens: 5000, projectedTokens: 0, contextWindow: 0 }) }, store(mkEvents(5))],
];

let failures = 0;
console.log("scenario                        nodes  bad styles  threw");
for (const [label, props, st] of scenarios) {
  const out = run(props, st);
  const flag = out.threw !== null ? "THREW" : out.bad.length > 0 ? "BAD STYLE" : "ok";
  if (flag !== "ok") failures += 1;
  console.log(
    label.padEnd(30) +
      String(out.nodes).padStart(6) +
      String(out.bad.length).padStart(11) +
      "  " +
      (out.threw === null ? flag : flag + ": " + out.threw),
  );
  if (out.bad.length) console.log("      " + out.bad.slice(0, 3).join(","));
}

/* ------------------------------------------------------------ locale coverage */

const dicts = dictionaries["dsh-cache-hit-monitor"] || {};
const used = new Set();
for (const match of source.matchAll(/\bt\("([A-Za-z][A-Za-z0-9]*)"\)/g)) used.add(match[1]);
const missingZh = [];
const missingEn = [];
for (const key of used) {
  if (!dicts.zh || dicts.zh[key] === undefined) missingZh.push(key);
  if (!dicts.en || dicts.en[key] === undefined) missingEn.push(key);
}

// Every dictionary key should also be reachable, so dead copy cannot accumulate.
const unused = [];
for (const key of Object.keys(dicts.en || {})) if (!used.has(key)) unused.push(key);
// `waiting` and `prompt` are read through variables in a couple of places.
const allowUnused = new Set(["waiting", "prompt"]);

console.log("");
console.log("locale keys used  :", used.size);
console.log("missing in zh     :", missingZh.length ? missingZh.join(", ") : "(none)");
console.log("missing in en     :", missingEn.length ? missingEn.join(", ") : "(none)");
console.log("defined but unused:", unused.filter((k) => !allowUnused.has(k)).join(", ") || "(none)");

/* -------------------------------------------------------------------- verdict */

const checks = [
  ["every scenario renders", failures === 0],
  ["no NaN/undefined in any style", failures === 0],
  ["zh dictionary covers every key", missingZh.length === 0],
  ["en dictionary covers every key", missingEn.length === 0],
];

console.log("");
let ok = true;
for (const [label, pass] of checks) {
  if (!pass) ok = false;
  console.log((pass ? "  PASS  " : "  FAIL  ") + label);
}
console.log("\nROBUST:", ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
