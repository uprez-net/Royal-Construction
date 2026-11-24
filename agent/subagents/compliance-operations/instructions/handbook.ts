import { defineInstructions } from "eve/instructions";
import { OFFICE_HANDBOOK } from "@/agent/lib/office-handbook";

// Carried on every call rather than loaded as a skill (#619): 31 of 77
// specialist turns called load_skill two or three times before doing any
// work, a second of model time each. Static, and sorted ahead of everything
// that changes per turn, so it is part of the cached prefix.
export default defineInstructions({ content: OFFICE_HANDBOOK });
