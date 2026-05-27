Twilio only needs:

-   public webhook endpoints
    
-   XML (TwiML) responses
    
-   fast response times
    

Next.js route handlers work perfectly for this.

----------

# Recommended Structure (App Router)

```txt
app/
 └── api/
      └── twilio/
           ├── voice/
           │    └── route.ts
           ├── menu/
           │    └── route.ts
           ├── verify-pin/
           │    └── route.ts
           ├── confirm-number/
           │    └── route.ts
           ├── dial-number/
           │    └── route.ts
           ├── call-status/
           │    └── route.ts
           └── recording-status/
                └── route.ts

```

----------

# Install

```bash
pnpm add twilio
```

----------

# Helper Function

Create:

```txt
lib/twilio.ts

```

```ts
import twilio from "twilio";

export const VoiceResponse = twilio.twiml.VoiceResponse;

export function xmlResponse(xml: string) {
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "text/xml",
    },
  });
}

```

----------

# 1. `/api/twilio/voice/route.ts`

```ts
import { NextRequest } from "next/server";
import { VoiceResponse, xmlResponse } from "@/lib/twilio";

const ALLOWED_NUMBERS = [
  "+919876543210",
];

export async function POST(req: NextRequest) {
  const formData = await req.formData();

  const from = formData.get("From")?.toString();

  const twiml = new VoiceResponse();

  if (!from || !ALLOWED_NUMBERS.includes(from)) {
    twiml.say("Unauthorized caller.");
    twiml.hangup();

    return xmlResponse(twiml.toString());
  }

  const gather = twiml.gather({
    numDigits: 1,
    action: "/api/twilio/menu",
    method: "POST",
  });

  gather.say(
    "Press 1 to make an outbound business call."
  );

  return xmlResponse(twiml.toString());
}

```

----------

# 2. `/api/twilio/menu/route.ts`

```ts
import { NextRequest } from "next/server";
import { VoiceResponse, xmlResponse } from "@/lib/twilio";

export async function POST(req: NextRequest) {
  const formData = await req.formData();

  const digit = formData.get("Digits")?.toString();

  const twiml = new VoiceResponse();

  if (digit !== "1") {
    twiml.say("Invalid option.");
    twiml.hangup();

    return xmlResponse(twiml.toString());
  }

  const gather = twiml.gather({
    numDigits: 4,
    action: "/api/twilio/verify-pin",
    method: "POST",
  });

  gather.say("Please enter your 4 digit pin.");

  return xmlResponse(twiml.toString());
}

```

----------

# 3. `/api/twilio/verify-pin/route.ts`

```ts
import { NextRequest } from "next/server";
import { VoiceResponse, xmlResponse } from "@/lib/twilio";

const EMPLOYEE_PIN = "1234";

export async function POST(req: NextRequest) {
  const formData = await req.formData();

  const pin = formData.get("Digits")?.toString();

  const twiml = new VoiceResponse();

  if (pin !== EMPLOYEE_PIN) {
    twiml.say("Invalid pin.");
    twiml.hangup();

    return xmlResponse(twiml.toString());
  }

  const gather = twiml.gather({
    numDigits: 10,
    action: "/api/twilio/dial-number",
    method: "POST",
  });

  gather.say(
    "Please enter the 10 digit customer number."
  );

  return xmlResponse(twiml.toString());
}

```

----------

# 4. `/api/twilio/dial-number/route.ts`

```ts
import { NextRequest } from "next/server";
import { VoiceResponse, xmlResponse } from "@/lib/twilio";

export async function POST(req: NextRequest) {
  const formData = await req.formData();

  const digits = formData.get("Digits")?.toString();

  const twiml = new VoiceResponse();

  if (!digits || digits.length !== 10) {
    twiml.say("Invalid phone number.");
    twiml.hangup();

    return xmlResponse(twiml.toString());
  }

  const customerNumber = `+91${digits}`;

  twiml.say("Connecting your call.");

  twiml.dial(
    {
      callerId: process.env.TWILIO_PHONE_NUMBER!,
      record: "record-from-answer-dual",
      recordingStatusCallback:
        `${process.env.APP_URL}/api/twilio/recording-status`,
      statusCallback:
        `${process.env.APP_URL}/api/twilio/call-status`,
      answerOnBridge: true,
    },
    customerNumber
  );

  return xmlResponse(twiml.toString());
}

```

----------

# 5. Call Status Webhook

```txt
app/api/twilio/call-status/route.ts

```

```ts
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const formData = await req.formData();

  console.log({
    callSid: formData.get("CallSid"),
    status: formData.get("CallStatus"),
    from: formData.get("From"),
    to: formData.get("To"),
  });

  return Response.json({
    success: true,
  });
}

```

----------

# 6. Recording Webhook

```txt
app/api/twilio/recording-status/route.ts

```

```ts
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const formData = await req.formData();

  console.log({
    recordingUrl: formData.get("RecordingUrl"),
    duration: formData.get("RecordingDuration"),
  });

  return Response.json({
    success: true,
  });
}

```

----------

# `.env.local`

```env
TWILIO_PHONE_NUMBER=+91XXXXXXXXXX
APP_URL=https://your-domain.com

```

----------

# Twilio Webhook

Configure your Twilio number:

```txt
https://your-domain.com/api/twilio/voice

```

Method:

```txt
POST

```

----------

# Local Development

Use:

-   [ngrok](https://ngrok.com/?utm_source=chatgpt.com)
    
-   [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/?utm_source=chatgpt.com)
    

Example:

```bash
ngrok http 3000

```

----------

# Why Next.js Is Nice Here

Example:

```txt
Twilio Webhook
      ↓
Next.js API
      ↓
Prisma
      ↓
Customer/Lead Tables
      ↓
Automation

```