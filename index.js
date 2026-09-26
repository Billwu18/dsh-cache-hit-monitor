/**
 * Host half of the Cache Hit Monitor bundle.
 *
 * The instrument is pure presentation, and everything it presents is already
 * computed on the Host: `@deepseek-ai/dsh-token-meter` folds the durable
 * session log into the `tokenUsage` and `contextPressure` session projections
 * and publishes them to the Client through their `wire.view`. The Client half
 * reads those values from its slot props, so this half owns no service, no
 * route and no state — it exists so the bundle has a Loader row and can be
 * enabled, disabled and inspected like any other plugin.
 */
export function apply() {}
