"use client";

import { Loader2, MapPinned, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  complianceScope,
  selectComplianceMutation,
  setEstateDeveloper,
} from "@/lib/store/slices/projectsSlice";

/**
 * The one question about this job that nothing on the file can answer.
 *
 * Land released in a master-planned estate routinely carries a covenant: the
 * developer's own consultant approves the architectural design and the bushfire
 * assessment before either goes to a council or a certifier. It is on the contract
 * of sale. A title search does not say, a 10.7 does not say, and the estate list in
 * `constants/complianceDevelopers.ts` says which developer to ask rather than
 * whether asking is required.
 *
 * So it has to be asked, and the question used to be asked in one place: a yes/no
 * inside the development application block, several screens down, on a card that
 * only exists once a job has gone down the DA path. Two things were wrong with
 * that. A CDC job never saw it at all, and the covenant binds a CDC exactly as
 * hard. And by the time anybody read it the architect had already drawn a design
 * nobody had told the estate about.
 *
 * Hence a banner, at the top, asked once at the start of the engagement — which is
 * also when somebody has the contract of sale open. It disappears the moment it is
 * answered, whether from here, from the block below, or from the land deed being
 * parsed on upload; the answer is one column, so all three close it for good.
 *
 * Dismissible without answering, deliberately. A prompt that cannot be got rid of
 * is a prompt people work around, and the question is not urgent on the day the
 * engagement opens — the gates downstream are what make it urgent, and they have
 * their own sentences. Dismissal is local to the render and comes back next visit,
 * because nothing about "I will do this later" is a fact about the job.
 */

type EstateDeveloperBannerProps = {
  projectId: string;
  /** The site address, so the question names the lot being asked about. */
  address: string;
};

export function EstateDeveloperBanner({
  projectId,
  address,
}: EstateDeveloperBannerProps) {
  const dispatch = useAppDispatch();
  const mutation = useAppSelector(
    selectComplianceMutation(complianceScope.developer),
  );
  const isSaving = mutation.status === "pending";

  /**
   * Which of the three things this banner is showing.
   *
   * `asking` is the question, `details` is the form a yes opens, and `dismissed`
   * is somebody putting it off. Local state, and none of it is persisted — see the
   * note above about dismissal.
   */
  const [step, setStep] = useState<"asking" | "details" | "dismissed">(
    "asking",
  );

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  if (step === "dismissed") return null;

  const save = async (
    required: boolean,
    details?: { name: string; email: string; phone: string },
  ) => {
    try {
      await dispatch(
        setEstateDeveloper({
          projectId,
          required,
          name: details?.name.trim() || undefined,
          email: details?.email.trim() || undefined,
          phone: details?.phone.trim() || undefined,
        }),
      ).unwrap();
      toast.success(
        required
          ? "Recorded — the developer's approval is now part of this file."
          : "Recorded — no developer approval needed on this lot.",
      );
      // Nothing to reset. The answer clears `developerApprovalRequired` from null,
      // and the caller stops rendering this banner entirely.
    } catch (error) {
      toast.error(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Could not record that answer.",
      );
    }
  };

  return (
    <div className="relative rounded-xl border border-primary/40 bg-primary/5 px-4 py-3.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 size-7 text-muted-foreground"
        aria-label="Ask me later"
        disabled={isSaving}
        onClick={() => setStep("dismissed")}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>

      <div className="flex items-start gap-3 pr-8">
        <MapPinned
          className="mt-0.5 size-4 shrink-0 text-primary"
          aria-hidden="true"
        />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            Is {address} in an estate with a developer?
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Land released in a master-planned estate usually carries a covenant:
            the developer has to approve the architectural design and the bushfire
            report before anything is lodged. It is on the contract of sale —
            nothing else on this file will say. Answering now is what stops the
            plans being drawn and lodged without their sign-off.
          </p>

          {step === "asking" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={isSaving}
                onClick={() => setStep("details")}
              >
                Yes — add the developer
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isSaving}
                onClick={() => void save(false)}
              >
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                No developer on this lot
              </Button>
            </div>
          ) : (
            <form
              className="mt-3 space-y-3 rounded-lg border border-border/70 bg-background p-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim()) return;
                void save(true, { name, email, phone });
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="estate-developer-name">
                  Developer or estate company
                </Label>
                <Input
                  id="estate-developer-name"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="As the contract of sale names them"
                  disabled={isSaving}
                  required
                />
              </div>

              {/* The address is optional, and that is not laziness.
                  An estate's approvals address is on the covenant paperwork
                  rather than published, and a wrong one is much worse than a
                  blank one: the request appears to have been sent, the clock
                  starts, and eleven working days later the file is chasing a
                  bounce nobody read. The send is what insists on an address;
                  recording who they are does not have to wait for it. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="estate-developer-email">
                    Approvals email{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="estate-developer-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="From the covenant paperwork"
                    disabled={isSaving}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="estate-developer-phone">
                    Phone{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="estate-developer-phone"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    disabled={isSaving}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSaving || !name.trim()}
                >
                  {isSaving ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  Save the developer
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isSaving}
                  onClick={() => setStep("asking")}
                >
                  Back
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Leave the address blank if you do not have it yet — it can be
                filled in before the plans go over. Uploading the land deed will
                also fill this in on its own, if nobody has answered first.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
