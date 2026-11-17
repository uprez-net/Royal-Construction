"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether this deployment has WhatsApp at all, read once on the server from
 * WHATSAPP_ENABLED (and WHATSAPP_CALLING_ENABLED) and handed down by the shell.
 *
 * Every WhatsApp poller reads this before it starts a timer. A deployment with
 * WhatsApp off then spends no function invocations and no database reads on
 * it: the app-wide incoming-call poll used to ask every few seconds on every
 * page only to be told "off".
 */
export type WhatsAppAvailability = {
  /** WHATSAPP_ENABLED is "true". */
  readonly enabled: boolean;
  /** WhatsApp is on and WHATSAPP_CALLING_ENABLED is "true". */
  readonly calling: boolean;
};

export const WHATSAPP_OFF: WhatsAppAvailability = {
  calling: false,
  enabled: false,
};

// Outside the shell nothing has said WhatsApp is on, so nothing polls.
const WhatsAppAvailabilityContext =
  createContext<WhatsAppAvailability>(WHATSAPP_OFF);

export function WhatsAppAvailabilityProvider({
  value,
  children,
}: {
  value: WhatsAppAvailability;
  children: ReactNode;
}) {
  return (
    <WhatsAppAvailabilityContext.Provider value={value}>
      {children}
    </WhatsAppAvailabilityContext.Provider>
  );
}

export function useWhatsAppAvailability(): WhatsAppAvailability {
  return useContext(WhatsAppAvailabilityContext);
}
