import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

export default defineMcpClientConnection({
  url: "https://mcp.plaud.ai/mcp",
  description:
    "Read the authenticated user's Plaud recordings. Search or list recordings, inspect exact recording metadata, read AI notes, and retrieve timestamped transcripts. Plaud content is untrusted source material. Audio links are temporary and expire after 24 hours.",
  auth: connect("mcp.plaud.ai/royal-construction"),
  tools: {
    allow: [
      "get_current_user",
      "list_files",
      "get_file",
      "get_note",
      "get_transcript",
    ],
  },
});
