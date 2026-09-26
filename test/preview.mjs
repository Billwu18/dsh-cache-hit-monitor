/**
 * Static-HTML preview of the cache-hit monitor's Instrument component.
 *
 * Same trick as chm-render.mjs (capture the bundle, run the real component tree
 * through a tiny renderer because there is no react/react-dom on this machine),
 * but instead of counting nodes it serialises the tree to an HTML file so
 * firefox --headless can screenshot it. Two frames are emitted, dark and light,
 * because the instrument faces are hard-coded dark while the chrome follows the
 * --dsw-* theme tokens, and the light theme is where a stray dark-on-dark text
 * tone shows up.
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
let activeStore = null;

const seededEvents = [];
for (let i = 0; i < 200; i += 1) {
  const at = new Date(2026, 0, 1, 0, 0, 0).getTime() + i * 1000;
  // A believable mixed stream: mostly small, nearly-all-cached turns with an
  // occasional cold burst carrying a big uncached prompt. The burst is what
  // the core's second channel is there to make visible.
  const burst = i % 11 === 3;
  const read = burst ? 180 : 1200 + (i % 9) * 260;
  const write = burst ? 1500 + (i % 4) * 220 : 55 + (i % 3) * 28;
  const uncached = burst ? 9000 + (i % 5) * 1600 : 12 + (i % 4) * 6;
  const output = burst ? 900 + (i % 3) * 300 : 110 + (i % 6) * 90;
  seededEvents.push({ read, write, uncached, output, at });
}
const seededStore = { session: "s1", events: seededEvents, prev: null };

let columnsOverride = null;

const reactStub = {
  createElement: (type, props, ...children) => {
    const merged = Object.assign({}, props || {});
    if (merged.children === undefined) merged.children = children.length === 1 ? children[0] : children;
    return { type, props: merged };
  },
  useState: (init) => {
    const index = hookIndex;
    hookIndex += 1;
    if (index === 1) return [activeStore, () => {}]; // Instrument's `store`
    // ReactorGrid's column count. With no layout the component keeps the
    // fallback, so a frame can pin the value the real panel would measure.
    if (init === 24 && columnsOverride !== null) return [columnsOverride, () => {}];
    return [typeof init === "function" ? init() : init, () => {}];
  },
  useEffect: () => {},
  useRef: () => ({ current: null }),
  // The real grid measures its own column count; the harnesses have no layout,
  // so they keep the fallback and the effect is never asked to run.
  useLayoutEffect: () => {},
};

const bundle = captured.factory((specifier) => {
  if (specifier === "react") return reactStub;
  throw new Error("unexpected module request: " + specifier);
});

const registrations = [];
const dictionaries = {};
const ctx = {
  effect: (fn) => fn(),
  get: () => undefined,
  locale: {
    register: (ns, dicts) => { dictionaries[ns] = dicts; return () => {}; },
    bind: (ns) => (key) => (dictionaries[ns] && dictionaries[ns].en && dictionaries[ns].en[key]) || String(key),
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

/* ------------------------------------------------------------------- render */

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
    hookIndex = 0;
    return render(node.type(node.props || {}));
  }
  const kids = flatten([node.props ? node.props.children : null], []);
  return { tag: node.type, props: node.props || {}, children: kids.map(render) };
}

function buildTree(store, columns) {
  activeStore = store;
  columnsOverride = columns === undefined ? null : columns;
  hookIndex = 0;
  return render(body.component({
    sessionId: "s1",
    t: ctx.locale.bind("dsh-cache-hit-monitor"),
    useProjection: (key) =>
      key === "tokenUsage"
        ? { cacheReadTokens: 9730, cacheWriteTokens: 200, uncachedInputTokens: 70, outputTokens: 5000 }
        : { pressureTokens: 120000, projectedTokens: 0, contextWindow: 200000 },
  }));
}

/* --------------------------------------------------------------- serialise */

const UNITLESS = new Set([
  "animationIterationCount", "aspectRatio", "borderImageOutset", "borderImageSlice", "borderImageWidth",
  "boxFlex", "boxFlexGroup", "boxOrdinalGroup", "columnCount", "columns", "flex", "flexGrow", "flexPositive",
  "flexShrink", "flexNegative", "flexOrder", "gridArea", "gridRow", "gridRowEnd", "gridRowSpan", "gridRowStart",
  "gridColumn", "gridColumnEnd", "gridColumnSpan", "gridColumnStart", "fontWeight", "lineClamp", "lineHeight",
  "opacity", "order", "orphans", "tabSize", "widows", "zIndex", "zoom", "fillOpacity", "floodOpacity",
  "stopOpacity", "strokeDasharray", "strokeDashoffset", "strokeMiterlimit", "strokeOpacity", "strokeWidth",
]);

const kebab = (key) => key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
const escapeHTML = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text) => escapeHTML(text).replace(/"/g, "&quot;");

function styleText(style) {
  const parts = [];
  for (const key of Object.keys(style)) {
    const value = style[key];
    if (value === undefined || value === null || value === "") continue;
    parts.push(kebab(key) + ":" + (typeof value === "number" && !UNITLESS.has(key) ? value + "px" : String(value)));
  }
  return parts.join(";");
}

function toHTML(node) {
  if (node.tag === "#text") return escapeHTML(node.text);
  if (node.tag === "#empty") return "";
  const kids = node.children.map(toHTML).join("");
  if (node.tag === "#frag") return kids;
  const style = node.props && node.props.style;
  const attrs = [];
  if (style && typeof style === "object") {
    const text = styleText(style);
    if (text) attrs.push(' style="' + escapeAttr(text) + '"');
  }
  if (node.props && typeof node.props.title === "string" && node.props.title) {
    attrs.push(' title="' + escapeAttr(node.props.title) + '"');
  }
  return "<" + node.tag + attrs.join("") + ">" + kids + "</" + node.tag + ">";
}

/* ------------------------------------------------------------- page assembly */

const DARK_TOKENS = `--dsw-alias-bg-base:#1b1b1b;--dsw-alias-bg-layer-1:#232323;--dsw-alias-bg-layer-2:#2b2b2b;
--dsw-alias-border-l1:#3a3a3a;--dsw-alias-border-l2:#4a4a4a;--dsw-alias-label-primary:#e8e8e8;
--dsw-alias-label-secondary:#9a9a9a;--dsw-alias-state-idle-primary:#8a8a8a;
--dsw-alias-state-success-primary:#3fb950;--dsw-alias-state-warn-primary:#d29922;--dsw-alias-state-error-primary:#f85149;`;

const LIGHT_TOKENS = `--dsw-alias-bg-base:#ffffff;--dsw-alias-bg-layer-1:#f4f4f4;--dsw-alias-bg-layer-2:#ececec;
--dsw-alias-border-l1:#d8d8d8;--dsw-alias-border-l2:#c0c0c0;--dsw-alias-label-primary:#1b1b1b;
--dsw-alias-label-secondary:#6a6a6a;--dsw-alias-state-idle-primary:#8a8a8a;
--dsw-alias-state-success-primary:#1a7f37;--dsw-alias-state-warn-primary:#9a6700;--dsw-alias-state-error-primary:#cf222e;`;

const populated = toHTML(buildTree(seededStore));
const empty = toHTML(buildTree({ session: "s1", events: [], prev: null }));
// A young session: only a handful of requests have settled.
const young = toHTML(buildTree({ session: "s1", events: seededEvents.slice(0, 19), prev: null }));
// A narrow sidebar fits far fewer columns, so the same history fills more rows.
const narrow = toHTML(buildTree(seededStore, 14));

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>cache hit monitor preview</title>
<style>
  html, body { margin: 0; padding: 0; background: #0e0e0e; }
  body { display: flex; gap: 16px; align-items: flex-start; padding: 16px; font-family: system-ui, sans-serif; }
  .frame { width: 700px; border-radius: 10px; padding: 0; box-sizing: border-box; overflow: hidden; }
  .frame.narrow { width: 380px; }
  .dark  { ${DARK_TOKENS} background: var(--dsw-alias-bg-base); }
  .light { ${LIGHT_TOKENS} background: var(--dsw-alias-bg-base); }
  .caption { color: #7a7a7a; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; margin: 0 0 6px 2px; }
  * { box-sizing: border-box; }
</style></head>
<body>
  <div><p class="caption">dark · recording</p><div class="frame dark">${populated}</div></div>
  <div><p class="caption">dark · nothing recorded yet</p><div class="frame dark">${empty}</div></div>
  <div><p class="caption">light · recording</p><div class="frame light">${populated}</div></div>
  <div><p class="caption">dark · only 19 recorded</p><div class="frame dark">${young}</div></div>
  <div><p class="caption">dark · narrow sidebar</p><div class="frame dark narrow">${narrow}</div></div>
</body></html>`;

const outDir = path.join(dir, "test", "out");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "preview.html");
fs.writeFileSync(out, page);
console.log("wrote", out, page.length, "bytes");

/* ------------------------------------------------- storefront screenshot pages */

// One frame per page on a neutral backdrop, so `magick -trim` can find the
// card's exact bounding box. These are what the files in `assets/` are
// captured from; the caption strip is dropped on purpose.
const shots = [
  { file: "shot-dark.png", tokens: DARK_TOKENS, bg: "#0e0e0e", width: 700, body: populated },
  { file: "shot-light.png", tokens: LIGHT_TOKENS, bg: "#0e0e0e", width: 700, body: populated },
  { file: "shot-narrow.png", tokens: DARK_TOKENS, bg: "#0e0e0e", width: 380, body: narrow },
  { file: "shot-young.png", tokens: DARK_TOKENS, bg: "#0e0e0e", width: 700, body: young },
];

for (const shot of shots) {
  const doc = `<!doctype html>
<html><head><meta charset="utf-8"><title>${shot.file}</title>
<style>
  html, body { margin: 0; padding: 0; background: ${shot.bg}; }
  body { padding: 14px; font-family: system-ui, sans-serif; }
  .frame { width: ${shot.width}px; border-radius: 10px; overflow: hidden; ${shot.tokens} background: var(--dsw-alias-bg-base); }
  * { box-sizing: border-box; }
</style></head>
<body><div class="frame">${shot.body}</div></body></html>`;
  fs.writeFileSync(path.join(outDir, shot.file.replace(".png", ".html")), doc);
}
console.log("wrote " + shots.length + " screenshot pages to " + outDir);
console.log("");
console.log("Screenshot the frames with any headless browser, e.g.:");
console.log("  firefox --headless --screenshot preview.png --window-size=3300,1250 file://" + out);
