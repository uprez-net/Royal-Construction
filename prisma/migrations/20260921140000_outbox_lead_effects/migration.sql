-- Durable intents for the two remaining lead-side external effects.
--
-- CONSULTATION_BOOKING covers the public booking form, which is on the open
-- internet with no session: two submissions raced past the calendar conflict
-- check and created two Teams meetings and two invitations to the client.
--
-- LEAD_EMAIL_SEND covers the lead email composer, where a double-click sent
-- the client the same message twice from Royal's mailbox.
ALTER TYPE "OutboxEventKind" ADD VALUE 'CONSULTATION_BOOKING';
ALTER TYPE "OutboxEventKind" ADD VALUE 'LEAD_EMAIL_SEND';
