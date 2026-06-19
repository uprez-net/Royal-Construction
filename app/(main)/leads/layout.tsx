import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Leads Management",
  description: "Manage and track your construction project leads effectively.",
};

export default function LeadsLayout({ children }: { children: ReactNode }) {
  return <section id="leads">{children}</section>;
}