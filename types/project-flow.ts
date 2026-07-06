export type ProjectFlowSectionKey =
  | "legalAdministration"
  | "commercialsAndClaims"
  | "subStructureAndGround"
  | "shellAndExternal"
  | "mechanicalDetails"
  | "internalFitOutAndFinishes"
  | "exclusionsAndRisks"
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
  siteAddress: string;
  ownerContacts: ProjectOwnerContactDetails;
  commencementTrigger: string;
  signedDate: string;
  pcaInspector: string;
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
  concreteSlabClass: string;
  concreteStrengthMpa: number | null;
  vapourBarrier: string;
  termiteSystem: string;
  sewerConnection: string;
}

export interface ProjectShellAndExternalSection {
  ceilingHeightGroundFloor: string;
  ceilingHeightFirstFloor: string;
  roofingMaterial: string;
  brickAllowance: number | null;
  brickCount: number | null;
  selectedBrickPrice: number | null;
  windowProvider: string;
  floorAreaM2: number | null;
}

export interface ProjectMechanicalSection {
  acSystemZones: string;
  acRequiredCapacityKw: number | null;
  acInstalledCapacityKw: number | null;
  lightingCount: number | null;
  tenderLightingCount: number | null;
  powerPointCount: number | null;
  externalPower: string;
  jointSealants: string;
}

export interface ProjectFinishesSection {
  internalDoorHeight: string;
  skirtingSize: string;
  stoneThickness: string;
  waterfallEnds: string;
  tapwareFinish: string;
  tilesProvisionRate: string;
  tileAllowance: number | null;
  selectedTilePrice: number | null;
  wetAreaSizeM2: number | null;
}

export interface ProjectExclusionsSection {
  retainingWalls: string;
  fencing: string;
  blinds: string;
  solarProvisions: string;
  rockExcavation: string;
  ownerResponsibility: string[];
  variationRequired: string[];
}

export interface ProjectUtilityInfrastructureSection {
  electricalPhase: string;
  communicationConduit: string;
  gasConnection: string;
  fridgeWaterPoint: string;
  smartLockBrand: string;
}

export interface ProjectWetAreaSection {
  waterproofingStandard: string;
  showerScreenType: string;
  tiledNicheCount: number | null;
  showerCount: number | null;
  floorToCeilingTiles: string;
  floorWasteType: string;
}

export interface ProjectSafetySection {
  roofGuardrails: string;
  sedimentControl: string;
  scaffoldingSafety: string;
  tradeWaste: string;
  finalCleanStatus: string;
}

export interface ProjectExtractionDraft {
  projectName: string;
  projectType: string;
  summary: string;
  legalAdministration: ProjectLegalAdministrationSection;
  commercialsAndClaims: ProjectCommercialSection;
  subStructureAndGround: ProjectSubStructureSection;
  shellAndExternal: ProjectShellAndExternalSection;
  mechanicalDetails: ProjectMechanicalSection;
  internalFitOutAndFinishes: ProjectFinishesSection;
  exclusionsAndRisks: ProjectExclusionsSection;
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
