import { COMPANY_INFO } from "@/constants/offerFileContent";
import { OfferFile } from "@/context/ChatContext";
import { dateFormat } from "@/utils/formatters";
import { generateSafeOfferHTML } from "@/utils/handle-offer-template";

interface OfferFileTemplateProps extends OfferFile {
  ref?: React.Ref<HTMLIFrameElement>;
  customerName?: string;
  projectName?: string;
  siteLocation?: string;
  proposalDate?: string;
  revisionDate?: string;
  creatorName?: string;
  contractAmount?: string;
}

export function OfferFileTemplate({
  projectWelcomeMessage,
  facadeOptions,
  termsAndConditions,
  revisionChanges,
  projectScope,
  fixedPriceItems,
  promotionalUpgrades,
  ref,
  customerName = "Client",
  projectName,
  siteLocation,
  proposalDate = dateFormat.format(new Date()),
  revisionDate,
  creatorName = COMPANY_INFO.director,
  contractAmount = "$X,XXX",
}: OfferFileTemplateProps) {
  const cleanedHtml = generateSafeOfferHTML({
    projectWelcomeMessage,
    facadeOptions,
    termsAndConditions,
    revisionChanges,
    projectScope,
    fixedPriceItems,
    promotionalUpgrades,
    customerName,
    projectName,
    siteLocation,
    proposalDate,
    revisionDate,
    creatorName,
    contractAmount,
  });

  return (
    <iframe
      ref={ref}
      sandbox="allow-same-origin"
      title="Offer Preview"
      srcDoc={cleanedHtml}
      className="block h-full min-h-0 w-full rounded-lg border border-border bg-card shadow-sm"
      style={{ colorScheme: "light" }}
    />
  );
}
