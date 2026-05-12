export function DataTable({
  headers,
  rows,
}: {
  headers: string[]
  rows: string[][]
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/70 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-4 py-3 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-t border-border/70 transition-colors hover:bg-muted/40">
              {row.map((cell) => (
                <td key={cell} className="px-4 py-3">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
