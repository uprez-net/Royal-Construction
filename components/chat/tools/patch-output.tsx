import {
  ProjectScopePatch,
  StringListPatch,
  TermsAndConditionsPatch,
} from "@/utils/chat";

function isStringListPatch(
  patch: TermsAndConditionsPatch | ProjectScopePatch | StringListPatch,
): patch is StringListPatch {
  return (
    patch.add === undefined ||
    patch.add.length === 0 ||
    typeof patch.add[0] === "string"
  );
}

function isTermsPatch(
  patch: TermsAndConditionsPatch | ProjectScopePatch | StringListPatch,
): patch is TermsAndConditionsPatch {
  return "removeTitles" in patch || "reorderTitles" in patch;
}

function isProjectScopePatch(
  patch: TermsAndConditionsPatch | ProjectScopePatch | StringListPatch,
): patch is ProjectScopePatch {
  return "removeIds" in patch || "reorderIds" in patch;
}

export function renderPatchItems(
  patch?: TermsAndConditionsPatch | ProjectScopePatch | StringListPatch,
) {
  if (!patch) return null;

  return (
    <section>
      <div className="space-y-4">
        {isStringListPatch(patch) && (
          <>
            {(patch.add?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <h5 className="font-medium text-foreground">Added</h5>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {patch.add?.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {(patch.remove?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <h5 className="font-medium text-foreground">Removed</h5>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {patch.remove?.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {isTermsPatch(patch) && (
          <>
            {(patch.add?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <h5 className="font-medium text-foreground">Added</h5>
                {patch.add?.map((item) => (
                  <div key={item.title} className="mt-2">
                    <p className="font-medium text-foreground">{item.title}</p>
                    <p className="mt-1 whitespace-pre-wrap">{item.description}</p>
                  </div>
                ))}
              </div>
            )}

            {(patch.update?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <h5 className="font-medium text-foreground">Updated</h5>
                {patch.update?.map((item) => (
                  <div key={item.title} className="mt-2">
                    <p className="font-medium text-foreground">{item.title}</p>
                    <p className="mt-1 whitespace-pre-wrap">{item.description}</p>
                  </div>
                ))}
              </div>
            )}

            {(patch.removeTitles?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <h5 className="font-medium text-foreground">Removed</h5>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {patch.removeTitles?.map((title) => (
                    <li key={title}>{title}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {isProjectScopePatch(patch) && (
          <>
            {(patch.add?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <h5 className="font-medium text-foreground">Added</h5>
                {patch.add?.map((item) => (
                  <div key={item.id} className="mt-2">
                    <p className="font-medium text-foreground">{item.sectionTitle}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {item.items.map((subItem, subIndex) => (
                        <li key={subIndex}>{subItem}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {(patch.update?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <h5 className="font-medium text-foreground">Updated</h5>
                {patch.update?.map((item) => (
                  <div key={item.id} className="mt-2">
                    <p className="font-medium text-foreground">{item.sectionTitle}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {item.items.map((subItem, subIndex) => (
                        <li key={subIndex}>{subItem}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {(patch.removeIds?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <h5 className="font-medium text-foreground">Removed IDs</h5>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {patch.removeIds?.map((id) => (
                    <li key={id}>{id}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {patch.clear && (
          <p className="text-destructive">All items were removed.</p>
        )}
      </div>
    </section>
  );
}
