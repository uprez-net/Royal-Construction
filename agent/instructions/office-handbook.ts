import { defineInstructions } from "eve/instructions";
import { OFFICE_HANDBOOK } from "@/agent/lib/office-handbook";

// The orchestrator carries the handbook on every call rather than loading it
// as a skill: it needs the business map on every turn to route at all, and a
// load_skill round trip at the start of each session is exactly the latency
// this agent is trying to lose. Specialists carry it the same way (#619).
export default defineInstructions({ content: OFFICE_HANDBOOK });
