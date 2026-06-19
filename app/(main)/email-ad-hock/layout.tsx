import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Email Ad-Hoc",
  description: "Create and send custom email campaigns to your leads.",
};

export default function EmailAdHockLayout({ children }: { children: ReactNode }) {
  return <section id="email-ad-hock">{children}</section>;
}