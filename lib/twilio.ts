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