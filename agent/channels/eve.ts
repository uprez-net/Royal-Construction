import { eveChannel } from "eve/channels/eve";
import { clerkInternalUserAuth } from "../lib/channel-auth";

export default eveChannel({
  auth: clerkInternalUserAuth(),
  audience: "private",
  turnPolicy: "queue",
  uploadPolicy: {
    maxBytes: 10 * 1024 * 1024,
  },
});
