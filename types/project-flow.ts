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
  resolution: "contract-wins" | "tender-wins" | "written-dimensions-win" | "manual-review";
  note?: string;
}

export interface ProjectSourceDocumentReference {
  fileId: string;
  fileName: string;
  url: string;
  kind: "tender" | "contract";
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
