-- Deleting a booked tradie schedule is no longer something a site manager does
-- directly. The request now becomes a TradieApproval row like every other
-- consequential tradie action, and an admin resolves it.
--
-- Its own action type rather than reusing SCHEDULE_APPROVAL: the two carry
-- opposite outcomes on approval (one confirms the booking, one removes it), and
-- sharing a value would make the admin queue unable to tell them apart.

ALTER TYPE "TradieApprovalActionType" ADD VALUE IF NOT EXISTS 'SCHEDULE_DELETION';
