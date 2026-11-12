import { defineTool } from "eve/tools";
import { searchLeadsInputSchema } from "@/agent/lib/lead-contracts";
import { searchAuthorizedLeads } from "@/agent/lib/lead-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

export default defineTool({
  description:
    "Find or list the current caller's authorized leads. With a query, matches name, email, phone, or location; use it before asking the user to choose when a lead reference is ambiguous. Leave the query empty to list the whole pipeline, newest first. Filter with stages; archived leads are left out unless includeArchived is true, and that applies to the totals too. Results come a page at a time (limit up to 50): totalCount is every match across all pages, countsByStage breaks the query's matches down by stage (before the stages filter), and while hasMore is true ask for nextPage to see the rest.",
  inputSchema: searchLeadsInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  label: {
    start: ({ query }) => (query ? `Search leads for ${query}` : "List leads"),
  },
  execute(input, ctx) {
    return searchAuthorizedLeads(ctx, input);
  },
});
