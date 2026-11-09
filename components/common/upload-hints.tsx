"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import {
  joinFileOrigin,
  normalizeFileTags,
  type FileUploadHints,
} from "@/lib/domain/file-tags";

/**
 * Upload hints: what a file was uploaded for, captured from the screen it was
 * uploaded on rather than asked of the person uploading it.
 *
 * A screen wraps a region in `UploadHintScope` with a step of the trail
 * ("Project", then "Compliance") and the tags that region implies. Scopes nest,
 * so an upload deep inside the Compliance tab carries both without the control
 * knowing where it sits. The control then adds what only it knows — which
 * checklist line, which milestone — when it uploads.
 *
 * Modals render from the root ModalManager, outside every page scope, so a
 * modal names its whole trail itself.
 */

type Hint = string | null | undefined | false;

type UploadHintState = {
  readonly tags: readonly string[];
  readonly trail: readonly string[];
};

const EMPTY: UploadHintState = { tags: [], trail: [] };

const UploadHintContext = createContext<UploadHintState>(EMPTY);

function present(values: readonly Hint[] | undefined): string[] {
  return (values ?? []).filter(
    (value): value is string => typeof value === "string" && !!value.trim(),
  );
}

export function UploadHintScope({
  trail,
  tags,
  children,
}: {
  /** One or more steps this region adds to the origin trail. */
  trail?: Hint | readonly Hint[];
  tags?: readonly Hint[];
  children: ReactNode;
}) {
  const parent = useContext(UploadHintContext);
  const steps = present(Array.isArray(trail) ? trail : [trail as Hint]);
  const ownTags = present(tags);
  // Keyed on content: callers pass fresh array literals on every render.
  const stepsKey = steps.join("\u0000");
  const tagsKey = ownTags.join("\u0000");

  const value = useMemo<UploadHintState>(
    () => ({
      tags: [...parent.tags, ...(tagsKey ? tagsKey.split("\u0000") : [])],
      trail: [...parent.trail, ...(stepsKey ? stepsKey.split("\u0000") : [])],
    }),
    [parent, stepsKey, tagsKey],
  );

  return (
    <UploadHintContext.Provider value={value}>
      {children}
    </UploadHintContext.Provider>
  );
}

export type UploadHintExtras = {
  tags?: readonly Hint[];
  trail?: readonly Hint[];
  /**
   * The trail is complete on its own. For a modal that can open both from the
   * root ModalManager and inline inside a page scope, so it reads the same
   * either way instead of naming the page twice.
   */
  rootTrail?: boolean;
};

/** The scope's hints plus a control's own. Pure, for tests and non-hook code. */
export function resolveUploadHints(
  scope: UploadHintState,
  extra: UploadHintExtras = {},
): FileUploadHints {
  return {
    tags: normalizeFileTags(scope.tags, present(extra.tags)),
    origin: joinFileOrigin([
      ...(extra.rootTrail ? [] : scope.trail),
      ...present(extra.trail),
    ]),
  };
}

/**
 * Returns a function that resolves this position's hints, plus whatever the
 * control adds at the moment of upload, into the payload fields.
 */
export function useUploadHints() {
  const scope = useContext(UploadHintContext);
  return useCallback(
    (extra?: UploadHintExtras) => {
      const hints = resolveUploadHints(scope, extra);
      return { tags: [...hints.tags], origin: hints.origin };
    },
    [scope],
  );
}
