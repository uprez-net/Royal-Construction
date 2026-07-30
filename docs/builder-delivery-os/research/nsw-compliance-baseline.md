# NSW compliance and approval baseline for Royal's pilot

**Research date:** 31 July 2026

**Jurisdiction:** New South Wales

**Pilot scope:** Royal Construction; residential building delivery; company/subcontractor/project compliance vault, expiry tracking, Project Approval Requirement checklists and evidence-pack generation.

## Status and limits

This note separates:

- **Regulatory fact** — a proposition supported by a current NSW Government, regulator or NSW legislation source.
- **MVP recommendation** — how the pilot should represent or operationalise that fact.

It is a product-research baseline, not legal advice. The product must not say that a checklist, uploaded document or generated evidence pack proves or guarantees regulatory compliance. Applicability depends on the work, contract value, building classification, land, approval pathway, consent conditions, licence class, employment arrangements and other project facts. Royal, its principal certifier and appropriately qualified advisers remain responsible for those decisions.

## Decision summary

The MVP should not ship one universal "NSW compliant" checklist. It should ship a Royal-controlled requirement catalogue with conditional templates and require a human to select or confirm each project's applicable set.

The smallest defensible baseline is:

1. **Company controls:** Royal's contractor licence and nominated qualified supervisor coverage, workers compensation evidence where required, and Royal-configured insurance evidence.
2. **Subcontractor/tradie controls:** entity and individual licence/class checks, white cards, activity-specific high-risk work licences, workers compensation evidence/statements where applicable, and Royal-configured contractual insurance.
3. **Project controls:** an explicit approval-pathway decision; the issued consent/CC or CDC; project-specific HBC cover where applicable; BASIX where applicable; principal certifier appointment and commencement notice; consent/certificate conditions; required inspections; trade completion certificates; applicable levy evidence; and the occupation certificate.
4. **WHS controls that intersect these modules:** principal-contractor/WHS plan status for construction projects, site induction evidence and SWMS dependencies for high-risk construction work. The MVP may store and gate this evidence, but it is not a replacement for a safety-management system.
5. **Every decision and document is versioned:** evidence has issuer, holder/subject, identifier, class/scope, issue and expiry dates where the source actually has them, project linkage, verification source/time/person and supersession history. Requirements have an applicability decision, rationale, source/version and human reviewer.

## 1. Company-level baseline

### 1.1 Contractor licence and nominated qualified supervisor

**Regulatory facts**

- A company or partnership needs a contractor licence before it contracts, subcontracts or advertises to do residential building work whose reasonable market cost is more than $5,000 including GST. Electrical wiring, plumbing/drainage/gasfitting, and air-conditioning/refrigeration work require licensing regardless of value. A licensed company or partnership must have a nominated qualified supervisor, and may need more than one to cover every work category on its licence. Company/partnership licences may be issued for 1, 3 or 5 years. ([Building Commission NSW — company and partnership licences](https://www.nsw.gov.au/business-and-economy/licences-and-credentials/building-and-trade-licences-and-registrations/company-and-partnership-licences))
- A company/partnership must notify Building Commission NSW within 7 days of relevant changes, including when a nominated qualified supervisor leaves. ([Building Commission NSW — company and partnership licences](https://www.nsw.gov.au/business-and-economy/licences-and-credentials/building-and-trade-licences-and-registrations/company-and-partnership-licences))
- The official home-building licence check exposes the holder, licence/certificate type, categories, expiry, status, conditions, suspensions/cancellations and specified enforcement information. ([NSW Fair Trading — home building licence check](https://www.fairtrading.nsw.gov.au/help-centre/online-tools/home-building-licence-check))
- If a licence, certificate or registration is not renewed by its due date, it expires and no longer authorises work. Building Commission NSW says timely renewal remains the holder's responsibility. ([Building Commission NSW — renew, restore or replace](https://www.nsw.gov.au/business-and-economy/licences-and-credentials/building-and-trade-licences-and-registrations/renew-restore-or-replace))

**MVP recommendation**

Maintain these versioned Compliance Evidence records:

- Royal company contractor licence: legal holder name/ABN, number, categories, conditions, status, issue/expiry dates and source image/document.
- Each nominated qualified supervisor's individual contractor licence or qualified supervisor certificate, categories/conditions and the nomination relationship to Royal.
- A dated official-register verification result for both company and supervisor, separate from the uploaded card/certificate.

The legal entity that contracts must match the licensed entity; an individual director's or employee's licence is not a substitute for the company's contractor licence. Expiry alerts should use the actual evidence expiry date, not assume a standard term. A separate immediate exception should fire when supervisor coverage no longer spans every category Royal relies on; a future expiry alert alone cannot represent the 7-day change-notification risk.

### 1.2 Workers compensation

**Regulatory facts**

- An NSW employer is exempt from holding a workers compensation policy only if all listed criteria are met: annual wages of $7,500 or less, no apprentice or trainee, not a member of a related-business group for premium purposes, and not in a zero-threshold industry. If circumstances change, the employer must obtain a policy immediately. ([SIRA — exemptions from holding a workers compensation policy](https://www.sira.nsw.gov.au/workers-compensation/exemptions))
- Worker/deemed-worker status is fact-dependent. SIRA states that calling someone a contractor or giving them an ABN does not settle their status, and recommends professional advice for a specific arrangement. ([SIRA — worker or contractor tool](https://www.sira.nsw.gov.au/workers-compensation/worker-or-contractor-status-tool))

**MVP recommendation**

For Royal, store the current workers compensation Certificate of Currency and its stated coverage period as company evidence. Store the exemption decision only if Royal has a reviewed basis for it; do not calculate the exemption from incomplete payroll data. The pilot should present policy expiry as an evidence expiry, not make an automated conclusion about who is a worker or deemed worker.

### 1.3 HBC eligibility and general insurance

**Regulatory facts**

- Home Building Compensation (HBC/HBCF) cover is project-specific: the principal contractor must obtain cover for applicable NSW home-building work over $20,000 including GST. Related contracts are aggregated; the policy must be in the same legal name as the contracting principal, and employees/subcontractors cannot insure in place of that principal. Prescribed exemptions mean value alone is not a complete applicability test. ([SIRA — insurance obligations for residential building work](https://www.sira.nsw.gov.au/resources-library/home-building-compensation-resources/publications/insurance-obligations-for-residential-building-works), [SIRA — HBC exemptions](https://www.sira.nsw.gov.au/home-building-compensation/exemptions-from-the-home-building-compensation-scheme))
- NSW Fair Trading distinguishes HBC cover from additional insurances in its home-building contracts: those additional insurances are recommended for consumer protection, not generally required by the Home Building Act 1989. ([NSW Fair Trading — home building contracts](https://www.fairtrading.nsw.gov.au/housing-and-property/building-and-renovating/preparing-to-build-and-renovate/contracts/home-building-contracts))

**MVP recommendation**

- Royal may retain HBCF eligibility/limits as company evidence because it affects its ability to obtain job certificates, but the Project Approval Requirement must point to the **job-specific HBC Certificate of Insurance**, not treat company eligibility as cover for a project.
- Public liability, contract works/property damage, motor vehicle and professional indemnity Certificates of Currency should be Royal-configured requirement types. The pilot must not label every one as universally mandated by NSW home-building law. Store the insurer, insured legal entity, policy number, coverage type/limit, exclusions if reviewed, and the period printed on the certificate.

## 2. Subcontractor and tradie baseline

### 2.1 Building and specialist-work authorities

**Regulatory facts**

- Residential building work above $5,000 including GST requires an appropriate licence or certificate; specialist electrical, plumbing, drainage, gasfitting and air-conditioning/refrigeration work requires authority regardless of cost. The official register exposes category, status, conditions and expiry. ([NSW Fair Trading — home building licence check](https://www.fairtrading.nsw.gov.au/help-centre/online-tools/home-building-licence-check))
- A general building contract can include specialist work, but unless the builder itself holds the specialist category, that work must be subcontracted to a contractor licensed in the relevant specialist category and appropriately supervised by the holder of the relevant endorsed licence or qualified supervisor certificate. ([Building Commission NSW — general building work](https://www.nsw.gov.au/business-and-economy/licences-and-credentials/building-and-trade-licences-and-registrations/general-building-work))

**MVP recommendation**

Represent the subcontractor business and each relevant individual as separate Compliance Subjects:

- business/entity contractor licence and ABN/legal-name match;
- individual contractor licence, qualified supervisor certificate or tradesperson certificate as applicable;
- work categories/classes and conditions;
- official-register verification, verifier and timestamp;
- an explicit match between the assigned work package and the authority relied upon.

The app should detect missing/expired evidence and obvious category mismatches configured by Royal. A human must decide whether a particular scope is residential building work, specialist work and adequately supervised.

### 2.2 White cards and site induction

**Regulatory facts**

- A person carrying out construction work needs general construction induction evidence (the white card). A training statement may be used for 60 days while the card is pending; workers should carry their card and must also take part in a site induction for each new construction site. ([Service NSW — apply for a white card](https://www.service.nsw.gov.au/transaction/apply-for-a-general-construction-induction-card-white-card))
- A white card has no ordinary calendar renewal cycle stated by Service NSW, but becomes void if its holder has not done construction work for 2 consecutive years or more. ([Service NSW — replace a white card](https://www.service.nsw.gov.au/transaction/replace-general-construction-induction-card-white-card))
- NSW recognises interstate induction cards only while they remain recognised by the issuing jurisdiction and are not cancelled, suspended or expired; the same 2-year absence rule applies. ([SafeWork NSW — recognition of general construction induction cards](https://www.safework.nsw.gov.au/resource-library/licence-and-registrations/recognition-of-general-construction-induction-training-cards-fact-sheet))

**MVP recommendation**

Do not invent an annual white-card expiry. Store card jurisdiction/number/issue date and verification, plus a human attestation or reviewed last-construction-work date where Royal chooses to rely on the 2-year continuity rule. Store project/site induction as separate, project-scoped evidence with completion date and version of the induction content.

### 2.3 High-risk work licences and SWMS

**Regulatory facts**

- High-risk work requires the relevant licence class. NSW high-risk work licences expire after 5 years; added classes share the licence's existing expiry date. ([SafeWork NSW — high risk work licences](https://www.safework.nsw.gov.au/hazards-a-z?a=382727))
- A PCBU carrying out high-risk construction work must ensure a site-specific SWMS is prepared before that work starts, used for the work and reviewed when relevant circumstances or controls change. ([SafeWork NSW — prepare a safe work method statement](https://www.safework.nsw.gov.au/your-industry/construction/construction/general-requirements/prepare-safe-work-method-statement))

**MVP recommendation**

Make high-risk work licence classes and SWMS conditional on the actual assigned activity. Treat a SWMS as versioned, project/work-package evidence with approval/status and supersession—not as a credential with an arbitrary expiry date. Gate the relevant high-risk activity, not every project, on the accepted current SWMS.

### 2.4 Subcontractor workers compensation and insurance

**Regulatory facts**

- For workers compensation purposes, a subcontractor may still be a worker or deemed worker. SIRA states that a principal contractor can be liable for subcontractor premiums under section 175B(2), but that liability does not arise where the principal receives the prescribed written statement that the subcontractor has covered its workers/deemed workers for the contract period. The current NSW subcontractor statement says the recipient must keep it for 7 years. ([SIRA — worker or contractor tool](https://www.sira.nsw.gov.au/workers-compensation/worker-or-contractor-status-tool), [Revenue NSW — subcontractor statement form](https://www.revenue.nsw.gov.au/help-centre/resources-library/forms/payroll/subcontractor-statement-worker-compensation-payroll-tax-opt011.pdf))

**MVP recommendation**

Royal's minimum configurable subcontractor pack should include:

- workers compensation Certificate of Currency when the subcontractor is an employer;
- the relevant subcontractor written statement for the contract period where Royal relies on it;
- public liability and any other insurance Royal's subcontract requires.

The product must not determine worker/deemed-worker status or infer that an ABN eliminates workers compensation exposure. Evidence of public liability is a Royal contractual/risk control unless a more specific legal, approval or contract requirement applies.

## 3. Project approval and inspection baseline

### 3.1 Decide and record the approval pathway

**Regulatory facts**

- Small residential development can be exempt development, complying development or development requiring consent. Exempt development needs no planning/building approval only when all relevant standards and land requirements are met. A complying development certificate (CDC) is a combined planning and construction approval for qualifying work. Other development generally proceeds through development consent (DA) and then a construction certificate (CC). ([NSW Planning — do I need consent from my council?](https://www.planning.nsw.gov.au/for-homeowners/your-guide-to-the-da-process/getting-started/do-i-need-consent-from-my-council))
- For a DA pathway, construction cannot start until a CC has been issued. A CC issued after work starts is invalid. A separate CC is not needed where a CDC authorises the work. ([Building Commission NSW — approvals needed for your building project](https://www.nsw.gov.au/housing-and-construction/building-or-renovating-a-home/preparing/approvals))
- A development consent generally lapses after 5 years unless the consent authority specifies a shorter permitted period or relevant physical commencement prevents lapse. A CDC has its own rule: it lapses 5 years after the endorsed date unless development physically commences within that period. ([Environmental Planning and Assessment Act 1979, sections 4.29 and 4.53](https://legislation.nsw.gov.au/view/whole/html/inforce/current/act-1979-203#sec.4.29))

**MVP recommendation**

Create a mandatory `approval pathway` Project Approval Requirement with one reviewed result:

- exempt development;
- CDC;
- DA + CC; or
- another pathway escalated for specialist review.

For exempt development, retain the dated assessment, property/planning inputs, applicable code/standards and the human who accepted the conclusion. "No certificate required" is a decision with evidence, not an absent checklist. Other approvals and private restrictions may still apply even when planning/building approval is not required.

For DA/CDC evidence, store the approval identifier, authority/certifier, issue and lapse dates stated by the instrument, approved plans, conditions and source. Do not compute final legal status solely from issue date: the instrument may specify a period and physical commencement is a legal/factual question. A changed approved plan must trigger human classification as CC-consistent, a DA modification, a CDC modification or a new approval.

### 3.2 BASIX

**Regulatory facts**

- BASIX applies to all new residential dwellings, alterations/additions costing $50,000 or more, and swimming pools of 40,000 litres or more. The BASIX certificate is submitted with the DA or CDC and records design commitments. ([NSW Planning Portal — about BASIX](https://www.planningportal.nsw.gov.au/basix/about-basix))
- If a project changes, the BASIX assessment may need revision and re-lodgement. The certifying authority checks the applicable commitments and requires the BASIX certificate in the occupation-certificate process. ([NSW Planning Portal — BASIX and planning approvals](https://www.planningportal.nsw.gov.au/basix/about-basix/BASIX-and-planning-approvals))

**MVP recommendation**

Make BASIX a conditional, versioned Project Approval Requirement. Link the current BASIX certificate to the approved plan revision and preserve superseded versions; do not treat the first certificate as permanently valid after design changes.

### 3.3 Principal certifier, commencement and consent conditions

**Regulatory facts**

- Approval-required work needs a principal certifier before work starts. For the DA pathway, the principal certifier undertakes critical-stage inspections; the principal certifier must notify the council (and a separate consent authority, if relevant) of appointment at least 2 days before work starts. The principal certifier must also be told whether the work is by an owner-builder or licensed contractor and that contractor's name. ([Building Commission NSW — approvals needed for your building project](https://www.nsw.gov.au/housing-and-construction/building-or-renovating-a-home/preparing/approvals))
- Development-consent conditions can impose requirements before CC, before work, during construction and before OC, in addition to standard requirements. ([NSW Planning — determination](https://www.planning.nsw.gov.au/assess-and-regulate/development-assessment/your-guide-to-the-da-process/stage-4-determination))

**MVP recommendation**

Store the principal-certifier appointment/contract, appointment notice/reference and commencement notification as separate evidence. Import or manually transcribe each consent/CDC condition that affects delivery into an atomic Project Approval Requirement with:

- source condition number and verbatim source excerpt;
- applicability and reviewer;
- responsible party;
- due milestone/date;
- prerequisites/dependants;
- required evidence type;
- status, acceptance actor/date and any exception rationale.

The app may identify incomplete dependencies, but only Royal/certifier review can decide that a condition has been satisfied.

### 3.4 Critical-stage and additional inspections

**Regulatory facts**

For class 1 or 10 building work, the current NSW certification regulation specifies inspections:

1. after excavation and before placement of a footing;
2. before pouring an in-situ reinforced concrete building element;
3. before covering framework for a floor, wall, roof or other building element;
4. before covering waterproofing in a wet area;
5. before covering stormwater drainage connections; and
6. after completion and before an occupation certificate (the final critical-stage inspection).

The regulation sets different stages for other building classes. ([Environmental Planning and Assessment (Development Certification and Fire Safety) Regulation 2021, section 61](https://legislation.nsw.gov.au/view/whole/html/inforce/current/sl-2021-0689))

The principal contractor or owner-builder must give the principal certifier at least 48 hours' notice before a required inspection. ([Environmental Planning and Assessment (Development Certification and Fire Safety) Regulation 2021, section 65](https://legislation.nsw.gov.au/view/whole/html/inforce/current/sl-2021-0689#sec.65))

**MVP recommendation**

Seed class 1/10 inspection templates but require confirmation of the National Construction Code building classification and the principal certifier's project-specific inspection schedule. Each inspection should carry requested/booking/completed/result states, the inspecting certifier, inspection record, defects/directions and close-out evidence. A failed, missed or not-yet-completed inspection must not be represented as compliant merely because a file was uploaded.

Additional inspections and hold points imposed by the approval, council, certifier, engineer, utility or Royal must remain configurable.

### 3.5 HBC cover, contract controls and long-service levy

**Regulatory facts**

- NSW residential building work over $20,000 including GST generally requires a project HBC Certificate of Insurance, subject to exemptions. Cover must be in place before work starts or any payment (including a deposit) is requested or accepted, and it must be in the same legal name as the contracting principal. ([SIRA — insurance obligations for residential building work](https://www.sira.nsw.gov.au/resources-library/home-building-compensation-resources/publications/insurance-obligations-for-residential-building-works))
- Residential building work over $5,000 requires a written contract; $5,000–$20,000 work uses the small-job requirements and work over $20,000 uses the more extensive large-job requirements. Deposits may not exceed 10% of the contract price. Statutory warranties run for 6 years for major defects and 2 years for other defects from completion. ([Building Commission NSW — contracts for residential building work](https://www.nsw.gov.au/housing-and-construction/building-or-renovating-a-home/preparing/contracts))
- The NSW building and construction long-service levy applies to projects costing $250,000 or more including GST, at 0.25% of total work cost, subject to exemptions. It must be paid before work starts, and a council/certifier cannot release a CC or CDC until the applicable levy is paid. ([NSW Government/Long Service Corporation — long-service levy](https://www.nsw.gov.au/employment/rights-responsibilities/portable-long-service/bci-long-service-payments-scheme/long-service-levy))

**MVP recommendation**

Use hard pre-start dependencies for the reviewed applicable items:

- executed correct-form residential building contract and Consumer Building Guide acknowledgement;
- job-specific HBC Certificate of Insurance, with insured party/site/contractor/contract details matched;
- deposit control/record;
- long-service levy receipt or reviewed exemption.

Store contract variations and cost changes as triggers for human re-assessment. In particular, a project crossing the $20,000 HBC threshold or $250,000 levy threshold cannot safely rely on its original applicability decision.

### 3.6 WHS project evidence

**Regulatory facts**

- Construction work valued at $250,000 or more is a construction project for these NSW WHS controls and must have a principal contractor. The principal contractor must prepare a written WHS management plan before work starts, keep it current and available, and manage collection/review of SWMS. ([SafeWork NSW — undertaking a construction project](https://www.safework.nsw.gov.au/your-industry/construction/construction/general-requirements/undertaking-a-construction-project))
- A SWMS is required before high-risk construction work starts, including when high-risk work is performed by a subcontracting PCBU. ([SafeWork NSW — prepare a safe work method statement](https://www.safework.nsw.gov.au/your-industry/construction/construction/general-requirements/prepare-safe-work-method-statement))

**MVP recommendation**

For the pilot, represent principal-contractor appointment, the current WHS management plan, site rules/induction and work-package SWMS as project evidence and dependencies. Do not attempt to automate hazard identification, risk-control adequacy, consultation or live site compliance.

### 3.7 Completion and trade certificates

**Regulatory facts**

- An occupation certificate (OC) authorises occupation/use of a new building or change of use. It can be issued only when required regulatory standards are met and the building is suitable for its classification; the application can require consent/CDC, CC, fire-safety, compliance and council-specific documents. A whole-building OC must be obtained within 5 years after the first partial OC. ([Service NSW — apply for an occupation certificate](https://www.service.nsw.gov.au/transaction/apply-for-an-occupation-certificate), [Environmental Planning and Assessment (Development Certification and Fire Safety) Regulation 2021, section 53](https://legislation.nsw.gov.au/view/whole/html/inforce/current/sl-2021-0689#sec.53))
- Electricians must submit a Certificate of Compliance for Electrical Work (CCEW) after testing, no later than 7 days after the test. From 1 July 2026 CCEWs must be submitted through the BCNSW eCert portal. ([Building Commission NSW — electrical compliance requirements](https://www.nsw.gov.au/housing-and-construction/compliance-and-regulation/electricians/electrical-compliance-requirements))
- For plumbing/drainage work, the responsible plumber/drainer may need a Notice of Work before starting, and must complete/provide a Certificate of Compliance at completion. Drainage work also produces a Sewer Service Diagram; the inspection/submission route varies between Building Commission NSW service areas and local plumbing regulators. ([Building Commission NSW — plumbing inspection documents](https://www.nsw.gov.au/housing-and-construction/compliance-and-regulation/plumbers-and-drainers/plumbing-inspection-documents), [Building Commission NSW — local plumbing regulators](https://www.nsw.gov.au/housing-and-construction/compliance-and-regulation/plumbers-and-drainers/regional-inspections/local-regulators))
- Gas work produces a Certificate of Compliance for network gas or a Certificate of Inspection for bottled gas; gas certificates moved to the BCNSW eCert workflow in March 2026. ([Building Commission NSW — using a gasfitter](https://www.nsw.gov.au/housing-and-construction/building-or-renovating-a-home/preparing/using-a-gasfitter), [Building Commission NSW — eCert portal](https://www.nsw.gov.au/housing-and-construction/compliance-and-regulation/ecert-portal))

**MVP recommendation**

The project evidence catalogue should at least support:

- OC application and issued whole/partial OC;
- final critical-stage inspection result and defect/direction close-out;
- CCEW;
- plumbing/drainage Notice of Work, inspection records, Certificate of Compliance and Sewer Service Diagram;
- gas Certificate of Compliance or Certificate of Inspection where applicable;
- engineer, surveyor, waterproofing, fire-safety, utility and product certificates when required by the approved documents, consent, certifier or Royal.

Trade/completion certificates are immutable point-in-time evidence, not renewable credentials. Corrections or replacements should be new versions linked to the superseded record.

### 3.8 Higher-risk residential building classes

**Regulatory facts**

Class 2, 3 and 9c buildings (and mixed-use buildings containing those parts) are subject to additional Design and Building Practitioners controls. Certifiers must obtain the required regulated designs and design-compliance declarations before issuing the relevant CC/CDC; completion/occupation also has declaration and Planning Portal gates. ([Building Commission NSW — certifier obligations for regulated buildings](https://www.nsw.gov.au/housing-and-construction/compliance-and-regulation/professionals-working-on-regulated-buildings/certifiers))

**MVP recommendation**

Do not hard-code Royal's pilot as class 1 only. If Royal accepts class 2, 3 or 9c work, require a separate reviewed template set for registered practitioners, regulated designs/declarations, variations, expected-completion/occupation processes and any strata bond/levy obligations. Until that template is configured and reviewed, surface the project as requiring specialist compliance setup rather than reusing the class 1 checklist.

## 4. Dependency model for the three-module MVP

The following is a **product recommendation**, not a complete statement of law:

```text
reviewed project facts
  -> approval-pathway decision
     -> exempt assessment accepted
        OR
     -> DA consent -> conditions before CC -> CC
        OR
     -> CDC
  -> current approved plans + BASIX (if applicable)
  -> principal certifier appointed + commencement notice
  -> HBC certificate / levy receipt / pre-start conditions (if applicable)
  -> construction may start
  -> stage-specific prerequisites + inspections before work is covered
  -> trade certificates + condition close-out + final inspection
  -> occupation certificate
  -> evidence-pack snapshot
```

The engine should distinguish:

- **evidence expiry** — a licence or policy reaches its stated expiry;
- **status invalidation** — suspension, cancellation, scope/condition change or lost supervisor coverage;
- **deadline** — notice, inspection booking or consent-condition due date;
- **event-triggered revalidation** — cost, design, scope, contractor, certifier or building-class change;
- **point-in-time evidence** — an inspection result or completion certificate that does not "expire" but may be superseded/corrected;
- **human decision** — applicability or adequacy that the system may route but must not invent.

## 5. Minimum evidence-pack semantics

An evidence pack should be described as a dated operational record, not a government certificate or legal opinion. It should include:

- project identity, site, building classification and approval pathway;
- the requirement catalogue/version used;
- every Project Approval Requirement with status, applicability decision, owner, dependencies and source condition;
- the exact Compliance Evidence version accepted for each requirement;
- licence/register verification source and timestamp;
- approval/certifier/inspection/trade-certificate identifiers and dates;
- open, failed, waived, superseded or not-applicable items with the human reason and actor;
- generation timestamp and a warning that source status can change after generation.

The pack must not silently omit failed or missing requirements, call user-uploaded evidence regulator-verified, or flatten a superseded document into the current version.

## 6. Human-verification and Royal-configuration boundaries

The MVP must route, record and expose these decisions rather than answer them automatically:

1. Whether proposed work is exempt, complying or DA development, including land constraints and applicable planning instruments.
2. Building classification and whether class 2/3/9c or another specialist regime applies.
3. Whether work is residential building work, specialist work, over a value threshold or within an exemption.
4. Whether a company/individual licence category, condition and supervision arrangement covers the exact work package.
5. Whether a person is a worker, deemed worker or contractor for workers compensation.
6. Whether HBC cover is required, whether an exemption applies, and whether the issued job certificate matches the parties/site/scope.
7. The meaning and satisfaction of every DA/CDC/CC condition and every certifier/council hold point.
8. Whether a change to cost, design, scope, sequencing, contractor, certifier or approved plans requires a new approval, modification, certificate, inspection or evidence version.
9. Whether an inspection, SWMS, certificate, policy or other evidence is authentic, adequate and accepted by the responsible authority/person.
10. Royal's contractual insurance types, limits, lead times, escalation rules and who may approve an exception.

## 7. Validity and change-watch summary

| Evidence/decision | Supported validity rule | Pilot behaviour |
| --- | --- | --- |
| Company/building/trade licence or certificate | Common issue terms are 1, 3 or 5 years; actual authority ends at the recorded expiry and can also be suspended/cancelled/conditioned | Track actual expiry and official status; reverify at onboarding, before assignment and on Royal's chosen cadence |
| Nominated qualified supervisor relationship | No useful "expiry"; change can create a 7-day notification obligation | Treat departure/category-gap as immediate invalidation |
| Workers compensation/public liability CoC | Use the coverage dates printed by the insurer | Expiry alert; human reviews entity/scope/limits |
| White card | No routine expiry stated; void after 2 consecutive years out of construction | No invented annual expiry; capture continuity review |
| High-risk work licence | 5 years; added classes share existing expiry | Track actual licence/class and expiry |
| DA consent / CDC | DA consent is generally 5 years but may have a permitted shorter period; CDC has a 5-year statutory period; relevant physical commencement can prevent lapse | Store instrument's date/condition and human-confirmed commencement; do not calculate final legal status alone |
| BASIX/approved plans | Change-sensitive, not a simple renewable credential | Revalidate on design/approval revision |
| HBC Certificate of Insurance | Job-specific and required before work/payment when applicable | Match job/parties; prerequisite rather than company credential |
| SWMS/WHS plan | Must be current for the work and reviewed on relevant change | Version/event based; no arbitrary expiry |
| Inspection/trade compliance certificate/OC | Point-in-time result/instrument | Immutable version; correction or replacement supersedes |

Primary sources can change. Thresholds and regulator workflows should therefore be configuration data with source URL, source retrieval date and a policy-review date—not constants buried only in application code. As of this research date, NSW's proposed complying-development variations pathway was still under consideration and must not be modelled as operative law; the approval catalogue should be reviewed again before pilot go-live. ([NSW Planning Portal — proposed CDC variations](https://www.planningportal.nsw.gov.au/draftplans/under-consideration/variations-and-changes-complying-development-explanation-intended-effect))

## Source-quality caveats

- Sources are limited to NSW legislation, NSW Government agencies and scheme regulators. No trade-association, insurer-broker, law-firm or other secondary guidance is used.
- Agency guidance is generally clearer operationally than legislation, but it is still general guidance. Where a project-specific instrument, current legislation or regulator decision differs, that authoritative instrument controls.
- NSW Government pages are actively being reorganised between Building Commission NSW, Service NSW, SafeWork NSW, SIRA, icare and the Planning Portal. Direct URLs and stated rules were checked on 31 July 2026, but link locations and portal workflows may change.
- This is a baseline for the named three modules, not an exhaustive register of planning, environmental, WHS, employment, tax, security-of-payment, privacy, accessibility, heritage, utility, strata, fire-safety or product-compliance law.
