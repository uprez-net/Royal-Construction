# Tender / Contract to Project Mapping

This document is the human-readable companion to the Phase 1 extraction schema in [types/project-extraction.ts](../../types/project-extraction.ts). It also aligns with the **Project from Offer** definitions in [CONTEXT.md](../../CONTEXT.md) and the Tender / Contract lifecycle in [docs/offer/OFFER-DESIGN.md](./OFFER-DESIGN.md).

The rules are simple:

- **Tender** is the primary source for scope, inclusions, exclusions, prices, and acceptance language.
- **Contract upload** is the primary source for post-signature administrative details such as signed date and MBA reference cues.
- If a value cannot be verified directly, leave it blank. Do not infer.

## Step 1. Project Overview

| Form field | Expected source section(s) |
| --- | --- |
| `projectName` | Tender cover / project title block; Contract header if the Tender is missing a title |
| `projectType` | Tender cover, scope summary, or headline project classification |
| `summary` | Tender executive summary, scope overview, or acceptance summary |

## Step 2. Legal and Administration

| Form field | Expected source section(s) |
| --- | --- |
| `legalAdministrationSiteAddress` | Tender cover, client/site header, Contract cover page |
| `legalAdministrationOwnerNames` | Tender cover, client block, signature block |
| `legalAdministrationOwnerEmails` | Tender cover, client contact block, Contract admin cover |
| `legalAdministrationOwnerPhones` | Tender cover, client contact block, Contract admin cover |
| `legalAdministrationCommencementTrigger` | Tender acceptance / commencement wording, Contract signature conditions |
| `legalAdministrationSignedDate` | Contract signature page, acceptance execution page |
| `legalAdministrationPcaInspector` | Tender admin section, contract admin notes, compliance references |

## Step 3. Commercials and Claims

| Form field | Expected source section(s) |
| --- | --- |
| `commercialsAndClaimsTotalContractSum` | Tender cover total, price summary, acceptance value |
| `commercialsAndClaimsTenderTotalPrice` | Tender cover, pricing summary |
| `commercialsAndClaimsContractPrice` | Tender cover, Contract price reference, acceptance value |
| `commercialsAndClaimsGstIncluded` | Tender cover GST statement, pricing notes |
| `commercialsAndClaimsGstAmount` | Tender cover, total price breakdown |
| `commercialsAndClaimsDepositValue` | Tender payment schedule, Contract deposit clause |
| `commercialsAndClaimsClaimStageSlabPercentage` | Tender payment schedule / progress claim clause |
| `commercialsAndClaimsClaimStageSlabDollarValue` | Tender payment schedule / progress claim clause |
| `commercialsAndClaimsVariationAdminFee` | Tender T&C / variations clause, Contract admin clause |
| `commercialsAndClaimsLatePenaltyRate` | Tender T&C / default interest / late payment clause |
| `commercialsAndClaimsPaymentStages` | Tender payment schedule section, Contract payment schedule references |

## Step 4. Sub Structure and Ground

| Form field | Expected source section(s) |
| --- | --- |
| `subStructureAndGroundConcreteSlabClass` | Tender structural scope, slab schedule, engineering notes |
| `subStructureAndGroundConcreteStrengthMpa` | Tender engineering / slab notes, specification pages |
| `subStructureAndGroundVapourBarrier` | Tender slab / waterproofing scope, engineering notes |
| `subStructureAndGroundTermiteSystem` | Tender site / structural / compliance notes |
| `subStructureAndGroundSewerConnection` | Tender services / site preparation section, Contract site services notes |

## Step 5. Shell and External

| Form field | Expected source section(s) |
| --- | --- |
| `shellAndExternalCeilingHeightGroundFloor` | Tender architectural schedule, plans, elevations |
| `shellAndExternalCeilingHeightFirstFloor` | Tender architectural schedule, plans, elevations |
| `shellAndExternalRoofingMaterial` | Tender roof / external envelope section |
| `shellAndExternalBrickAllowance` | Tender inclusions / allowances, external envelope scope |
| `shellAndExternalBrickCount` | Tender quantity schedule, external wall schedule, plans |
| `shellAndExternalSelectedBrickPrice` | Tender allowances / selected finish notes, pricing notes |
| `shellAndExternalWindowProvider` | Tender window / external joinery section |
| `shellAndExternalFloorAreaM2` | Tender cover, area schedule, plans, site summary |

## Step 6. Mechanical Details

| Form field | Expected source section(s) |
| --- | --- |
| `mechanicalDetailsAcSystemZones` | Tender mechanical / HVAC section |
| `mechanicalDetailsAcRequiredCapacityKw` | Tender mechanical / HVAC specification |
| `mechanicalDetailsAcInstalledCapacityKw` | Tender mechanical / HVAC specification |
| `mechanicalDetailsLightingCount` | Tender electrical section, lighting schedule |
| `mechanicalDetailsTenderLightingCount` | Tender electrical section, lighting schedule |
| `mechanicalDetailsPowerPointCount` | Tender electrical section, power schedule |
| `mechanicalDetailsExternalPower` | Tender electrical / external power notes |
| `mechanicalDetailsJointSealants` | Tender finishing / waterproofing / joinery detail notes |

## Step 7. Internal Fit Out and Finishes

| Form field | Expected source section(s) |
| --- | --- |
| `internalFitOutAndFinishesInternalDoorHeight` | Tender joinery / internal door schedule |
| `internalFitOutAndFinishesSkirtingSize` | Tender finishes schedule, internal trim notes |
| `internalFitOutAndFinishesStoneThickness` | Tender kitchen / bathroom / joinery section |
| `internalFitOutAndFinishesWaterfallEnds` | Tender kitchen / joinery scope |
| `internalFitOutAndFinishesTapwareFinish` | Tender fixtures / fittings / allowance section |
| `internalFitOutAndFinishesTilesProvisionRate` | Tender tiling / allowance section |
| `internalFitOutAndFinishesTileAllowance` | Tender allowances, PC items, finish schedule |
| `internalFitOutAndFinishesSelectedTilePrice` | Tender allowances, nominated finish references |
| `internalFitOutAndFinishesWetAreaSizeM2` | Tender wet area schedule, plans, room sizes |

## Step 8. Exclusions and Risks

| Form field | Expected source section(s) |
| --- | --- |
| `exclusionsAndRisksRetainingWalls` | Tender exclusions, site risk notes, scope caveats |
| `exclusionsAndRisksFencing` | Tender exclusions / allowances / external works |
| `exclusionsAndRisksBlinds` | Tender exclusions / PC item exclusions |
| `exclusionsAndRisksSolarProvisions` | Tender exclusions / electrical caveats |
| `exclusionsAndRisksRockExcavation` | Tender exclusions / site works / site risk section |
| `exclusionsAndRisksOwnerResponsibility` | Tender exclusions / owner supply items / responsibility notes |
| `exclusionsAndRisksVariationRequired` | Tender variation clause, exclusions, unresolved scope items |

## Step 9. Utility Infrastructure

| Form field | Expected source section(s) |
| --- | --- |
| `utilityInfrastructureElectricalPhase` | Tender electrical / supply section |
| `utilityInfrastructureCommunicationConduit` | Tender services / communications section |
| `utilityInfrastructureGasConnection` | Tender services / mechanical services section |
| `utilityInfrastructureFridgeWaterPoint` | Tender kitchen / plumbing / fit-out section |
| `utilityInfrastructureSmartLockBrand` | Tender hardware / door furniture / exclusions if nominated |

## Step 10. Wet Area Compliance and Site Logistics

| Form field | Expected source section(s) |
| --- | --- |
| `wetAreaComplianceWaterproofingStandard` | Tender wet area / waterproofing compliance section |
| `wetAreaComplianceShowerScreenType` | Tender bathroom fixtures / wet area section |
| `wetAreaComplianceTiledNicheCount` | Tender bathroom / tiling scope, room schedule |
| `wetAreaComplianceShowerCount` | Tender bathroom schedule, room schedule |
| `wetAreaComplianceFloorToCeilingTiles` | Tender tiling scope, bathroom finish schedule |
| `wetAreaComplianceFloorWasteType` | Tender bathroom / plumbing / drainage section |
| `safetyAndSiteLogisticsRoofGuardrails` | Tender safety / scaffold / fall protection section |
| `safetyAndSiteLogisticsSedimentControl` | Tender site preparation / erosion control section |
| `safetyAndSiteLogisticsScaffoldingSafety` | Tender safety / access / scaffolding section |
| `safetyAndSiteLogisticsTradeWaste` | Tender site logistics / waste management clause |
| `safetyAndSiteLogisticsFinalCleanStatus` | Tender handover / completion / cleaning section |

## Notes for Phase 2

- Keep values flat. If the source mentions a table, convert it into one primitive value per field or a flat array of strings.
- Do not emit raw JSON into any field.
- If a Tender section and Contract section both mention the same field, prefer the signed Contract for administrative facts and the Tender for scope facts.
- The extraction system prompt should reference this mapping verbatim enough that the model can select the right source section for each field.
