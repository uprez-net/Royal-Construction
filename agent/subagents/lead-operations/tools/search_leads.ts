import { defineTool } from "eve/tools";
import { searchLeadsInputSchema } from "@/agent/lib/lead-contracts";
import { searchAuthorizedLeads } from "@/agent/lib/lead-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

export default defineTool({
  description:
    "Search only the current caller's authorized leads by name, email, phone, or location. Use this before asking the user to choose when a lead reference is ambiguous.",
  inputSchema: searchLeadsInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  label: {
    start: ({ query }) => `Search leads for ${query}`,
  },
  execute(input, ctx) {
    return searchAuthorizedLeads(ctx, input);
  },
});
