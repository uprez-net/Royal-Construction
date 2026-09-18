/**
 * Keeping a section form in step with a lead that changed underneath it.
 *
 * The lead detail page edits one lead from two places at once: the header badge
 * writes the stage on its own, and the overview sections each save
 * independently. The overview form seeded its state from the lead once, at
 * mount, and never moved again — so after a header stage change the Source and
 * stage section still showed the stage the page had loaded with, flagged itself
 * `Unsaved`, and offered a Save primed to write that stale stage back over the
 * new one. On staging: a QUOTED lead with a Save that would have written
 * DISCOVERY.
 *
 * Re-seeding the whole form would fix that and lose anything half-typed in
 * another section, which is the same trade `handleSectionSave` already refuses
 * to make when it re-seeds only the fields a save actually wrote.
 */

/**
 * `current` advanced to `nextBaseline`, keeping the operator's own edits.
 *
 * A field is adopted only when the form still holds what the PREVIOUS baseline
 * gave it — that is what "the operator has not touched this" means. A field
 * they have edited is left alone, so a write from elsewhere on the page cannot
 * discard it.
 *
 * Returns `current` unchanged when nothing moved, so a caller can use the
 * identity of the result to decide whether to re-render.
 *
 * Every tracked field must be a primitive: identity is the test for "touched",
 * and a freshly-mapped array or object would compare unequal every time and so
 * read as permanently edited.
 */
export function rebaseTrackedFields<T extends object>(
  current: T,
  previousBaseline: T,
  nextBaseline: T,
  trackedFields: readonly (keyof T)[],
): T {
  let changed = false;
  const next = { ...current };

  for (const field of trackedFields) {
    const untouched = Object.is(current[field], previousBaseline[field]);
    const alreadyCorrect = Object.is(current[field], nextBaseline[field]);
    if (untouched && !alreadyCorrect) {
      next[field] = nextBaseline[field];
      changed = true;
    }
  }

  return changed ? next : current;
}
