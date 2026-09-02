import { Suspense } from "react";

import type { Metadata } from "next";
import { connection } from "next/server";

import { XeroConnectionPanel } from "@/components/admin/xero-connection-panel";
import { getXeroConnectionStatus } from "@/lib/data/xero-connection";
import XeroConnectionSkeleton from "./loading";

export const metadata: Metadata = {
  title: "Xero Accounting",
  description: "Connect the Xero organisation that progress claims are raised in.",
};

type XeroPageSearchParams = Promise<{ connected?: string; error?: string }>;

async function XeroConnectionContent({
  searchParams,
}: {
  searchParams: XeroPageSearchParams;
}) {
  // Cache Components is on. This reads live connection state plus whatever the
  // OAuth callback redirected back with, so it must never be prerendered.
  await connection();

  const [status, params] = await Promise.all([
    getXeroConnectionStatus(),
    searchParams,
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Xero Accounting
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Progress claims are raised against this organisation.
        </p>
      </div>

      <XeroConnectionPanel
        status={status}
        errorCode={params.error}
        connected={params.connected === "1"}
      />
    </div>
  );
}

export default function AdminXeroPage({
  searchParams,
}: {
  searchParams: XeroPageSearchParams;
}) {
  // Cache Components rejects an uncached read that is not inside a Suspense
  // boundary, so the whole page sits behind one — the same shape the project
  // detail page uses, with `loading.tsx` doing double duty as the fallback.
  return (
    <Suspense fallback={<XeroConnectionSkeleton />}>
      <XeroConnectionContent searchParams={searchParams} />
    </Suspense>
  );
}
