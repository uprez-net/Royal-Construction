import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { Fraunces, IBM_Plex_Mono, Manrope } from "next/font/google";

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
    "Construction management portal rebuilt from static mockups into a reusable Next.js architecture.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${heading.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
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
