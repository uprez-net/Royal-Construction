import type { Metadata } from "next";
import { IBM_Plex_Sans_Condensed } from "next/font/google";
import type { ReactNode } from "react";

const plexCondensed = IBM_Plex_Sans_Condensed({
  variable: "--font-plex-condensed",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "Book Consultation",
  description:
    "Schedule a consultation with our construction experts to discuss your project needs.",
};

export default function BookConsultationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <section id="book-consultation" className={plexCondensed.variable}>
      {children}
    </section>
  );
}
