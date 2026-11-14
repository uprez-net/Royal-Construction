import { createHmac, randomUUID } from "node:crypto";

// A Twilio Voice Access Token, minted without the SDK (file 02, browser
// calling). A JWT signed HS256 with an API Key secret:
//
//   header  { alg: HS256, typ: JWT, cty: "twilio-fpa;v=1" }
//   payload { jti, iss: <API key SID>, sub: <Account SID>, iat, exp,
//             grants: { identity, voice: { incoming: { allow: true } } } }
//
// Incoming only. CRM calls are placed by the server and bridged to the
// browser, so a token that cannot dial out cannot be used to ring an
// arbitrary number even if it leaks (file 06 §8).

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function twilioVoiceAccessToken(input: {
  readonly accountSid: string;
  readonly apiKeySid: string;
  readonly apiKeySecret: string;
  readonly identity: string;
  readonly ttlSeconds: number;
  readonly now?: Date;
}): string {
  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const header = { alg: "HS256", cty: "twilio-fpa;v=1", typ: "JWT" };
  const payload = {
    exp: iat + input.ttlSeconds,
    grants: {
      identity: input.identity,
      voice: { incoming: { allow: true } },
    },
    iat,
    iss: input.apiKeySid,
    jti: `${input.apiKeySid}-${randomUUID()}`,
    sub: input.accountSid,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", input.apiKeySecret)
    .update(signingInput)
    .digest();
  return `${signingInput}.${base64url(signature)}`;
}
