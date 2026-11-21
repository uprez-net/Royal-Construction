import js from "@eslint/js";
import tseslint from "typescript-eslint";

// The bridge's own lint, apart from the Next.js app's (which ignores
// services/). Type-aware for TypeScript, because the mistakes worth catching
// here are the async ones: a promise nobody awaits or catches can take the
// process down.
export default tseslint.config(
  { ignores: ["dist/**", "data/**", "coverage/**", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      // Fakes implement async interfaces without awaiting anything.
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
);
