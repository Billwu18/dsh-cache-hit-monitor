/**
 * Manifest and packaging checks.
 *
 * These are the rules a DSH plugin is judged on before anyone looks at its
 * code: a `dsh.bundle` manifest that actually resolves, display metadata in the
 * shape the Plugin Manager reads, an icon inside the size limit, screenshots
 * that do not leave the repository, and no install scripts that would force an
 * install-approval prompt on someone else's machine.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(dir, rel));
const json = (rel) => JSON.parse(read(rel));

const failures = [];
const notes = [];
const check = (label, pass, detail) => {
  if (!pass) failures.push(label + (detail ? " — " + detail : ""));
  console.log((pass ? "  ok   " : "  FAIL ") + label + (detail && !pass ? "  [" + detail + "]" : ""));
};

const pkg = json("package.json");

/* ----------------------------------------------------------------- manifest */

console.log("manifest");
check("name is a valid npm name", /^[a-z0-9][a-z0-9._-]*$/.test(pkg.name), pkg.name);
check("version is semver", /^\d+\.\d+\.\d+/.test(pkg.version), pkg.version);
check("description present", typeof pkg.description === "string" && pkg.description.length > 20);
check("license declared", pkg.license === "MIT", String(pkg.license));
check("author declared", typeof pkg.author === "string" && pkg.author.length > 0);
check("repository points at a git url", typeof pkg.repository?.url === "string" && pkg.repository.url.startsWith("git+https://"));

// dsh.bundle is what makes the package installable; dsh.client alone is not.
check("dsh.bundle.patch declared", typeof pkg.dsh?.bundle?.patch === "string", String(pkg.dsh?.bundle?.patch));
check("dsh.manifestVersion declared", pkg.dsh?.manifestVersion === 1);
check("dsh.client.platform is web", pkg.dsh?.client?.platform === "web");

const official = [
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-sidebar-right",
];
const inject = pkg.dsh?.client?.inject ?? [];
check("dsh.client.inject lists the official services", official.every((n) => inject.includes(n)), inject.join(", "));

// Official packages belong in peerDependencies. A range whose lower bound is a
// prerelease only matches that exact tuple, so the bound has to carry the tag.
console.log("\npeer dependencies");
for (const name of official) {
  const range = pkg.peerDependencies?.[name];
  check(name + " is a peer", typeof range === "string", String(range));
  if (range) {
    check(name + " range admits prereleases", /-rc\.\d/.test(range) || !/-/.test(range), range);
    check(name + " range excludes the next minor", /<0\.2\.0/.test(range), range);
  }
}
check("no official package listed as a dependency", !Object.keys(pkg.dependencies ?? {}).some((n) => n.startsWith("@deepseek-ai/")));

/* -------------------------------------------------------------- patch + files */

console.log("\nbundle patch");
const patchRel = pkg.dsh.bundle.patch.replace(/^\.\//, "");
check("patch file exists", exists(patchRel), patchRel);
if (exists(patchRel)) {
  const patch = read(patchRel);
  check("patch inserts a row", /^\s*-\s*insert:/m.test(patch));
  check("patch row names this package", patch.includes(pkg.name), pkg.name);
  check("patch row has an id", /^\s*-\s*id:/m.test(patch));
}

console.log("\nexports and files");
check('exports "." resolves', typeof pkg.exports?.["."] === "string" && exists(pkg.exports["."].replace(/^\.\//, "")));
check('exports "./client" resolves', exists(String(pkg.exports?.["./client"]).replace(/^\.\//, "")));
check("files lists the shipped pieces", Array.isArray(pkg.files) && pkg.files.length > 0);

console.log("\ninstall scripts");
for (const hook of ["preinstall", "install", "postinstall", "prepare", "prepublish"]) {
  check("no " + hook + " script", pkg.scripts?.[hook] === undefined, String(pkg.scripts?.[hook]));
}

/* ------------------------------------------------------------------- display */

console.log("\ndisplay metadata");
check("icon declared", typeof pkg.icon === "string", String(pkg.icon));
if (typeof pkg.icon === "string") {
  const iconRel = pkg.icon.replace(/^\.\//, "");
  check("icon is relative", !path.isAbsolute(pkg.icon) && !pkg.icon.includes(".."));
  check("icon exists", exists(iconRel), iconRel);
  if (exists(iconRel)) {
    const bytes = fs.statSync(path.join(dir, iconRel)).size;
    check("icon within 256 KiB", bytes <= 256 * 1024, bytes + " bytes");
    check("icon is a supported type", /\.(svg|png|jpe?g|webp)$/i.test(iconRel), iconRel);
  }
}

// The Plugin Manager reads `meta.title` / `meta.description` from locale/*.json.
for (const locale of ["en", "zh"]) {
  const rel = "locale/" + locale + ".json";
  check(rel + " exists", exists(rel));
  if (!exists(rel)) continue;
  let doc = null;
  try {
    doc = json(rel);
  } catch (error) {
    check(rel + " parses", false, error.message);
    continue;
  }
  check(rel + " parses", true);
  check(rel + " has meta.title", typeof doc.meta?.title === "string" && doc.meta.title.length > 0);
  check(rel + " has meta.description", typeof doc.meta?.description === "string" && doc.meta.description.length > 0);
}

/* -------------------------------------------------------------- screenshots */

console.log("\nscreenshots.json");
check("screenshots.json exists", exists("screenshots.json"));
if (exists("screenshots.json")) {
  const doc = json("screenshots.json");
  const list = Array.isArray(doc) ? doc : doc.screenshots;
  check("screenshots is a list", Array.isArray(list));
  if (Array.isArray(list)) {
    check("1 to 8 screenshots", list.length >= 1 && list.length <= 8, String(list.length));
    for (const entry of list) {
      check("relative: " + entry, !path.isAbsolute(entry) && !entry.includes(".."));
      check("exists: " + entry, exists(entry));
    }
  }
}

/* ---------------------------------------------------------------- documents */

console.log("\ndocuments");
for (const doc of ["README.md", "README.zh.md", "LICENSE", "CHANGELOG.md", ".gitignore"]) {
  check(doc + " exists", exists(doc));
}
if (exists("README.md") && exists("README.zh.md")) {
  const en = read("README.md");
  const zh = read("README.zh.md");
  check("READMEs cross-link", en.includes("README.zh.md") && zh.includes("README.md"));
  // Locale parity in the sense the ecosystem checks it: the same screenshots
  // and the same set of top-level headings, so the two cannot drift apart.
  const heads = (text) => (text.match(/^## .+$/gm) ?? []).length;
  check("READMEs have the same section count", heads(en) === heads(zh), heads(en) + " vs " + heads(zh));
  const shot = /assets\/screenshot-[\w-]+\.png/g;
  const enShots = [...new Set(en.match(shot) ?? [])].sort().join(",");
  const zhShots = [...new Set(zh.match(shot) ?? [])].sort().join(",");
  check("READMEs reference the same screenshots", enShots === zhShots);
}

/* -------------------------------------------------------------------- bundle */

console.log("\nruntime bundle");
check("client.js exists", exists("client.js"));
if (exists("client.js")) {
  const source = read("client.js");
  check("client.js registers with the module loader", source.includes("__ModuleLoader__.load"));
  check("client.js declares its own module object", /var module = \{ exports: \{\} \}/.test(source));
  check("client.js exports a name", /name:\s*"dsh-cache-hit-monitor"/.test(source));
}
check("index.js exists", exists("index.js"));

const stale = ["chm-preview.html", "chm-final.png", "chm-core.png", "chm-narrow.png"];
console.log("\nleftovers");
for (const file of stale) check("no stray " + file, !exists(file));

/* ------------------------------------------------------------------- verdict */

console.log("");
if (failures.length === 0) {
  console.log("MANIFEST: PASS (" + notes.length + " notes)");
  process.exit(0);
}
console.log("MANIFEST: FAIL");
for (const failure of failures) console.log("  - " + failure);
process.exit(1);
