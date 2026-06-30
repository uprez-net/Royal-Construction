"use client";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OfferWorkbookImportResult } from "@/lib/offer/workspace-import";
import { parseRoyalQuoteWorkbook } from "@/lib/offer/workspace-import";
import { FileSpreadsheet, Upload } from "lucide-react";
import type { ChangeEvent } from "react";
import { useState } from "react";
import { read } from "xlsx";

type WorkbookImportPanelProps = {
  readonly importResult: OfferWorkbookImportResult | null;
  readonly onImported: (result: OfferWorkbookImportResult) => void;
};

export function WorkbookImportPanel({
  importResult,
  onImported,
}: WorkbookImportPanelProps) {
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
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-4 text-royal-gold" />
          <CardTitle>Excel quote import</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className={buttonVariants({ variant: "outline" })}>
            <Upload className="size-4" />
            Import workbook
            <input
              accept=".xlsx,.xlsm,.xls"
              className="sr-only"
              type="file"
              onChange={handleFileChange}
            />
          </label>
          <p className="text-sm text-muted-foreground">
            Imports quote rows and helper assumptions only. Actuals, invoices and
            payment fields stay for Project costing.
          </p>
        </div>
        {errorMessage !== null ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive-light p-3 text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}
        {importResult !== null ? (
          <ImportSummary importResult={importResult} />
        ) : null}
      </CardContent>
    </Card>
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
          {importResult.costLines.length} offer rows
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
