import type {
  LinkableWhatsAppGroup,
  RequestProjectWhatsAppGroupResult,
} from "@/lib/domain/projects/whatsapp/groups";
import type {
  ProjectWhatsAppInviteDraft,
  SendProjectWhatsAppInviteResult,
} from "@/lib/domain/projects/whatsapp/invite";
import type { ProjectWhatsAppThread } from "@/lib/domain/projects/whatsapp/queries";
import type {
  ProjectWhatsAppGroupRecord,
  ProjectWhatsAppMessageRecord,
} from "@/lib/domain/projects/whatsapp/records";
import type { SendProjectWhatsAppResult } from "@/lib/domain/projects/whatsapp/send";
import type { Jsonified } from "@/lib/leads/whatsapp-types";

// A project's WhatsApp group as the browser receives it. Type-only imports:
// the domain owns the shapes, JSON turns Dates into strings on the way over.

export type ProjectWhatsAppThreadDto = Jsonified<ProjectWhatsAppThread>;
export type ProjectWhatsAppGroupDto = Jsonified<ProjectWhatsAppGroupRecord>;
export type ProjectWhatsAppMessageDto = Jsonified<ProjectWhatsAppMessageRecord>;
export type ProjectWhatsAppSendResultDto = Jsonified<SendProjectWhatsAppResult>;
export type ProjectWhatsAppRequestResultDto =
  Jsonified<RequestProjectWhatsAppGroupResult>;
export type LinkableWhatsAppGroupDto = Jsonified<LinkableWhatsAppGroup>;
export type ProjectWhatsAppInviteDraftDto =
  Jsonified<ProjectWhatsAppInviteDraft>;
export type ProjectWhatsAppInviteResultDto =
  Jsonified<SendProjectWhatsAppInviteResult>;
