import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { Fraunces, IBM_Plex_Mono, Manrope } from "next/font/google";

import { SandboxBanner } from "@/components/common/sandbox-banner";
import { ModalManager } from "@/components/modals/modal-manager";
import { ReduxProvider } from "@/components/providers/redux-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const sans = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
});

const heading = Fraunces({
  variable: "--font-heading",
  subsets: ["latin"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Royal Constructions",
    template: "%s | Royal Constructions",
  },
  description:
    "Construction management portal for Royal Constructions. Manage projects, track progress, and collaborate with your team.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Set only on the Vercel staging environment. When present it both renders the
  // sandbox banner and publishes its height so full-viewport shells can subtract
  // it via calc(); unset everywhere else, so production is untouched.
  const isStaging = process.env.APP_ENV === "staging";

  // Chrome 149-156 and Edge 150 gate document.modelContext behind an origin
  // trial token, registered per-origin at chrome.com/origintrials. ChatGPT
  // Desktop's built-in browser — the consumer this app targets — needs no
  // token, so this is purely additional reach and stays inert when unset.
  // Tokens expire with the trial and have to be reissued.
  const webMcpOriginTrialToken = process.env.NEXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN;

  return (
    <html
      lang="en"
      className={`${sans.variable} ${heading.variable} ${mono.variable} h-full antialiased`}
    >
      {webMcpOriginTrialToken ? (
        <head>
          <meta httpEquiv="origin-trial" content={webMcpOriginTrialToken} />
        </head>
      ) : null}
      <body
        className="min-h-full bg-background text-foreground"
        style={
          isStaging
            ? ({ "--sandbox-banner-height": "2rem" } as CSSProperties)
            : undefined
        }
      >
          <SandboxBanner />
          <ClerkProvider>
            <ReduxProvider>
              {children}
              <Toaster />
              <ModalManager />
            </ReduxProvider>
          </ClerkProvider>
      </body>
    </html>
  );
}
