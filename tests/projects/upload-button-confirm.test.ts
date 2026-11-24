import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

// The prior-compliance rows, the HBCF certificate and the project header hand
// the id from `onUpload` straight to a server call that needs the File row.
// Left to Blob's `onUploadCompleted` webhook, that row arrives late on a cold
// start and the call fails with "file not found".
test("a project upload is confirmed before onUpload sees its id", () => {
  const source = readFileSync(
    join(REPO_ROOT, "components/common/upload-button.tsx"),
    "utf8",
  );
  // The webhook skips a project-file upload, so there is one writer.
  assert.match(source, /uploadType: "project-file"/);
  assert.match(source, /await completeProjectUpload\(/);
  // The confirmation runs before the file is returned to the caller.
  assert.ok(
    source.indexOf("await completeProjectUpload(")
      < source.indexOf("satisfies DBFile"),
  );
});
