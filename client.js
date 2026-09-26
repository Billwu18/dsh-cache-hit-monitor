/**
 * Cache Hit Monitor — Client half.
 *
 * A right-sidebar instrument drawn in the visual language of two pieces of
 * hardware: a mainframe operator's register bank (rows of labelled lamps with a
 * numeric readout beside them) and a reactor-core status board (a dense grid of
 * glowing cells, one per request).
 *
 * Every figure on the panel comes from the `tokenUsage` and `contextPressure`
 * session projections that `@deepseek-ai/dsh-token-meter` already computes on
 * the Host and publishes to the Client through their `wire.view`. The four
 * token buckets are DISJOINT, so the difference between two published snapshots
 * is exactly one settled request's cache accounting:
 *
 *   uncachedInputTokens   prompt tokens the provider had to read in full
 *   cacheReadTokens       prompt tokens served out of the provider's cache
 *   cacheWriteTokens      prompt tokens written into that cache
 *   outputTokens          generated tokens
 *
 * Hit rate is cacheRead / (cacheRead + cacheWrite + uncachedInput). Output is
 * deliberately excluded: generated tokens are never cacheable, so counting them
 * would flatter the number.
 *
 * The Host half is inert; see `./index.js`.
 */
window.__ModuleLoader__.load({
	id: "dsh-cache-hit-monitor",
	factory(require) {
		"use strict";

		// The loader hands the factory a `require` only; the CommonJS `module`
		// object is the bundle's own, exactly as the compiled bundles declare it.
		var module = { exports: {} };

		const React = require("react");
		const h = React.createElement;
		const useState = React.useState;
		const useEffect = React.useEffect;
		const useRef = React.useRef === undefined ? () => ({ current: null }) : React.useRef;
		// Measuring the live column count before paint avoids a visible reflow.
		const useLayoutEffect = React.useLayoutEffect === undefined ? React.useEffect : React.useLayoutEffect;

		const NS = "dsh-cache-hit-monitor";
		const TAB_ID = "dsh-cache-hit-monitor";
		const TAB_KIND = "dsh-cache-hit-monitor";
		const GUIDE_ORDER = 25;

		// The body registration carries `locale: NS`, which makes the framework
		// synthesize a `t` seat on the panel. This fallback covers a face that
		// does not, so the panel still reads as words instead of dictionary keys.
		let boundT = null;

		/* ------------------------------------------------------------------ *
		 * Words. The panel is mostly numerals and latin field labels, but the
		 * sentences a user actually reads are routed through the Client locale.
		 * ------------------------------------------------------------------ */

		const DICT_ZH = {
			tab: "缓存命中",
			guide: "实时提示词缓存命中率、寄存器阵列与反应堆芯状态。",
			hitRate: "缓存命中率",
			basis: "缓存读取 / 提示词总量",
			prompt: "提示词",
			registers: "寄存器阵列",
			read: "缓存读取",
			write: "缓存写入",
			uncached: "未命中输入",
			output: "输出",
			core: "反应堆芯",
			coreHint: "亮度=命中率 · 圆点=请求量 · 最新在前",
			coreEmpty: "尚无记录。面板打开后每结算一笔请求，堆芯就点亮一格。",
			pressure: "上下文压力",
			waiting: "等待首次请求",
			waitingHint: "堆芯只记录本面板打开之后结算的请求；寄存器阵列是本次会话的累计值。",
			noSeat: "未取得 tokenUsage 投影",
			noSeatHint: "当前会话未提供该投影座位，监视器保持待机。",
			requests: "请求",
			last: "最近",
			clear: "清空",
			depth: "行数",
			rows: "行",
			idle: "待机",
			live: "实时",
			used: "已用",
		};

		const DICT_EN = {
			tab: "Cache Hits",
			guide: "Live prompt-cache hit rate, register bank and reactor-core state.",
			hitRate: "CACHE HIT RATE",
			basis: "cache read / prompt tokens",
			prompt: "PROMPT",
			registers: "REGISTER BANK",
			read: "CACHE READ",
			write: "CACHE WRITE",
			uncached: "UNCACHED IN",
			output: "OUTPUT",
			core: "REACTOR CORE",
			coreHint: "ink = hit rate · dot = size · newest first",
			coreEmpty: "Nothing recorded yet. Each request that settles while this panel is open lights one cell.",
			pressure: "CONTEXT PRESSURE",
			waiting: "AWAITING FIRST REQUEST",
			waitingHint: "The core records only requests that settle from now on; the register bank shows session totals.",
			noSeat: "tokenUsage PROJECTION UNAVAILABLE",
			noSeatHint: "This conversation does not serve that projection seat; the monitor stays idle.",
			requests: "REQ",
			last: "LAST",
			clear: "CLR",
			depth: "ROWS",
			rows: "ROWS",
			idle: "IDLE",
			live: "LIVE",
			used: "used",
		};

		/* ------------------------------------------------------------------ *
		 * Hardware palette. Chrome (frames, labels, borders) follows the theme
		 * tokens so the panel sits inside the sidebar; the instrument faces
		 * themselves are glass readouts and stay dark in both themes, which is
		 * what an incandescent lamp board behind smoked plexiglass looks like.
		 * ------------------------------------------------------------------ */

		const T = {
			bgBase: "var(--dsw-alias-bg-base)",
			layer1: "var(--dsw-alias-bg-layer-1)",
			layer2: "var(--dsw-alias-bg-layer-2)",
			border: "var(--dsw-alias-border-l1)",
			label: "var(--dsw-alias-label-primary)",
			dim: "var(--dsw-alias-label-secondary)",
			idle: "var(--dsw-alias-state-idle-primary)",
			success: "var(--dsw-alias-state-success-primary)",
			warn: "var(--dsw-alias-state-warn-primary)",
			error: "var(--dsw-alias-state-error-primary)",
		};

		/* ------------------------------------------------------------------ *
		 * Instrument palette. The faces do not follow the theme: they are matte
		 * black in light and dark alike, the way painted hardware is. The
		 * constraint is the one Nothing works under — a single ink, a single
		 * red, and no third colour anywhere. A cache monitor showing a rainbow
		 * is a cache monitor using colour as decoration; here the only thing
		 * hue ever says is "live", and it says it once, in one dot.
		 * ------------------------------------------------------------------ */

		const FACE = "#0a0a0a"; // instrument face
		const WELL = "#050505"; // recessed window
		const GLASS = FACE; // kept: the name the panels already pass around
		const OFF_LAMP = "#1d1d1d"; // an unlit lamp is a socket, not a colour
		const OFF_SEG = "#191919"; // the dots a glyph did not light
		const INK = "#f2f0eb"; // the one lit colour
		const INK_RGB = [242, 240, 235];
		const INK_DIM = "#8b8884"; // a second weight, not a second hue
		// A hairline that belongs to the face rather than to the theme: inside a
		// glass panel the theme border token would go light-on-dark in the light
		// theme and outline nothing at all.
		const FACE_LINE = "rgba(255, 255, 255, 0.14)";
		const RED = "#d71921"; // reserved: the live signal, and nothing else

		// Legacy names the components still reference. They all resolve to the
		// same ink, so no field can accidentally acquire a private colour.
		const AMBER = INK;
		const CREAM = INK;

		/* ------------------------------------------------------------------ *
		 * Small numeric helpers. Every read off a projection crosses a trust
		 * boundary, so each field re-proves itself and degrades to a neutral
		 * value rather than leaking NaN into the layout.
		 * ------------------------------------------------------------------ */

		function numOf(value) {
			return typeof value === "number" && Number.isFinite(value) ? value : 0;
		}

		function clamp01(value) {
			return value < 0 ? 0 : value > 1 ? 1 : value;
		}

		// A single-ink scale. Intensity, not hue, carries the value: the board
		// gets its legibility from how much light a cell gives off, which is
		// also the only thing a real lamp board could tell you.
		const RAMP = [[96, 94, 91], [170, 168, 164], [242, 240, 235]];

		function rampRGB(ratio) {
			const x = clamp01(ratio) * (RAMP.length - 1);
			const i = Math.min(RAMP.length - 2, Math.floor(x));
			const f = x - i;
			const a = RAMP[i];
			const b = RAMP[i + 1];
			return [
				Math.round(a[0] + (b[0] - a[0]) * f),
				Math.round(a[1] + (b[1] - a[1]) * f),
				Math.round(a[2] + (b[2] - a[2]) * f),
			];
		}

		function rgba(rgb, alpha) {
			return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + alpha + ")";
		}

		function solid(rgb) {
			return "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
		}

		function trim1(value) {
			const text = value.toFixed(1);
			return text.slice(-2) === ".0" ? text.slice(0, -2) : text;
		}

		/** 517 / 12.2K / 517K / 1.2M — the same compact scale the chat footer uses. */
		function formatTokens(value) {
			const v = Math.max(0, numOf(value));
			if (v < 1000) return String(Math.round(v));
			if (v < 100000) return trim1(v / 1000) + "K";
			if (v < 1000000) return Math.round(v / 1000) + "K";
			return trim1(v / 1000000) + "M";
		}

		/** 12s / 5m / 2h / 3d — a raw second count is unreadable once it is old. */
		function formatAge(seconds) {
			const s = Math.max(0, Math.round(numOf(seconds)));
			if (s < 60) return s + "s";
			if (s < 3600) return Math.floor(s / 60) + "m";
			if (s < 86400) return Math.floor(s / 3600) + "h";
			return Math.floor(s / 86400) + "d";
		}

		/**
		 * A hit percentage that never lies by rounding up to 100: a partial hit
		 * whose one-decimal form would read 100 keeps more places until it stops
		 * claiming a full hit.
		 */
		function percentText(ratio) {
			if (ratio === null) return "--.-";
			const raw = ratio * 100;
			const one = Math.round(raw * 10) / 10;
			if (one >= 100 && raw < 100) {
				const two = Math.round(raw * 100) / 100;
				if (two >= 100 && raw < 100) return (Math.round(raw * 1000) / 1000).toFixed(3);
				return two.toFixed(2);
			}
			return one.toFixed(1);
		}

		/** Prompt-side denominator: the three input buckets are disjoint and sum to the prompt. */
		function promptTotalOf(totals) {
			return totals === null ? 0 : totals.read + totals.write + totals.uncached;
		}

		function hitRatioOf(totals) {
			const base = promptTotalOf(totals);
			if (base <= 0) return null;
			return clamp01(totals.read / base);
		}

		/* ------------------------------------------------------------------ *
		 * Projection reads. The seat is a real hook, so it is called
		 * unconditionally and once per key, in a stable order, and every result
		 * is narrowed here — a foreign or partial snapshot renders a cold panel
		 * instead of throwing into the sidebar.
		 * ------------------------------------------------------------------ */

		function readTotals(props) {
			const useProjection = props === null || props === void 0 ? void 0 : props.useProjection;
			if (typeof useProjection !== "function") return null;
			let value;
			try {
				value = useProjection("tokenUsage");
			} catch (_error) {
				return null;
			}
			if (value === null || typeof value !== "object") return null;
			return {
				read: numOf(value.cacheReadTokens),
				write: numOf(value.cacheWriteTokens),
				uncached: numOf(value.uncachedInputTokens),
				output: numOf(value.outputTokens),
			};
		}

		function readPressure(props) {
			const useProjection = props === null || props === void 0 ? void 0 : props.useProjection;
			if (typeof useProjection !== "function") return null;
			let value;
			try {
				value = useProjection("contextPressure");
			} catch (_error) {
				return null;
			}
			if (value === null || typeof value !== "object") return null;
			return {
				pressure: numOf(value.pressureTokens),
				projected: numOf(value.projectedTokens),
				window: numOf(value.contextWindow),
			};
		}

		/* ------------------------------------------------------------------ *
		 * Frames and primitives.
		 * ------------------------------------------------------------------ */

		function Panel(props) {
			const header = props.header
				? h(
						"header",
						{
							key: "header",
							style: {
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								gap: "10px",
								padding: "10px 10px 8px",
								borderBottom: "1px solid " + T.border,
								color: T.dim,
								fontSize: "11px",
								letterSpacing: "0.1em",
								textTransform: "uppercase",
							},
						},
						[
							h("span", { key: "title", style: { whiteSpace: "nowrap" } }, props.header),
							props.aside ? h("span", { key: "aside", style: { whiteSpace: "nowrap" } }, props.aside) : null,
						],
					)
				: null;
			return h(
				"section",
				{
					style: {
						border: "1px solid " + T.border,
						borderRadius: "2px",
						overflow: "hidden",
						background: T.layer1,
					},
				},
				[
					header,
					h(
						"div",
						{
							key: "body",
							style: Object.assign(
								{ padding: "10px", boxSizing: "border-box" },
								props.glass ? { background: GLASS } : null,
								props.bodyStyle || null,
							),
						},
						props.children,
					),
				],
			);
		}

		/**
		 * One row of lamps. A lit lamp is ink with a tight halo; a spent one is
		 * a socket outlined by a hairline, so the row reads as a physical strip
		 * of positions rather than as a decorated progress bar. The halo is
		 * hard-coded to the ink on purpose: no caller gets to give a row its
		 * own colour.
		 */
		function Bar(props) {
			const lamps = props.lamps;
			const height = props.height || 10;
			const lit = props.lit;
			const colorAt = props.colorAt;
			// Round lamps, not slabs: the row has to read as discrete LEDs with
			// air between them. The diameter is capped by the cell width so a
			// dense row can never let neighbouring lamps touch.
			const dot = Math.max(4, Math.round(height * 0.66));
			const items = [];
			for (let i = 0; i < lamps; i += 1) {
				const on = i < lit;
				items.push(
					h("span", {
						key: i,
						style: {
							flex: "1 1 0",
							minWidth: "0",
							height: height + "px",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
						},
					}, h("span", {
						style: {
							width: "100%",
							aspectRatio: "1 / 1",
							maxWidth: dot + "px",
							borderRadius: "50%",
							background: on ? colorAt(i) : OFF_LAMP,
							opacity: on ? 0.86 : 1,
							boxShadow: on ? "0 0 3px " + rgba(INK_RGB, 0.35) : "inset 0 0 0 1px rgba(255,255,255,0.05)",
							transition: "background 140ms linear",
						},
					})),
				);
			}
			return h("div", { style: { display: "flex", alignItems: "center", gap: "4px", width: "100%" } }, items);
		}

		/**
		 * Dot-matrix numerals. The readout is drawn as the dots themselves
		 * rather than as seven bars, which puts the numbers in the same family
		 * as the lamp strips and the core grid. The dots that stay dark matter
		 * as much as the ones that light: that is what makes a matrix read as
		 * a matrix instead of as a font.
		 */
		const GLYPH_W = 5;
		const GLYPH_H = 7;

		const GLYPHS = {
			"0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
			"1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
			"2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
			"3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
			"4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
			"5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
			"6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
			"7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
			"8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
			"9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
			"-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
			".": ["00000", "00000", "00000", "00000", "00000", "00000", "00100"],
			" ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
		};

		const GLYPH_GAP = 1;

		function Glyph(props) {
			const dot = Math.max(2, Math.round((props.width - (GLYPH_W - 1) * GLYPH_GAP) / GLYPH_W));
			const rows = GLYPHS[props.ch] || GLYPHS[" "];
			const dots = [];
			for (let r = 0; r < GLYPH_H; r += 1) {
				const row = rows[r];
				for (let c = 0; c < GLYPH_W; c += 1) {
					const active = row.charAt(c) === "1";
					dots.push(
						h("span", {
							key: r * GLYPH_W + c,
							style: {
								position: "absolute",
								left: c * (dot + GLYPH_GAP) + "px",
								top: r * (dot + GLYPH_GAP) + "px",
								width: dot + "px",
								height: dot + "px",
								borderRadius: "50%",
								background: active ? solid(props.rgb) : OFF_SEG,
							},
						}),
					);
				}
			}
			return h(
				"span",
				{
					style: {
						position: "relative",
						display: "inline-block",
						width: GLYPH_W * dot + (GLYPH_W - 1) * GLYPH_GAP + "px",
						height: GLYPH_H * dot + (GLYPH_H - 1) * GLYPH_GAP + "px",
					},
				},
				dots,
			);
		}

		function DotMatrix(props) {
			const text = String(props.text === void 0 ? "" : props.text);
			const width = props.width || 21;
			const rgb = props.rgb || RAMP[2];
			const cells = [];
			for (let i = 0; i < text.length; i += 1) {
				cells.push(h(Glyph, { key: "g" + i, ch: text.charAt(i), width: width, rgb: rgb }));
			}
			return h("span", { style: { display: "inline-flex", alignItems: "flex-start", gap: "4px" } }, cells);
		}

		/** A small recessed window. Flat and quiet — the numerals are the signal. */
		function Readout(props) {
			return h(
				"span",
				{
					style: {
						display: "inline-block",
						padding: "2px 6px",
						border: "1px solid " + FACE_LINE,
						borderRadius: "2px",
						background: WELL,
						color: props.color || INK,
						fontSize: "12.5px",
						letterSpacing: "0.04em",
						fontVariantNumeric: "tabular-nums",
						whiteSpace: "nowrap",
					},
				},
				props.children,
			);
		}

		/** A labelled register row: field name, lamp bank, exact count. */
		function RegisterRow(props) {
			return h("div", { style: { display: "flex", alignItems: "center", gap: "6px", marginTop: props.first ? "0" : "5px" } }, [
				h(
					"span",
					{
						key: "label",
						style: { flex: "0 0 auto", width: props.labelWidth, color: INK_DIM, fontSize: "12px", letterSpacing: "0.04em", whiteSpace: "nowrap" },
					},
					props.label,
				),
				h("span", { key: "bar", style: { flex: "1 1 auto", minWidth: "0" } }, props.bar),
				h(
					"span",
					{
						key: "value",
						style: {
							flex: "0 0 auto",
							width: props.valueWidth,
							textAlign: "right",
							color: props.color,
							fontSize: "13px",
							fontVariantNumeric: "tabular-nums",
						},
					},
					props.value,
				),
			]);
		}

		/* ------------------------------------------------------------------ *
		 * The reactor core: one cell per settled request, newest first, each lit
		 * by that request's own cache-hit ratio and dimmed by age so the board
		 * carries a short history instead of a single number.
		 * ------------------------------------------------------------------ */

		/* How much history the board keeps. The grid itself decides how many
		 * columns fit the panel, so these are depths, not shapes. */
		const DENSITIES = [
			{ key: "s", rows: 4 },
			{ key: "m", rows: 6 },
			{ key: "l", rows: 9 },
		];

		const MIN_CELL = 17;
		const CELL_GAP = 5;
		/* Only ever used for the render that happens before the layout effect
		 * below can measure the real column count; React flushes that
		 * correction before the browser paints, so it is never what a user
		 * sees. A smaller guess keeps that intermediate render cheap. */
		const FALLBACK_COLUMNS = 24;

		function ReactorGrid(props) {
			const events = props.events;
			const maxRows = props.maxRows;
			const board = useRef(null);
			const [columns, setColumns] = useState(FALLBACK_COLUMNS);

			// The board draws one cell per recorded request and never a dead
			// socket, so it is only ever as tall as the history it holds. That
			// — not the colour — is what stopped a young session reading as a
			// half-drawn lattice. Capping the height needs the live column
			// count, which only the layout knows, so it is measured once and
			// the grid re-renders.
			useLayoutEffect(() => {
				const node = board.current;
				if (node === null || node === undefined) return undefined;
				const measure = () => {
					let next = 0;
					try {
						const tracks = window.getComputedStyle(node).gridTemplateColumns;
						if (typeof tracks === "string" && tracks !== "" && tracks !== "none") {
							next = tracks.trim().split(/\s+/).length;
						}
					} catch (error) {
						next = 0;
					}
					if (next > 0) setColumns((previous) => (previous === next ? previous : next));
				};
				measure();
				if (typeof ResizeObserver === "function") {
					const observer = new ResizeObserver(measure);
					observer.observe(node);
					return () => observer.disconnect();
				}
				window.addEventListener("resize", measure);
				return () => window.removeEventListener("resize", measure);
			}, []);

			const count = Math.min(events.length, maxRows * columns);
			let heaviest = 0;
			for (let i = 0; i < count; i += 1) {
				const volume = events[i].read + events[i].write + events[i].uncached;
				if (volume > heaviest) heaviest = volume;
			}
			const cells = [];
			for (let i = 0; i < count; i += 1) {
				const ev = events[i];
				const age = Math.min(1, i / Math.max(1, count - 1));
				const fade = 1 - 0.72 * age;

				const base = ev.read + ev.write + ev.uncached;
				const ratio = base > 0 ? clamp01(ev.read / base) : null;
				const rgb = ratio === null ? [138, 137, 133] : rampRGB(ratio);
				// Two channels, so the field is a map and not a counter:
				// ink = how much of the request was served from cache,
				// diameter = how big the request was against the heaviest
				// one on the board. sqrt keeps small requests visible.
				const share = heaviest > 0 ? Math.sqrt(base / heaviest) : 1;
				const size = 42 + 58 * share;
				cells.push(
					h(
						"span",
						{
							key: i,
							title:
								(ratio === null ? "n/a" : Math.round(ratio * 100) + "%") +
								" · read " +
								formatTokens(ev.read) +
								" / write " +
								formatTokens(ev.write) +
								" / uncached " +
								formatTokens(ev.uncached) +
								" / out " +
								formatTokens(ev.output),
							style: { aspectRatio: "1 / 1", display: "flex", alignItems: "center", justifyContent: "center" },
						},
						h("span", {
							style: {
								display: "block",
								width: size.toFixed(1) + "%",
								aspectRatio: "1 / 1",
								borderRadius: "50%",
								background: rgba(rgb, 0.1 + 0.72 * fade),
								// The newest request keeps a hairline ring, so the
								// eye can find the live edge of the sweep.
								boxShadow: i === 0 ? "0 0 0 1px rgba(242,240,235,0.42)" : "none",
								transition: "background 200ms linear, width 200ms linear",
							},
						}),
					),
				);
			}
			return h(
				"div",
				{
					ref: board,
					style: {
						display: "grid",
						// auto-fill lets the panel width choose the column count:
						// cells stay legible on a wide sidebar and the board
						// never turns into a handful of dinner plates.
						gridTemplateColumns: "repeat(auto-fill, minmax(" + MIN_CELL + "px, 1fr))",
						gap: CELL_GAP + "px",
						alignItems: "start",
					},
				},
				cells,
			);
		}

		function CoreLegend(props) {
			const stops = [];
			for (let i = 0; i < 16; i += 1) {
				const rgb = rampRGB(i / 15);
				stops.push(h("span", { key: i, style: { flex: "1 1 0", height: "5px", background: solid(rgb) } }));
			}
			return h("div", { style: { display: "flex", alignItems: "center", gap: "6px", marginTop: "8px" } }, [
				h("span", { key: "lo", style: { color: INK_DIM, fontSize: "10.5px", letterSpacing: "0.06em" } }, "0%"),
				h("span", { key: "bar", style: { flex: "1 1 auto", display: "flex", gap: "1px", borderRadius: "1px", overflow: "hidden", opacity: 0.55 } }, stops),
				h("span", { key: "hi", style: { color: INK_DIM, fontSize: "10.5px", letterSpacing: "0.06em" } }, "100%"),
			]);
		}

		/** The live chip title: the tab strip carries the current hit rate itself. */
		function TitleChip(props) {
			const totals = readTotals(props);
			const ratio = hitRatioOf(totals);
			// The chip rides in the tab strip, which follows the theme rather
			// than the instrument faces, so it inks itself with theme tokens —
			// a light-theme strip would swallow an off-white dot.
			const color = ratio === null ? T.idle : T.label;
			return h("span", { style: { display: "inline-flex", alignItems: "center", gap: "5px" } }, [
				h("span", {
					key: "lamp",
					style: {
						width: "6px",
						height: "6px",
						borderRadius: "50%",
						flex: "0 0 auto",
						background: color,
						opacity: ratio === null ? 0.45 : 1,
					},
				}),
				h("span", { key: "text" }, ratio === null ? "CACHE" : Math.round(ratio * 100) + "%"),
			]);
		}

		/**
		 * The age readout is the only thing on the panel that moves without new
		 * data, so it owns the clock itself. Ticking in Instrument instead would
		 * reconcile every cell, every lamp and every dot-matrix glyph once a
		 * second, forever, for one changing number.
		 *
		 * It also ticks at the resolution it actually prints — a panel whose last
		 * request was an hour ago has no reason to wake up every second — and
		 * arms no timer at all while there is nothing to count from.
		 */
		function LivedAge(props) {
			const from = numOf(props.at);
			const active = from > 0;
			const [now, setNow] = useState(() => Date.now());
			useEffect(() => {
				if (!active) return undefined;
				let timer = 0;
				const tick = () => {
					setNow(Date.now());
					const elapsed = Math.max(0, Date.now() - from);
					timer = setTimeout(tick, elapsed < 60000 ? 1000 : elapsed < 3600000 ? 5000 : 30000);
				};
				timer = setTimeout(tick, 1000);
				return () => clearTimeout(timer);
			}, [active, from]);
			if (!active) return null;
			return h(
				"span",
				{ style: { color: INK_DIM, fontSize: "10.5px", letterSpacing: "0.06em" } },
				formatAge(Math.max(0, Math.round((now - from) / 1000))),
			);
		}

		/* ------------------------------------------------------------------ *
		 * The instrument.
		 * ------------------------------------------------------------------ */

		/**
		 * Tab switches, docking changes and remounts all destroy this
		 * component's state, and the module outlives every one of them. Keyed
		 * by session and bounded, because a long-lived client can visit a lot
		 * of sessions and the recorded history is the whole point of the panel.
		 */
		const STORE_CACHE = new Map();
		const STORE_CACHE_MAX = 8;
		let DENSITY_CHOICE = "m";

		function rememberStore(next) {
			STORE_CACHE.delete(next.session);
			STORE_CACHE.set(next.session, next);
			while (STORE_CACHE.size > STORE_CACHE_MAX) {
				STORE_CACHE.delete(STORE_CACHE.keys().next().value);
			}
		}

		function Instrument(props) {
			const totals = readTotals(props);
			const pressure = readPressure(props);
			const sessionId = props === null || props === void 0 ? void 0 : props.sessionId;
			const t = typeof props.t === "function" ? props.t : boundT === null ? (key) => key : boundT;

			// The chosen depth is a preference, not per-mount state: a remount
			// must not silently drop the user back to the default board.
			const [density, setDensityState] = useState(DENSITY_CHOICE);
			const setDensity = (value) => {
				DENSITY_CHOICE = value;
				setDensityState(value);
			};
			const [store, setStoreState] = useState(() => {
				const cached = STORE_CACHE.get(sessionId);
				return cached === void 0 ? { session: sessionId, events: [], prev: null } : cached;
			});
			// Write through to the module cache after each committed change, so a
			// remount restores the session's history instead of an empty board.
			// This is an effect rather than work inside the updater: a reducer
			// must stay pure, and React may run it more than once.
			const setStore = setStoreState;
			useEffect(() => {
				rememberStore(store);
			}, [store]);

			// A changed snapshot means at least one request settled; the delta
			// against the previous snapshot IS that request's cache accounting.
			const signature =
				totals === null ? "none" : totals.read + ":" + totals.write + ":" + totals.uncached + ":" + totals.output;
			useEffect(() => {
				setStore((previous) => {
					if (previous.session !== sessionId) return { session: sessionId, events: [], prev: totals };
					if (previous.prev === null || totals === null) return { session: sessionId, events: previous.events, prev: totals };
					const delta = {
						read: Math.max(0, totals.read - previous.prev.read),
						write: Math.max(0, totals.write - previous.prev.write),
						uncached: Math.max(0, totals.uncached - previous.prev.uncached),
						output: Math.max(0, totals.output - previous.prev.output),
						at: Date.now(),
					};
					if (delta.read + delta.write + delta.uncached + delta.output <= 0) {
						return { session: sessionId, events: previous.events, prev: totals };
					}
					const events = previous.events.concat([delta]);
					return { session: sessionId, events: events.length > 512 ? events.slice(-512) : events, prev: totals };
				});
			}, [signature, sessionId]);

			// `events` is append-ordered: index 0 is the OLDEST settled request
			// and the tail is the newest. Every reader below wants newest-first,
			// so reverse once here and hand that view to the grid.
			const events = store.events.slice().reverse();
			const newest = events.length > 0 ? events[0] : null;
			const ratio = hitRatioOf(totals);
			const ratioRGB = ratio === null ? [138, 137, 133] : rampRGB(ratio);
			const promptTotal = promptTotalOf(totals);
			const lastAt = newest === null ? 0 : newest.at;

			// Register bank: the widest bucket fills its row, so the four rows
			// read as relative magnitudes inside one request stream.
			// Four rows, one colour. Telling the buckets apart is the label's
			// job; a private hue per row would say nothing the label does not
			// already say, at the cost of the board's composure.
			const buckets = totals === null ? [] : [
				{ key: "read", label: t("read"), value: totals.read, color: INK, rgb: INK_RGB },
				{ key: "write", label: t("write"), value: totals.write, color: INK, rgb: INK_RGB },
				{ key: "uncached", label: t("uncached"), value: totals.uncached, color: INK, rgb: INK_RGB },
				{ key: "output", label: t("output"), value: totals.output, color: INK, rgb: INK_RGB },
			];
			let bucketMax = 0;
			for (const bucket of buckets) bucketMax = Math.max(bucketMax, bucket.value);

			const LAMPS = 22;

			// The only red in the instrument, and the only place it appears: the
			// indicator that a request has settled. Red is an alert, not a
			// decoration, so it gets spent on exactly one fact — and the idle
			// state is a hollow socket rather than a coloured one.
			const statusLamp = h(
				"span",
				{ key: "status", style: { display: "inline-flex", alignItems: "center", gap: "6px" } },
				[
					h("span", {
						key: "lamp",
						style: {
							width: "7px",
							height: "7px",
							boxSizing: "border-box",
							borderRadius: "50%",
							background: newest === null ? "transparent" : RED,
							border: "1px solid " + (newest === null ? T.dim : RED),
							boxShadow: newest === null ? "none" : "0 0 4px " + RED,
						},
					}),
					h("span", { key: "text", style: { fontSize: "10.5px", letterSpacing: "0.1em" } }, newest === null ? t("idle") : t("live")),
				],
			);

			const header = h(
				"div",
				{
					key: "header",
					style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: "8px",
						padding: "1px 0 9px",
						borderBottom: "1px solid " + T.border,
					},
				},
				[
					h("span", { key: "name", style: { fontSize: "12px", letterSpacing: "0.14em", color: T.label } }, "CACHE HIT MONITOR"),
					statusLamp,
				],
			);

			const seatMissing =
				totals === null
					? h(Panel, { key: "seat", header: t("noSeat") }, [
							h("div", { key: "a", style: { color: INK_DIM, lineHeight: "1.6" } }, t("noSeatHint")),
							h("div", { key: "b", style: { color: INK_DIM, marginTop: "6px", fontSize: "12px" } }, "props.useProjection('tokenUsage')"),
						])
					: null;

			const hitPanel = h(Panel, { key: "hit", header: t("hitRate"), aside: t("basis"), glass: true, bodyStyle: { padding: "10px 8px 8px" } }, [
				h("div", { key: "row", style: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "8px" } }, [
					h("div", { key: "hero", style: { display: "flex", alignItems: "flex-end", gap: "4px" } }, [
						h(DotMatrix, { key: "seg", text: percentText(ratio), width: 34, rgb: ratioRGB }),
						h("span", { key: "pct", style: { color: INK, fontSize: "16px", lineHeight: "1.1", opacity: 0.75 } }, "%"),
					]),
					h("div", { key: "stack", style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", paddingBottom: "3px" } }, [
						h(Readout, { key: "req", color: CREAM }, t("requests") + " " + events.length),
						newest === null
							? h(Readout, { key: "last", color: INK_DIM }, t("last") + " --")
							: h(Readout, { key: "last", color: INK }, t("last") + " " + percentText(hitRatioOf(newest)) + "%"),
						h(LivedAge, { key: "age", at: lastAt }),
					]),
				]),
				h("div", { key: "bar", style: { marginTop: "10px" } }, h(Bar, {
					lamps: 28,
					height: 12,
					lit: ratio === null ? 0 : Math.round(ratio * 28),
					colorAt: () => solid(INK_RGB),
				})),
				h("div", { key: "scale", style: { display: "flex", justifyContent: "space-between", marginTop: "6px", color: INK_DIM, fontSize: "10.5px", letterSpacing: "0.06em" } }, [
					h("span", { key: "l" }, "0%"),
					h("span", { key: "m" }, formatTokens(promptTotal) + " " + t("prompt")),
					h("span", { key: "r" }, "100%"),
				]),
			]);

			const cold = totals !== null && events.length === 0
				? h(Panel, { key: "cold", header: t("waiting"), glass: true }, h("div", { style: { color: INK_DIM, lineHeight: "1.6" } }, t("waitingHint")))
				: null;

			const registerPanel = totals === null
				? null
				: h(Panel, { key: "reg", header: t("registers"), glass: true, bodyStyle: { padding: "9px 8px" } },
						buckets.map((bucket, index) =>
							h(RegisterRow, {
								key: bucket.key,
								first: index === 0,
								label: bucket.label,
								labelWidth: "88px",
								valueWidth: "68px",
								color: bucket.color,
								rgb: bucket.rgb,
								value: formatTokens(bucket.value),
								bar: h(Bar, {
									lamps: LAMPS,
									height: 11,
									lit: bucket.value <= 0 ? 0 : Math.max(1, Math.round(clamp01(bucket.value / bucketMax) * LAMPS)),
									colorAt: () => bucket.color,
								}),
							}),
						),
					);

			const densityOption = DENSITIES.reduce((found, item) => (item.key === density ? item : found), DENSITIES[1]);
			const corePanel = h(Panel, {
				key: "core",
				header: t("core"),
				aside: densityOption.rows + " " + t("rows"),
				glass: true,
				bodyStyle: { padding: "10px" },
			}, [
				events.length === 0
					? h("div", {
							key: "empty",
							style: {
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								minHeight: "88px",
								padding: "0 14px",
								textAlign: "center",
								lineHeight: "1.6",
								color: INK_DIM,
								fontSize: "12px",
							},
						}, t("coreEmpty"))
					: h(ReactorGrid, { key: "grid", maxRows: densityOption.rows, events: events }),
				h(CoreLegend, { key: "legend" }),
				// The hint gets its own line so it never wraps mid-phrase on a
				// narrow sidebar, and the controls keep a predictable row.
				h("div", { key: "foot", style: { display: "flex", flexDirection: "column", gap: "7px", marginTop: "10px" } }, [
					h("span", { key: "hint", style: { color: INK_DIM, fontSize: "11px", lineHeight: "1.5" } }, t("coreHint")),
					h("span", { key: "ctrls", style: { display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: "5px" } }, [
						h("span", { key: "lb", style: { color: INK_DIM, fontSize: "11px", marginRight: "3px" } }, t("depth")),
						...DENSITIES.map((item) =>
							h(
								"button",
								{
									key: item.key,
									type: "button",
									onClick: () => setDensity(item.key),
									// The visible label is a bare number, so the
									// accessible name has to carry the meaning.
									title: t("depth") + " " + item.rows,
									"aria-label": t("depth") + " " + item.rows,
									"aria-pressed": item.key === density,
									style: {
										border: "1px solid " + FACE_LINE,
										borderRadius: "2px",
										padding: "3px 8px",
										font: "inherit",
										fontSize: "11.5px",
										letterSpacing: "0.04em",
										cursor: "pointer",
										color: item.key === density ? INK : INK_DIM,
										background: item.key === density ? "rgba(255,255,255,0.10)" : "transparent",
									},
								},
								String(item.rows),
							),
						),
						h(
							"button",
							{
								key: "clr",
								type: "button",
								onClick: () => setStore((previous) => ({ session: previous.session, events: [], prev: previous.prev })),
								title: t("clear"),
								"aria-label": t("clear"),
								style: {
									border: "1px solid " + FACE_LINE,
									borderRadius: "2px",
									padding: "3px 8px",
									marginLeft: "4px",
									font: "inherit",
									fontSize: "11.5px",
									letterSpacing: "0.04em",
									cursor: "pointer",
									color: INK_DIM,
									background: "transparent",
								},
							},
							t("clear"),
						),
					]),
				]),
			]);

			const pressurePanel = pressure === null || pressure.pressure <= 0
				? null
				: h(Panel, { key: "pressure", header: t("pressure"), aside: pressure.window > 0 ? formatTokens(pressure.window) : null, glass: true, bodyStyle: { padding: "8px" } }, [
						h("div", { key: "top", style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" } }, [
							h("span", { key: "v", style: { color: INK, fontSize: "22px", letterSpacing: "0.02em", fontVariantNumeric: "tabular-nums" } }, formatTokens(pressure.pressure)),
							h(
								"span",
								{ key: "p", style: { color: INK_DIM, fontSize: "11px", letterSpacing: "0.04em" } },
								pressure.window > 0 ? trim1((pressure.pressure / pressure.window) * 100) + "% " + t("used") : "",
							),
						]),
						h("div", { key: "bar", style: { marginTop: "7px" } }, h(Bar, {
							lamps: 24,
							height: 10,
							lit:
								pressure.window > 0
									? Math.max(1, Math.round(clamp01(pressure.pressure / pressure.window) * 24))
									: Math.round(clamp01(pressure.pressure / 200000) * 24),
							colorAt: () => AMBER,
						})),
				  ]);

			return h(
				"div",
				{
					role: "region",
					"aria-label": "CACHE HIT MONITOR",
					style: {
						display: "flex",
						flexDirection: "column",
						gap: "10px",
						padding: "12px",
						boxSizing: "border-box",
						minHeight: "100%",
						overflowY: "auto",
						background: T.bgBase,
						color: T.label,
						fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, \"Liberation Mono\", monospace",
						fontSize: "12px",
						lineHeight: "1.45",
					},
				},
				[header, seatMissing, cold, hitPanel, registerPanel, corePanel, pressurePanel],
			);
		}

		/* ------------------------------------------------------------------ *
		 * Wiring. Two stages, as the sidebar-right contract requires: the tab
		 * TYPE first, then the body and the chip title keyed by its id.
		 * ------------------------------------------------------------------ */

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN }), "cache-hit-monitor: dictionaries");
			const t = ctx.locale.bind(NS);
			boundT = t;

			const handle = ctx.inject(["sidebarRightTabs"], (injected) => {
				const disposers = [];
				const own = (result) => {
					if (typeof result === "function") disposers.push(result);
				};
				try {
					const tabs = injected.sidebarRightTabs;
					if (tabs === void 0 || typeof tabs.register !== "function") return;
					own(
						tabs.register({
							id: TAB_ID,
							kind: TAB_KIND,
							// Without this the pane body is unmounted the moment the
							// user switches to another sidebar tab, and every bit of
							// recorded history goes with it.
							keepMounted: true,
							title: () => t("tab"),
							guide: [{ id: TAB_ID, order: GUIDE_ORDER, title: () => t("tab"), description: () => t("guide") }],
						}),
					);
					own(
						injected.slots.inject("sidebar.right.pane.tab", () =>
							injected.slots.register({ name: "sidebar.right.pane.tab", key: TAB_ID, locale: NS }, (props) => h(Instrument, props)),
						),
					);
					own(
						injected.slots.inject("sidebar.right.pane.tab.title", () =>
							injected.slots.register({ name: "sidebar.right.pane.tab.title", key: TAB_ID }, TitleChip),
						),
					);
				} catch (error) {
					for (const dispose of disposers) dispose();
					console.error("[cache-hit-monitor] tab registration failed", error);
					return;
				}
				return () => {
					for (const dispose of disposers) dispose();
				};
			});

			// Reveal the instrument once per page load so the panel is on screen
			// without hunting through the tab guide; the seat mounts asynchronously,
			// so a few attempts are made before giving up quietly.
			ctx.effect(() => {
				const timers = [];
				let settled = false;
				const attempt = () => {
					if (settled) return;
					const engine = ctx.get("sidebarRight");
					if (engine === void 0 || typeof engine.openTab !== "function") return;
					let sessionId;
					try {
						sessionId = engine.mounted ? engine.mounted.get() : void 0;
					} catch (_error) {
						return;
					}
					if (sessionId === void 0) return;
					settled = true;
					try {
						const open = typeof engine.tabsIn === "function" ? engine.tabsIn(sessionId) : [];
						if (Array.isArray(open) && open.some((tab) => tab && tab.kind === TAB_KIND)) return;
						engine.openTab(TAB_KIND);
					} catch (error) {
						console.error("[cache-hit-monitor] reveal failed", error);
					}
				};
				timers.push(setTimeout(attempt, 800));
				timers.push(setTimeout(attempt, 2500));
				timers.push(setTimeout(attempt, 6000));
				return () => {
					settled = true;
					for (const id of timers) clearTimeout(id);
				};
			}, "cache-hit-monitor: reveal");

			return () => {
				handle?.dispose?.();
			};
		}

		module.exports = {
			name: "dsh-cache-hit-monitor",
			inject: ["slots", "locale"],
			apply,
		};
		return module.exports;
	},
});
