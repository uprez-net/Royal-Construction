export type ProjectFlowSectionKey =
  | "legalAdministration"
  | "commercialsAndClaims"
  | "subStructureAndGround"
  | "inclusionsAndExclusions"
  | "utilityInfrastructure"
  | "wetAreaCompliance"
  | "safetyAndSiteLogistics";

export type ProjectValidationSeverity = "info" | "warning" | "fail";

export interface ProjectValidationResult {
  id: string;
  section: ProjectFlowSectionKey | "general";
  fieldPath: string;
  severity: ProjectValidationSeverity;
  message: string;
  ownerResponsibility?: boolean;
  variationRequired?: boolean;
  resolvedValue?: string | number | boolean | null;
}

export interface ProjectConflictResult {
  fieldPath: string;
  tenderValue?: string | number | boolean | null;
  contractValue?: string | number | boolean | null;
  resolvedValue?: string | number | boolean | null;
  resolution:
    | "contract-wins"
    | "tender-wins"
    | "written-dimensions-win"
    | "manual-review";
  note?: string;
}

export interface ProjectSourceDocumentReference {
  fileId: string;
  fileName: string;
  url: string;
  /**
   * `tender` and `contract` are the two documents the extraction workflow runs
   * over. `hbcfInsurance` is the HBCF certificate uploaded later from the
   * Legal & Administration section, and is referenced from that section rather
   * than from the tender/contract `sourceDocuments` bundle.
   */
  kind: "tender" | "contract" | "hbcfInsurance";
}

export interface ProjectAutomationTriggers {
  orderReminders: boolean;
  rainDelayCalculations: boolean;
  noticeCountdowns: boolean;
}

export interface ProjectOwnerContactDetails {
  names: string[];
  emails: string[];
  phones: string[];
}

export interface ProjectPaymentStage {
  label: string;
  percentage: number | null;
  amount: number | null;
}

export interface ProjectLegalAdministrationSection {
  siteAddress: string | null;
  ownerContacts: ProjectOwnerContactDetails;
  commencementTrigger: string | null;
  signedDate: string | null;
  pcaInspector: string | null;
  /**
   * Insurance coverage window for the build, captured when the first Slab-stage
   * milestone is started (that stage is the physical start of construction).
   * Stored as `yyyy-MM-dd`, matching `signedDate`. Optional because every
   * requirements payload written before this field existed is missing it.
   */
  insuranceClaimStartDate?: string | null;
  insuranceClaimEndDate?: string | null;
  /**
   * HBCF (Home Building Compensation Fund) certificate number. Read off the
   * uploaded certificate by the HBCF extraction agent, and editable by hand
   * when the certificate is unreadable. Null until a certificate has been
   * uploaded and successfully read.
   */
  hbcfInsuranceNumber: string | null;
  /**
   * The uploaded HBCF certificate the number above was read from. Kept even
   * when extraction fails, so the document stays linked and the number can be
   * filled in manually.
   */
  hbcfInsuranceDocument: ProjectSourceDocumentReference | null;
}

export interface ProjectCommercialSection {
  totalContractSum: number | null;
  tenderTotalPrice: number | null;
  contractPrice: number | null;
  gstIncluded: boolean | null;
  gstAmount: number | null;
  depositValue: number | null;
  claimStageSlabPercentage: number | null;
  claimStageSlabDollarValue: number | null;
  variationAdminFee: number | null;
  latePenaltyRate: number | null;
  paymentStages: ProjectPaymentStage[];
}

export interface ProjectSubStructureSection {
  concreteSlabClass: string | null;
  concreteStrengthMpa: number | null;
  vapourBarrier: string | null;
  termiteSystem: string | null;
  sewerConnection: string | null;
}

export interface ProjectInclusionsExclusionsSection {
  inclusions: string[];
  exclusions: string[];
}

export interface ProjectUtilityInfrastructureSection {
  electricalPhase: string | null;
  communicationConduit: string | null;
  gasConnection: string | null;
  fridgeWaterPoint: string | null;
  smartLockBrand: string | null;
}

export interface ProjectWetAreaSection {
  waterproofingStandard: string | null;
  showerScreenType: string | null;
  tiledNicheCount: number | null;
  showerCount: number | null;
  floorToCeilingTiles: string | null;
  floorWasteType: string | null;
}

export interface ProjectSafetySection {
  roofGuardrails: string | null;
  sedimentControl: string | null;
  scaffoldingSafety: string | null;
  tradeWaste: string | null;
  finalCleanStatus: string | null;
}

export interface ProjectExtractionDraft {
  projectName: string;
  projectType: string;
  summary: string;
  legalAdministration: ProjectLegalAdministrationSection;
  commercialsAndClaims: ProjectCommercialSection;
  subStructureAndGround: ProjectSubStructureSection;
  inclusionsAndExclusions: ProjectInclusionsExclusionsSection;
  utilityInfrastructure: ProjectUtilityInfrastructureSection;
  wetAreaCompliance: ProjectWetAreaSection;
  safetyAndSiteLogistics: ProjectSafetySection;
  conflicts: ProjectConflictResult[];
  automationTriggers: ProjectAutomationTriggers;
}

export interface ProjectRequirementsPayload extends ProjectExtractionDraft {
  version: 1;
  sourceDocuments: {
    tender: ProjectSourceDocumentReference;
    contract: ProjectSourceDocumentReference;
  };
  validations: ProjectValidationResult[];
}

export interface ProjectDocumentBundle {
  tender: ProjectSourceDocumentReference;
  contract: ProjectSourceDocumentReference;
}
