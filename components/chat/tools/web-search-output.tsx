import { WebSearchToolOutput } from "@/types/chat";
import { CheckCircle2, XCircle } from "lucide-react";

interface Props {
  output: WebSearchToolOutput;
}

const ERROR_LABEL: Record<string, string> = {
  "api_error": "API Error",
  "rate_limit": "Rate Limit Exceeded",
  "timeout": "Request Timeout",
  "invalid_input": "Invalid Input",
  "unknown": "Unknown Error"
};

export function WebSearchOutput({ output }: Props) {
  const isError = "error" in output;

  return (
    <div className="space-y-4 rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2">
        {isError ? (
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#C6923A]" />
        )}

        <div className="min-w-0 space-y-2">
          {isError ? (
            <>
              <p className="font-medium text-rose-600">
                Search failed: {output.message}
              </p>
              <p className="text-sm text-slate-500">
                Error type: {ERROR_LABEL[output.error]}
                {output.statusCode && ` (${output.statusCode})`}
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-slate-900">
                Found {output.results.length} result
                {output.results.length !== 1 ? "s" : ""}
              </p>

              {output.results.length > 0 && (
                <div className="mt-2 space-y-2">
                  {output.results.map((result, index) => (
                    <div
                      key={index}
                      className="rounded-md border border-[#E2E8F0] p-3"
                    >
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-blue-600 hover:underline"
                      >
                        {result.title}
                      </a>

                      {result.snippet && (
                        <p className="mt-1 text-sm text-slate-500">
                          {result.snippet}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
