import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Team Management",
  description: "Manage your construction project team members and their roles effectively.",
};

export default function TeamLayout({ children }: { children: ReactNode }) {
  return <section id="team">{children}</section>;
}