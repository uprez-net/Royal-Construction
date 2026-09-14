/**
 * What every compliance alert says, and who it is attributed to.
 *
 * A plain constants module rather than part of the component that renders it,
 * which is where both tables lived until the alert list moved off the
 * Compliance tab. Three unrelated readers now want the same wording -- the
 * merged alert list above the tabs, the resolve dialog the tab opens, and the
 * stage header that has to say which stage an open alert belongs to -- and a
 * component importing a component to read a string is how the copy ends up
 * duplicated and then drifting.
 */
import {
  ComplianceAlertSource,
  ComplianceAlertType,
} from "@prisma/client";

/**
 * What each alert is called, and what closing it actually requires.
 *
 * The guidance is the load-bearing half. An alert nobody knows how to close is
 * an alert that sits open forever, and in the DA case it would sit there
 * suppressing the planning certificate while everyone waited for something to
 * happen on its own.
 */
export const COMPLIANCE_ALERT_COPY: Readonly<
  Record<
    ComplianceAlertType,
    {
      title: string;
      guidance: string;
      /**
       * The label on the one-click chase, where the alert has one.
       *
       * Ten of the sixteen do. What they have in common is that the remedy is a
       * request we can compose ourselves out of what is already on this screen
       * — which names are on the register against which we hold, what was asked
       * for and when, the revisions that went across a fortnight ago. The two
       * six that have none are the ones nobody can be asked: a portal does not
       * read email, and a development application is a decision about the whole
       * job rather than a document to be reminded about.
       *
       * A label here is necessary but not sufficient. Whether the button
       * actually appears also depends on that party having a live thread on
       * this file, which is `canFollowUp` below.
       */
      followUp?: string;
      /**
       * How the row reads, where it does not read as a problem.
       *
       * Absent on twenty-one of the twenty-four, and absent means amber: an
       * open alert is something outstanding, which is what the panel was built
       * to say and what the colour has always meant.
       *
       * The three download-ready alerts are the exception and are the reason
       * this field exists. They are raised by the portal *approving* something
       * \u2014 the best news a compliance file gets \u2014 and rendering them in the same
       * amber as a surveyor three weeks late was actively misleading: a reader
       * scanning the panel saw a job in trouble on the day its CDC came
       * through. They are still alerts rather than a quiet status change,
       * because there is a step left that only a person can take, and a file
       * that silently went "approved" with nothing on it is how a certificate
       * sits undownloaded for a fortnight.
       *
       * A tone rather than a boolean so a third reading has somewhere to go
       * without every consumer growing a second conditional.
       */
      tone?: "positive";
    }
  >
> = {
  [ComplianceAlertType.STALE_TITLE_SEARCH]: {
    title: "Title search does not name the owners",
    guidance:
      "The proprietors on this search do not match the owners recorded on the project — the land registry has most likely not updated since settlement. Ask for a fresh search; it closes itself once a replacement is uploaded and the names check out.",
    followUp: "Request updated title search",
  },
  [ComplianceAlertType.DA_APPROVAL_REQUIRED]: {
    title: "Development approval required",
    guidance:
      "This job cannot go through as a CDC. The planning certificate is no longer required while this is open. Close it once development consent has been granted — or if it turns out a CDC is viable after all.",
  },

  // -------------------------------------------------------------------
  // The overdue conditions, raised by the daily sweep.
  //
  // All six read the same way and all six close themselves: the thing being
  // waited for lands, and the sweep resolves the alert on its next pass. So
  // the guidance says what is late and what the button does, and never asks
  // anybody to come back and tick it off — a person resolving one by hand is
  // saying the wait no longer applies, not that it ended.
  // -------------------------------------------------------------------

  [ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED]: {
    title: "Planning certificate taking longer than usual",
    guidance:
      "The 10.7(2) & (5) application has been with the portal past the three to five working days it normally takes. Chase it with the council using the application number on the council block, and tick it received once the certificate lands. This closes itself when the certificate is on the file.",
  },
  [ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE]: {
    title: "Surveyor response pending",
    guidance:
      "The surveyor was engaged more than eleven working days ago and has not sent their documents through. The follow-up asks for an update on the thread they are already reading; it closes itself when the documents arrive.",
    followUp: "Send a follow up",
  },
  [ComplianceAlertType.ARCHITECT_PLANS_OVERDUE]: {
    title: "Preliminary plans pending",
    guidance:
      "The client and the architect met more than eleven working days ago and no preliminary plans have come back. The follow-up asks for an update on the architect's thread; it closes itself when the plans land.",
    followUp: "Follow up with the architect",
  },
  [ComplianceAlertType.ARCHITECT_REVISION_OVERDUE]: {
    title: "Client revisions pending",
    guidance:
      "The client's revisions went to the architect more than eleven working days ago and no revised set has come back. The follow-up re-sends the feedback and asks where the redraw is up to; it closes itself when the revised plans arrive.",
    followUp: "Send a revision reminder",
  },
  [ComplianceAlertType.BASIX_RESPONSE_OVERDUE]: {
    title: "BASIX certificate pending",
    guidance:
      "The BASIX consultant was engaged more than eleven working days ago and has not sent the certificate through. The follow-up asks for an update on their thread; it closes itself when the certificate arrives.",
    followUp: "Send a follow up",
  },
  [ComplianceAlertType.BUSHFIRE_RESPONSE_OVERDUE]: {
    title: "Bushfire assessment pending",
    guidance:
      "The bushfire consultant was engaged more than eleven working days ago and has not sent their assessment through. The follow-up asks for an update on their thread; it closes itself when the report arrives.",
    followUp: "Send a follow up",
  },
  [ComplianceAlertType.STRUCTURAL_RESPONSE_OVERDUE]: {
    title: "Structural engineer response pending",
    guidance:
      "The structural engineer was engaged more than eleven working days ago and at least one of their three documents has not come back. The follow-up lists whichever are still outstanding and asks for an update on their thread; it closes itself when the last of them arrives.",
    followUp: "Send a follow up",
  },
  [ComplianceAlertType.WATER_AUTHORITY_RESPONSE_OVERDUE]: {
    title: "Water servicing approval pending",
    guidance:
      "The water servicing coordinator was engaged more than eleven working days ago and has not sent the tap-in approval or the section 73 notice through. The follow-up asks for an update on their thread; it closes itself when they arrive.",
    followUp: "Send a follow up",
  },
  [ComplianceAlertType.TRAFFIC_RESPONSE_OVERDUE]: {
    title: "Traffic control plan pending",
    guidance:
      "The traffic control consultant was engaged more than eleven working days ago and has not sent their plan through. The follow-up asks for an update on their thread; it closes itself when the plan arrives.",
    followUp: "Send a follow up",
  },
  [ComplianceAlertType.WASTE_MANAGEMENT_PLAN_OVERDUE]: {
    title: "Waste management plan pending",
    guidance:
      "The architect was asked for the waste management plan more than eleven working days ago and has not sent it. The follow-up goes on the thread they are already on; it closes itself when the plan arrives.",
    followUp: "Follow up with the architect",
  },

  // The two halves of the developer approval, which is the one loop on this
  // file that can go round twice. Each closes itself on a different event --
  // the verdict landing, and the replacement report landing -- so they are
  // worded to say which one the reader is waiting on.
  [ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE]: {
    title: "Developer approval pending",
    guidance:
      "The bushfire report went to the estate developer more than eleven working days ago and no decision has come back. The follow-up asks for one on their thread; it closes itself when they approve or reject the report, whether that arrives by email or somebody records it here.",
    followUp: "Send a follow up",
  },
  [ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE]: {
    title: "Revised bushfire report pending",
    guidance:
      "The developer rejected the report and the bushfire consultant was sent their reasons more than eleven working days ago. Nothing has come back. The follow-up goes on the consultant's thread; it closes itself when the revised report arrives, which is what goes back to the developer.",
    followUp: "Follow up with the consultant",
  },

  // -------------------------------------------------------------------
  // The portal waits.
  //
  // None of these has a chase, and for the same reason the planning
  // certificate above has none: there is nobody at the other end reading
  // email about this job. Each one is chased by ringing the body with the
  // reference number the block itself shows, which is why the guidance names
  // where to find that number rather than offering a button.
  // -------------------------------------------------------------------

  [ComplianceAlertType.ROAD_OPENING_DELAYED]: {
    title: "Road opening approval taking longer than usual",
    guidance:
      "The road opening and vehicle crossing application has been with the council past the fortnight it normally takes. Chase it with the council using the application number on the permit block, and tick it received once the approval lands. This closes itself when the approval is on the file.",
  },
  [ComplianceAlertType.LONG_SERVICE_LEVY_DELAYED]: {
    title: "Long service levy receipt outstanding",
    guidance:
      "The levy payment was recorded more than a working week ago and no receipt has been uploaded. Download it from the Long Service Corporation portal using the payment reference on the block. This closes itself when the receipt is on the file.",
  },
  [ComplianceAlertType.MINE_SUBSIDENCE_DELAYED]: {
    title: "Mine subsidence approval taking longer than usual",
    guidance:
      "Subsidence Advisory NSW has had the application past the three weeks it normally takes. Chase it using the application number on the block, and tick it received once the approval lands. This closes itself when the approval is on the file.",
  },
  [ComplianceAlertType.DA_DETERMINATION_OVERDUE]: {
    title: "Development application still undetermined",
    guidance:
      "The DA has been with the council for more than sixty working days, which is well past what a residential application normally takes. Ring the assessing officer using the DA number on the block. This closes itself when the determination is recorded.",
  },

  // -------------------------------------------------------------------
  // The two certificate applications.
  //
  // Chased the way every other portal wait is — by ringing, with the reference
  // off the block — so neither has a button. What is different is who is at the
  // other end: a CDC and a construction certificate are determined by the
  // registered certifier this file has been corresponding with for weeks, not
  // by a council. So the guidance names them, because there *is* somebody to
  // ring and they are already on the thread.
  // -------------------------------------------------------------------

  [ComplianceAlertType.CDC_DETERMINATION_OVERDUE]: {
    title: "CDC still undetermined",
    guidance:
      "The complying development certificate application has been with the certifier past the fourteen working days a determination normally takes. Check the portal for a request for further information — the clock stops while one is outstanding — and ring the certifier using the application number on the block. This closes itself when the determination is recorded or the certificate is on the file.",
  },
  [ComplianceAlertType.CC_DETERMINATION_OVERDUE]: {
    title: "Construction certificate still undetermined",
    guidance:
      "The construction certificate application has been with the certifier past the twenty-eight working days a determination normally takes. Check the portal for a request for further information and ring the certifier using the application number on the block. This closes itself when the determination is recorded or the certificate is on the file.",
  },

  // The developer sitting on the plans, which is a different wait from the same
  // developer sitting on the report. Worded to say which document, because the
  // two can be open together and "Developer approval pending" twice is a panel
  // nobody can act on.
  [ComplianceAlertType.DEVELOPER_PLANS_OVERDUE]: {
    title: "Developer approval of the plans pending",
    guidance:
      "The full architectural design went to the estate developer more than eleven working days ago and no decision has come back. Their covenant has to be satisfied before the application is lodged. The follow-up asks for a decision on their thread; it closes itself when they approve or reject the plans, whether that arrives by email or somebody records it here.",
    followUp: "Send a follow up",
  },

  // -------------------------------------------------------------------
  // The portal has said yes, and the document is still not here.
  //
  // The only three alerts on this file that are not a complaint. Each is raised
  // by a determination arriving as an email that carries no attachment: the
  // portal says the application has been approved and tells the applicant to
  // log in and fetch the certificate.
  //
  // No follow-up on any of them, and that absence means something different
  // here than it does on the portal waits above. There is nobody to chase
  // because there is nothing to chase — the work is done, and what is left is
  // one download by the person reading this line. Which is why each guidance
  // says the same two things: the email is not the document, and here is where
  // the document goes.
  // -------------------------------------------------------------------

  [ComplianceAlertType.CDC_DOWNLOAD_READY]: {
    title: "CDC approved — ready to download",
    guidance:
      "The certifier has determined the application and the complying development certificate is waiting on the NSW Planning Portal. Log in, download it, and upload it to the certificate block — the portal's email is a notification and does not carry the certificate. The compliance file closes once it and the HBCF cover are both on it.",
    tone: "positive",
  },
  [ComplianceAlertType.CC_DOWNLOAD_READY]: {
    title: "Construction certificate approved — ready to download",
    guidance:
      "The certifier has determined the application and the construction certificate is waiting on the NSW Planning Portal. Log in, download it, and upload it to the certificate block — the portal's email is a notification and does not carry the certificate. The compliance file closes once it and the HBCF cover are both on it.",
    tone: "positive",
  },
  [ComplianceAlertType.DA_DOWNLOAD_READY]: {
    title: "Development consent granted — ready to download",
    guidance:
      "The council has determined the application and the notice of determination is waiting on the NSW Planning Portal. Log in, download it, and upload it to the development application block. The certifier's checklist stays frozen until the notice itself is on the file — a ticked box is not something they can assess against.",
    tone: "positive",
  },
};


/**
 * How each source reads on the pill.
 *
 * Its own map rather than PARTY_LABEL, because the certifier is a source and
 * not an outreach party — and because the pill wording is "via the X", which
 * wants the lower-case form.
 */
export const ALERT_SOURCE_LABEL: Readonly<Record<ComplianceAlertSource, string>> = {
  [ComplianceAlertSource.SURVEYOR]: "surveyor",
  [ComplianceAlertSource.ARCHITECT]: "architect",
  [ComplianceAlertSource.COUNCIL]: "NSW Planning",
  [ComplianceAlertSource.CERTIFIER]: "certifier",
  [ComplianceAlertSource.BASIX_CONSULTANT]: "BASIX consultant",
  [ComplianceAlertSource.BUSHFIRE_CONSULTANT]: "bushfire consultant",
  [ComplianceAlertSource.STRUCTURAL_ENGINEER]: "structural engineer",
  [ComplianceAlertSource.WATER_AUTHORITY]: "water servicing coordinator",
  [ComplianceAlertSource.DEVELOPER]: "estate developer",
  [ComplianceAlertSource.TRAFFIC_CONSULTANT]: "traffic control consultant",
};
