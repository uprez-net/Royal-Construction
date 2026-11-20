"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { BadgeCheck } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/common/section-card";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

import { clerkErrorMessage } from "./clerk-error";
import { UserAvatar } from "./user-avatar";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
/** Clerk's own ceiling for a profile image. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Picture, name and sign-in email, all held by Clerk. A name change reaches
 * the app's own record through the `user.updated` webhook.
 */
export function ProfileSection() {
  const { user } = useUser();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState<"upload" | "remove" | null>(null);

  if (!user) return null;

  const email = user.primaryEmailAddress;
  const nameChanged =
    firstName.trim() !== (user.firstName ?? "")
    || lastName.trim() !== (user.lastName ?? "");

  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (!user || savingName) return;
    if (!firstName.trim()) {
      setNameError("Enter your first name.");
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      await user.update({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      toast.success("Name updated.");
      router.refresh();
    } catch (error) {
      setNameError(clerkErrorMessage(error, "Could not update your name."));
    } finally {
      setSavingName(false);
    }
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!user || !file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      toast.error("Choose a PNG, JPG, GIF or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("That image is over 10 MB. Choose a smaller one.");
      return;
    }
    setImageBusy("upload");
    try {
      await user.setProfileImage({ file });
      await user.reload();
      toast.success("Profile picture updated.");
    } catch (error) {
      toast.error(clerkErrorMessage(error, "Could not upload the picture."));
    } finally {
      setImageBusy(null);
    }
  }

  async function removeImage() {
    if (!user) return;
    setImageBusy("remove");
    try {
      await user.setProfileImage({ file: null });
      await user.reload();
      toast.success("Profile picture removed.");
    } catch (error) {
      toast.error(clerkErrorMessage(error, "Could not remove the picture."));
    } finally {
      setImageBusy(null);
    }
  }

  return (
    <SectionCard title="Profile" description="How you appear across the app.">
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center gap-4">
          <UserAvatar
            imageUrl={user.imageUrl}
            hasImage={user.hasImage}
            name={user.fullName}
            email={email?.emailAddress}
            className="size-16 text-base"
          />
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={imageBusy !== null}
              >
                {imageBusy === "upload" ? (
                  <Spinner className="size-3.5" aria-hidden="true" />
                ) : null}
                {user.hasImage ? "Change picture" : "Upload picture"}
              </Button>
              {user.hasImage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void removeImage()}
                  disabled={imageBusy !== null}
                >
                  {imageBusy === "remove" ? (
                    <Spinner className="size-3.5" aria-hidden="true" />
                  ) : null}
                  Remove
                </Button>
              ) : null}
            </div>
            <p className="text-[0.8125rem] text-muted-foreground">
              PNG, JPG, GIF or WebP, up to 10 MB.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_TYPES.join(",")}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => void uploadImage(event)}
            />
          </div>
        </div>

        <form onSubmit={saveName} className="grid max-w-xl gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="account-first-name">
                First name
                <span aria-hidden="true" className="text-destructive-ink">
                  *
                </span>
                <span className="sr-only">(required)</span>
              </Label>
              <Input
                id="account-first-name"
                autoComplete="given-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                required
                aria-required="true"
                maxLength={100}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="account-last-name">Last name</Label>
              <Input
                id="account-last-name"
                autoComplete="family-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                maxLength={100}
              />
            </div>
          </div>
          {nameError ? (
            <p role="alert" className="text-sm text-destructive-ink">
              {nameError}
            </p>
          ) : null}
          <div>
            <Button
              type="submit"
              variant="royal"
              disabled={savingName || !nameChanged}
            >
              {savingName ? (
                <Spinner className="size-4" aria-hidden="true" />
              ) : null}
              Save name
            </Button>
          </div>
        </form>

        <div className="grid gap-1.5 border-t border-border/70 pt-5">
          <p className="text-[0.8125rem] font-semibold text-foreground">
            Email
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-foreground">
              {email?.emailAddress ?? "No email on this account"}
            </span>
            {email?.verification?.status === "verified" ? (
              <StatusPill tone="success">
                <BadgeCheck className="size-3.5" aria-hidden="true" />
                Verified
              </StatusPill>
            ) : null}
          </div>
          <p className="text-[0.8125rem] text-muted-foreground">
            This is the email you sign in with. Ask an admin if it needs to
            change.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
