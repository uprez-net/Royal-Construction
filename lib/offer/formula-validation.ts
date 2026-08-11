import { parse, evaluate } from "mathjs";

// Supported-function allowlist. MathJS exposes hundreds of functions; we permit
// the safe, pricing-relevant subset and reject anything else so an admin can't
// author a formula that silently calls `import`/`evaluate`/`simplify` or some
// other function with surprising side effects. Anything in this list must
// correspond to a real MathJS function (verified — see lib/offer/formula-variables).
export const SUPPORTED_FORMULA_FUNCTIONS: ReadonlySet<string> = new Set([
  "min", "max", "round", "ceil", "floor", "fix", "sqrt", "abs", "pow",
  "log", "log10", "log2", "exp", "sign",
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "sinh", "cosh", "tanh",
  "gcd", "lcm", "mod", "hypot",
  "mean", "median", "sum", "std", "variance",
]);

// MathJS parses these as bare SymbolNodes but resolves them to constant values
// at evaluate time — they are NOT variables and must not be flagged unknown.
export const MATH_CONSTANT_NAMES: ReadonlySet<string> = new Set([
  "pi", "e", "tau", "phi", "E", "PI", "i", "NaN", "Infinity",
  "true", "false", "null",
]);

export type FormulaValidation = {
  valid: boolean;
  error: string | null;
  /** Symbol names referenced in the formula that aren't in the provided
   * `variables` list and aren't math constants. Empty when valid. */
  unknownVariables: string[];
  /** Function names referenced that aren't in SUPPORTED_FORMULA_FUNCTIONS.
   * Empty when valid. */
  unsupportedFunctions: string[];
  /** Live preview result, or null if it couldn't be computed. Only populated
   * when `sampleValues` is provided and the formula evaluates to a finite
   * number. */
  preview: number | null;
};

const VALID: FormulaValidation = {
  valid: true,
  error: null,
  unknownVariables: [],
  unsupportedFunctions: [],
  preview: null,
};

export function validateFormula(
  formula: string,
  variables: readonly string[],
  sampleValues?: Record<string, number>,
): FormulaValidation {
  const trimmed = formula.trim();
  if (!trimmed) {
    return { ...VALID, valid: false, error: "Formula is empty." };
  }

  let node;
  try {
    node = parse(trimmed);
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Syntax error.",
      unknownVariables: [],
      unsupportedFunctions: [],
      preview: null,
    };
  }

  const knownVariables = new Set(variables);

  // Walk the parsed tree collecting symbol + function names. A FunctionNode's
  // `.fn` child is itself a SymbolNode (it carries the function name), so we
  // skip any SymbolNode whose parent is a FunctionNode — otherwise the
  // function name would be double-counted as an unknown variable.
  type MathNode = {
    type: string;
    name?: string;
    fn?: { name: string };
    args?: readonly MathNode[];
    forEach?: (cb: (child: MathNode, path: string, parent: MathNode) => void) => void;
  };
  const root = node as unknown as MathNode;

  const symbolNames = new Set<string>();
  const functionNames = new Set<string>();

  const visit = (n: MathNode, parent: MathNode | null) => {
    if (n.type === "FunctionNode") {
      if (n.fn) functionNames.add(n.fn.name);
      n.args?.forEach((arg) => visit(arg, n));
      return;
    }
    if (n.type === "SymbolNode") {
      // Skip if this is the `fn` of a FunctionNode (handled above).
      if (parent?.type === "FunctionNode" && parent.fn === n) return;
      if (n.name) symbolNames.add(n.name);
      return;
    }
    // Other node types (OperatorNode, ConstantNode, ParenthesisNode, …) just
    // recurse into their children via forEach.
    n.forEach?.((child) => visit(child, n));
  };
  visit(root, null);

  const unknownVariables = Array.from(symbolNames).filter(
    (name) => !knownVariables.has(name) && !MATH_CONSTANT_NAMES.has(name),
  );
  const unsupportedFunctions = Array.from(functionNames).filter(
    (name) => !SUPPORTED_FORMULA_FUNCTIONS.has(name),
  );

  if (unknownVariables.length > 0) {
    return {
      valid: false,
      // Report one at a time so the message stays actionable.
      error: `Unknown variable "${unknownVariables[0]}"`,
      unknownVariables,
      unsupportedFunctions,
      preview: null,
    };
  }

  if (unsupportedFunctions.length > 0) {
    return {
      valid: false,
      error: `Function "${unsupportedFunctions[0]}()" is not supported`,
      unknownVariables,
      unsupportedFunctions,
      preview: null,
    };
  }

  // Preview evaluation: feed the union of known variables + sample values.
  // Using 1 as a stand-in for any variable missing from `sampleValues` keeps
  // the preview honest about *validity* without faking a project-specific
  // figure. If no sampleValues are provided at all we skip the preview.
  let preview: number | null = null;
  if (sampleValues) {
    const scope: Record<string, number> = {};
    for (const v of variables) scope[v] = sampleValues[v] ?? 1;
    for (const c of MATH_CONSTANT_NAMES) scope[c] = sampleValues[c] ?? 1;
    try {
      const result = evaluate(trimmed, scope);
      if (typeof result === "number" && Number.isFinite(result)) {
        preview = result;
      } else if (result !== undefined) {
        return {
          valid: false,
          error: "Formula does not evaluate to a number.",
          unknownVariables,
          unsupportedFunctions,
          preview: null,
        };
      }
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : "Evaluation failed.",
        unknownVariables,
        unsupportedFunctions,
        preview: null,
      };
    }
  }

  return {
    valid: true,
    error: null,
    unknownVariables: [],
    unsupportedFunctions: [],
    preview,
  };
}

// Convenience check used by callers that only need a boolean (e.g. the cost
// schedule screen disabling its Save button when any formula row is invalid).
export function isFormulaValid(
  formula: string,
  variables: readonly string[],
): boolean {
  return validateFormula(formula, variables).valid;
}