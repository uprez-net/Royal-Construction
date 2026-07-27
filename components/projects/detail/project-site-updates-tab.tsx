import type { ProjectDetail } from "@/types/project";
import { Button } from "@/components/ui/button";
import { Plus, User, ClipboardList } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import Image from "next/image";

import { dataTimeFormat } from "@/utils/formatters";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";

const VISIBLE_PHOTOS = 4;

export function ProjectSiteUpdatesTab({ project }: { project: ProjectDetail }) {
  const siteUpdates = project.siteUpdates;
  const dispatch = useAppDispatch();

  return (
    <SectionCard
      title="Site manager updates"
      action={
        <Button
          size="sm"
          className="h-8 rounded-md px-3 text-xs font-medium"
          onClick={() =>
            dispatch(openModal({ type: "addUpdate", payload: { project } }))
          }
        >
          <Plus className="mr-1 size-3.5" aria-hidden="true" />
          Add update
        </Button>
      }
    >
      {siteUpdates.length === 0 ? (
        <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-8 text-center">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-muted">
            <ClipboardList
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
          </div>

          <p className="text-base font-semibold text-foreground">
            No site updates posted yet
          </p>

          <p className="text-sm text-muted-foreground">
            Use Add update to post progress notes and site photos against a
            milestone.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {siteUpdates.map((update) => {
            const photoCount = update.photoUrls.length;
            const visiblePhotos = update.photoUrls.slice(0, VISIBLE_PHOTOS);
            const hiddenPhotoCount = photoCount - visiblePhotos.length;

            return (
              <li
                key={update.id}
                className="rounded-xl border border-border/70 bg-card p-4"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {update.notes}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
                    <span className="flex items-center">
                      <User className="mr-1 size-3.5" aria-hidden="true" />
                      {update.author.name} —{" "}
                      <span className="ml-1 font-mono tabular-nums">
                        {dataTimeFormat.format(new Date(update.createdAt))}
                      </span>
                    </span>
                    <span>
                      {photoCount === 1 ? "1 photo" : `${photoCount} photos`}
                    </span>
                  </div>
                </div>

                {photoCount > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {visiblePhotos.map((photoUrl, index) => (
                      <button
                        key={`${update.id}-photo-${index}`}
                        type="button"
                        aria-label={`View photo ${index + 1} of ${photoCount} from this update`}
                        className="relative flex aspect-4/3 w-full items-center justify-center overflow-hidden rounded-md border border-border/50 bg-muted/50 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onClick={() =>
                          dispatch(
                            openModal({
                              type: "viewPicture",
                              payload: { imageUrl: photoUrl },
                            }),
                          )
                        }
                      >
                        <Image
                          src={photoUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                          width={800}
                          height={600}
                        />
                      </button>
                    ))}

                    {hiddenPhotoCount > 0 && (
                      // The picture modal shows one image at a time, so this
                      // opens photo VISIBLE_PHOTOS + 1 rather than a gallery.
                      // The label has to say that; the visible text is only a
                      // count of how many photos the grid is hiding.
                      <button
                        type="button"
                        aria-label={`View photo ${visiblePhotos.length + 1} of ${photoCount} from this update (${hiddenPhotoCount} not shown)`}
                        className="flex aspect-4/3 w-full items-center justify-center rounded-md border border-border/50 bg-muted/50 text-xs font-medium text-muted-foreground transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onClick={() =>
                          dispatch(
                            openModal({
                              type: "viewPicture",
                              payload: {
                                imageUrl:
                                  update.photoUrls[visiblePhotos.length],
                              },
                            }),
                          )
                        }
                      >
                        {hiddenPhotoCount} more
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
