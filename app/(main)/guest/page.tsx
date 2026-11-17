import { Mail } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Access Pending",
  description: "Your CRM access is being reviewed. Please wait for approval.",
};

export default function GuestPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-warning-light rounded-full mb-4">
              <Mail className="w-8 h-8 text-warning-ink" />
            </div>
            <h1 className="font-heading text-3xl font-semibold text-foreground mb-2">
              Access Pending
            </h1>
            <p className="text-muted-foreground">
              Your CRM access is being reviewed
            </p>
          </div>

          <div className="bg-muted border border-border rounded-lg p-6 mb-6">
            <p className="text-muted-foreground text-sm leading-relaxed">
              We&apos;re reviewing your request for access to the CRM system.
              Please wait for approval from our team. This typically takes 1-2
              business days.
            </p>
          </div>

          <div className="bg-muted border border-border rounded-lg p-4">
            <p className="text-muted-foreground text-sm mb-2">
              If you believe this is incorrect, please reach out to:
            </p>
            <a
              href="mailto:info@royalconstructions.com.au"
              className="inline-flex items-center justify-center gap-2 text-primary hover:underline font-medium transition-colors"
            >
              <Mail className="w-4 h-4" />
              info@royalconstructions.com.au
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
