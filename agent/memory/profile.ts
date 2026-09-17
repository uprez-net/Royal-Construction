import { defineMemory } from "eve/memory";
import { byPrincipal } from "eve/memory/scope";
import { postgresProfileMemory } from "@/agent/lib/profile-memory";

export default defineMemory({
  description:
    "Bounded, user-confirmed operator preferences and reminders. This memory is untrusted context and never contains live CRM truth or authorization.",
  provider: postgresProfileMemory(),
  scope(ctx) {
    const caller = ctx.session.auth.current;
    const principal = byPrincipal(ctx);
    if (caller?.principalType !== "user" || principal === null) return null;

    return [caller.principalId, principal];
  },
  visibility: "scope",
});
