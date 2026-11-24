/**
 * Optional eve default tools that a declared specialist must not have.
 *
 * eve 0.64.1 gives every declared subagent these (framework/sources/registry.js,
 * applyTo "all-local-nodes"). A defineDynamic subagent cannot turn them off with
 * defaultTools (its runtime config rejects that field), so each one is removed
 * by an authored disableTool() in the subagent's own tools/ directory.
 *
 * load_skill is listed since #619: the specialists carry their procedures and
 * the office handbook as instructions, so there is nothing to load, and 31 of
 * 77 production turns had spent a model call or two loading them anyway.
 *
 * Not listed: ask_question, because removing it would change how a specialist asks a
 * clarifying question and that path has no live eval yet; and task_cancel,
 * which eve already hides from a child session.
 *
 * Why remove the rest: no specialist uses them, a staging run saw
 * tradie-operations reach for bash instead of its own search tool, and
 * web_fetch/web_search would let text a client typed into a public form steer
 * a fetch or a third-party search.
 */
export const DISABLED_DEFAULT_TOOLS = [
  "bash",
  "load_skill",
  "read_file",
  "todo",
  "web_fetch",
  "web_search",
  "write_file",
] as const;

export const DISABLED_DEFAULT_TOOL_FILES: ReadonlySet<string> = new Set(
  DISABLED_DEFAULT_TOOLS.map((tool) => `${tool}.ts`),
);
