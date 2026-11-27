-- Which revision of its handoff an owner-call callback was scheduled for
-- (lib/domain/comms/calls/owner-call-handoff.ts). A handoff reopened as a newer
-- revision can then tell an old booking from one that answers the newer
-- request, and replace an old one that has not rung. Additive and nullable:
-- callbacks scheduled before this carry NULL and are treated as current.
ALTER TABLE "OwnerCall" ADD COLUMN "fromHandoffRevision" INTEGER;
