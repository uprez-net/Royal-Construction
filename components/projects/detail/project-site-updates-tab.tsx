import type { ProjectDetail } from "@/types/project";
import { Button } from "@/components/ui/button";
import { Plus, User, Bell } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { dataTimeFormat } from "../../../utils/formatters";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import Image from "next/image";

export function ProjectSiteUpdatesTab({ project }: { project: ProjectDetail }) {
  const siteUpdates = project.siteUpdates;
  const dispatch = useAppDispatch();

  return (
    <SectionCard
      title="Site Manager Updates"
      action={
        <Button
          size="sm"
          className="h-8 rounded-md bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700"
          onClick={() =>
            dispatch(openModal({ type: "addUpdate", payload: { project } }))
          }
        >
          <Plus className="mr-1 size-3.5" />
          Add Update
        </Button>
      }
    >
      <div className="space-y-3" key={siteUpdates.length}>
        {siteUpdates.map((update) => (
          <div
            key={update.id}
            className="relative overflow-hidden rounded-xl border border-border/70 bg-card p-4 transition-all hover:shadow-sm"
          >
            <div className="absolute bottom-0 left-0 top-0 w-1 bg-green-600" />

            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-sm font-bold">{update.notes}</h4>
                <div className="flex items-center gap-3 pt-1 text-xs text-muted-foreground/80">
                  <span className="flex items-center">
                    <User className="mr-1 size-3.5" />
                    {update.author.name} —{" "}
                    {dataTimeFormat.format(new Date(update.createdAt))}
                  </span>
                  <span className="flex items-center">
                    {update.photoUrls.length} photos
                  </span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 px-2 text-[11.5px]"
              >
                <Bell className="mr-1.5 size-3" />
                Notify
              </Button>
            </div>

            {update.photoUrls.length > 0 && (
              <div className="mt-3 grid grid-cols-4 gap-1.5">
                {Array.from({
                  length: Math.min(update.photoUrls.length, 4),
                }).map((_, i) => (
                  <div
                    key={i}
                    className="h-48 w-48 group relative flex aspect-4/3 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-border/50 bg-muted/50 text-xs text-muted-foreground transition-colors hover:border-teal-600 hover:text-teal-600"
                    onClick={() =>
                      dispatch(
                        openModal({
                          type: "viewPicture",
                          payload: { imageUrl: update.photoUrls[i] },
                        }),
                      )
                    }
                  >
                    <Image
                      src={update.photoUrls[i]}
                      alt={`Photo ${i + 1}`}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      loading="lazy"
                      width={800}
                      height={600}
                    />
                  </div>
                ))}
                {update.photoUrls.length > 4 && (
                  <div className="flex aspect-4/3 cursor-pointer items-center justify-center rounded-md border border-border/50 bg-muted/50 text-xs font-medium text-muted-foreground transition-colors hover:border-teal-600 hover:text-teal-600">
                    +{update.photoUrls.length - 4}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
