import type { Metadata } from "next";
import type { ReactNode } from "react";

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
  return <section id="book-consultation">{children}</section>;
}
