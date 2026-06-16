import type { FileProcessingToolOutput } from "@/types/chat";
import { isPlainObject } from "@/utils/formatters";
import { CheckCircle2, XCircle } from "lucide-react";
import { StatPill } from "./util";
import Image from "next/image";

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

export function FileProcessingOutput({
  output,
}: {
  output: FileProcessingToolOutput;
}) {
  const data = output.data?.summary;
  const images = output.data?.images;
  const totals =
    isPlainObject(data) && isPlainObject(data.totals)
      ? data.totals
      : {
          tablesFound: 0,
          amountsFound: 0,
          quantitiesFound: 0,
        };
  const extracted =
    isPlainObject(data) && isPlainObject(data.extracted)
      ? data.extracted
      : {
          tables: [],
          amounts: [],
          quantities: [],
        };
  const pageCount = isPlainObject(data) ? numberValue(data.pageCount) : 0;
  const tableCount =
    numberValue(totals.tablesFound) || arrayLength(extracted.tables);
  const amountCount =
    numberValue(totals.amountsFound) || arrayLength(extracted.amounts);
  const quantityCount =
    numberValue(totals.quantitiesFound) || arrayLength(extracted.quantities);

  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start gap-2">
        {output.success ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--royal-gold)]" />
        ) : (
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--destructive)]" />
        )}
        <div className="min-w-0 space-y-2">
          <div>
            <p className="text-wrap font-medium text-foreground">
              {output.message}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {pageCount} page{pageCount === 1 ? "" : "s"} processed
              {tableCount
                ? ` · ${tableCount} table${tableCount === 1 ? "" : "s"}`
                : ""}
              {amountCount
                ? ` · ${amountCount} amount${amountCount === 1 ? "" : "s"}`
                : ""}
            </p>
          </div>

          {pageCount > 0 ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <StatPill label="Pages" value={pageCount} />
              <StatPill label="Tables" value={tableCount} />
              <StatPill label="Quantities" value={quantityCount} />
            </div>
          ) : null}

          {images && images.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2 max-h-48 overflow-y-auto no-scrollbar">
              {images.map((image) => {
                const id = image.id
                const imageData = image.parts.find(
                  (part) => part.type === "file",
                );

                if (!imageData) return null;

                const src = imageData.url.startsWith("data:")
                  ? imageData.url
                  : `data:image/png;base64,${imageData.url}`;

                return (
                  <div
                    key={imageData.filename ?? `image-${id}`}
                    className="relative h-24 w-24 overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm"
                  >
                    <Image
                      src={src}
                      alt={imageData.filename ?? `Extracted image ${id}`}
                      height={96}
                      width={96}
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
