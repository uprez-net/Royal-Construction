"use client";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { OfferWorkbookImportResult } from "@/lib/offer/workspace-import";
import { parseRoyalQuoteWorkbook } from "@/lib/offer/workspace-import";
import { FileSpreadsheet } from "lucide-react";
import type { ChangeEvent } from "react";
import { useState } from "react";
import { read } from "xlsx";

type WorkbookImportControlProps = {
  readonly importResult: OfferWorkbookImportResult | null;
  readonly onImported: (result: OfferWorkbookImportResult) => void;
};

export function WorkbookImportControl({
  importResult,
  onImported,
}: WorkbookImportControlProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) {
      return;
    }

    try {
      const workbook = read(await file.arrayBuffer(), { type: "array" });
      onImported(parseRoyalQuoteWorkbook(workbook, file.name));
      setErrorMessage(null);
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message);
        return;
      }

      throw error;
    }
  }

  return (
    <section
      aria-labelledby="offer-workbook-import-title"
      className="grid gap-3 rounded-lg border border-royal-gold/25 bg-royal-gold-light/40 p-3"
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,280px)] md:items-start">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-royal-gold shadow-sm">
            <FileSpreadsheet className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3
              className="text-sm font-semibold text-foreground"
              id="offer-workbook-import-title"
            >
              Import workbook rows
            </h3>
            <p className="max-w-prose text-sm text-muted-foreground">
              Optional shortcut for existing quote files. It fills this cost
              schedule and skips Project actuals, invoices and payment fields.
            </p>
          </div>
        </div>
        <label
          className="grid w-full gap-1"
          htmlFor="offer-workbook-import"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Workbook file
          </span>
          <Input
            accept=".xlsx,.xlsm,.xls"
            className="bg-white/95"
            id="offer-workbook-import"
            type="file"
            onChange={handleFileChange}
          />
        </label>
      </div>
      {errorMessage !== null ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive-light p-3 text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
      {importResult !== null ? (
        <ImportSummary importResult={importResult} />
      ) : null}
    </section>
  );
}

function ImportSummary({
  importResult,
}: {
  readonly importResult: OfferWorkbookImportResult;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-background/70 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-royal-gold text-white">
          {importResult.costLines.length} Offer rows
        </Badge>
        <Badge variant="outline">{importResult.sourceName}</Badge>
        {importResult.validationMessages.length > 0 ? (
          <Badge variant="destructive">
            {importResult.validationMessages.length} workbook warnings
          </Badge>
        ) : null}
      </div>
      {importResult.ignoredProjectFields.length > 0 ? (
        <p className="text-muted-foreground">
          Project-phase fields detected and skipped:{" "}
          {importResult.ignoredProjectFields.join(", ")}.
        </p>
      ) : null}
      {importResult.validationMessages.length > 0 ? (
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {importResult.validationMessages.slice(0, 6).map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
