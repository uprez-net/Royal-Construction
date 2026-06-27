import { formatValue, toLabel, isPlainObject, isPrimitive, safeStringify } from "@/utils/formatters";

/**
 * GenericOutput displays raw JSON for unknown tool types.
 */
function GenericOutput({ data }: { data: unknown }) {
  if (isPlainObject(data)) {
    return <StructuredObjectView data={data} />;
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card p-3 shadow-sm">
      <StructuredJsonBlock data={data} />
    </div>
  );
}

/**
 *  StructuredObjectView recursively displays a plain object in a structured format. 
 * It separates primitive values (strings, numbers, booleans) from complex values (objects, arrays) and displays them accordingly. 
 * Primitive values are shown in a grid format, while complex values are displayed in nested blocks. 
 * If a value is not a plain object, it falls back to displaying the raw JSON. 
 */

function StructuredObjectView({ data }: { data: unknown }) {
  if (!isPlainObject(data)) {
    return <StructuredJsonBlock data={data} />;
  }

  const entries = Object.entries(data);
  const primitiveEntries = entries.filter(([, value]) => isPrimitive(value));
  const complexEntries = entries.filter(([, value]) => !isPrimitive(value));

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/30 p-3">
      {primitiveEntries.length ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {primitiveEntries.map(([key, value]) => (
            <DetailRow key={key} label={toLabel(key)} value={formatValue(value)} />
          ))}
        </div>
      ) : null}

      {complexEntries.length ? (
        <div className="space-y-3">
          {complexEntries.map(([key, value]) => (
            <div key={key} className="space-y-1 rounded-xl border border-border/70 bg-card p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {toLabel(key)}
              </p>
              {Array.isArray(value) ? (
                <ArrayPreview value={value} />
              ) : isPlainObject(value) ? (
                <StructuredObjectView data={value} />
              ) : (
                <StructuredJsonBlock data={value} compact />
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * StructuredJsonBlock displays a JSON value in a formatted block. It uses a monospace font and preserves whitespace to show the structure of the JSON.
 * If the "compact" prop is true, it limits the maximum height of the block to 40 units and makes it scrollable, otherwise it allows for a larger maximum height.
 * This component is used as a fallback for values that are not plain objects, such as arrays or primitive values,
 *  to ensure that all data can be displayed in a readable format.
 */
function StructuredJsonBlock({ data, compact }: { data: unknown; compact?: boolean }) {
  return (
    <pre
      className={[
        "scrollbar-thin max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-border/70 bg-card p-3 text-xs text-muted-foreground",
        compact ? "max-h-40" : "",
      ].join(" ")}
    >
      {safeStringify(data)}
    </pre>
  );
}


/**
 * ArrayPreview displays a preview of an array value. It shows the number of items in the array and a preview of the first few items.
 * If the array is empty, it shows a message indicating that the array is empty. 
 * Each item in the preview is displayed in a rounded block with a border. 
 * If an item is a primitive value, it is displayed as a string; if it is a complex value, it is displayed as formatted JSON.
 */
function ArrayPreview({ value }: { value: unknown[] }) {
  if (!value.length) {
    return <p className="text-sm text-muted-foreground">Empty array</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {value.length} item{value.length === 1 ? "" : "s"}
      </p>
      <div className="space-y-2">
        {value.slice(0, 5).map((item, index) => (
          <div
            key={index}
            className="rounded-xl border border-border/70 bg-card p-2 text-sm text-muted-foreground"
          >
            {isPrimitive(item) ? String(item) : safeStringify(item)}
          </div>
        ))}
      </div>
      {value.length > 5 ? (
        <p className="text-xs text-muted-foreground/70">Showing first 5 items.</p>
      ) : null}
    </div>
  );
}

/**
 * StatPill displays a label and a value in a compact, pill-shaped block. It is used to show key statistics or details in a visually distinct way.
 * The "compact" prop can be used to reduce the padding and font size for a more condensed display.
 * This component is used in various tool output components to highlight important values such as counts, totals, or other key metrics.
 */

function StatPill({ label, value, compact }: { label: string; value: React.ReactNode; compact?: boolean }) {
  return (
    <div
      className={[
        "rounded-xl border border-border/70 bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm",
        compact ? "px-2 py-1" : "",
      ].join(" ")}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums text-foreground">{value}</div>
    </div>
  );
}

/**
 * DetailRow displays a label and a value in a block with a border. 
 * It is used to show individual details in a structured format, often within the StructuredObjectView component.
 * The label is displayed in uppercase with a smaller font size, while the value is displayed below it with a regular font size. 
 * This component helps to create a clear visual hierarchy between the label and the value, 
 * making it easier to read and understand the information being presented.
 */
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-2 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 wrap-break-word text-sm text-foreground">{value}</div>
    </div>
  );
}

export {
    GenericOutput,
    StructuredObjectView,
    StructuredJsonBlock,
    ArrayPreview,
    StatPill,
    DetailRow,
}
