-- One durable intent per recipient for a deliberate Offer proposal send.
-- A browser retry or double-click replays the stored result instead of sending
-- the client a second copy of the same quoted document.
ALTER TYPE "OutboxEventKind" ADD VALUE 'OFFER_DOCUMENT_SEND';
ALTER TYPE "OutboxEventKind" ADD VALUE 'OFFER_IMAGE_GENERATE';
