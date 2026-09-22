import { defineConfig } from "vitest/config";

// Vitest replaced `tsx --test` here (issue #326). The suite is Node/domain and
// source-contract testing, not browser testing, and the runner swap was not
// allowed to change what any of it asserts. The settings below are the rules
// the old runner gave us for free, written down, because losing one of them
// quietly is how a green suite stops meaning anything.

// The test files that drive a real Chromium through Puppeteer. They are their
// own project, kept out of `test:unit`, because CI sets PUPPETEER_SKIP_DOWNLOAD
// and installs no browser — see .github/workflows/quality.yml. They are run
// deliberately with `pnpm test:print`, and they fail loudly rather than skipping
// when Chromium is missing: a print test that quietly skips is how a "the footer
// says 10 pages, Chromium prints 11" bug reaches a client.
//
// This array is the only copy of the list.
// tests/architecture/test-runner-contract.test.ts reads it back out of this
// file and proves no third test has started launching a browser.
const PRINT_TESTS = [
  "tests/offer/offer-document-print-pages.test.ts",
  "tests/offer/offer-tender-print-parity.test.ts",
];

const shared = {
  // The suite tests Node and domain code. No jsdom: the React tests render with
  // renderToStaticMarkup, which is server rendering, and the print tests use a
  // real browser.
  environment: "node" as const,
  // Explicit imports, as every file already writes them.
  globals: false,
  // One process per file, which is what Node's runner gave us and what this
  // suite needs: it imports Prisma, spawns child processes, mutates
  // `process.env` and launches a browser.
  pool: "forks" as const,
  isolate: true,
  // No `maxWorkers`: Vitest's default (one fork per core, less one) is left to
  // size itself to whatever runs it. Measured on 16 cores, the unit project
  // takes 77s at one worker, 41s at two, 23s at four, 16s at eight and 15s at
  // sixteen — it scales cleanly and flattens out, so there is nothing to win by
  // pinning a number that would then be wrong on a two-core CI runner. Repeated
  // runs at one worker and at the default agree test-for-test.
  // Tests within a file stay sequential unless one opts in. None do today, and
  // the env-mutating files in tests/graph and tests/compliance would break if
  // one did.
  sequence: { concurrent: false },
  // Node's runner had NO test timeout. Vitest defaults to 5s, which is under
  // the 6.4s the slowest Chromium print test takes. These exist to stop a hung
  // run, not to police speed — keep them generous.
  testTimeout: 60_000,
  hookTimeout: 60_000,
};

export default defineConfig({
  // The `@/*` alias, read from tsconfig.json rather than repeated here.
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        test: {
          ...shared,
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: PRINT_TESTS,
        },
      },
      {
        test: {
          ...shared,
          name: "print",
          include: PRINT_TESTS,
          // One Chromium at a time. Each file keeps a single shared browser and
          // closes it in afterAll; running the two files in parallel doubles
          // the memory for no gain.
          fileParallelism: false,
          testTimeout: 180_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
