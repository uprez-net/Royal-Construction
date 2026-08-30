import { revalidateTag } from "next/cache";

import { handleHbcfExtractionGeneration } from "@/lib/agent/hbcfExtractionAgent";
import { ocrPagesToText, processPDFWithMistral } from "@/lib/ocr";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";

/**
 * The shape the Overview tab stores a certificate reference in.
 *
 * Mirrors `ProjectSourceDocumentReference` as the HBCF block writes it. Written
 * here rather than imported because that type lives beside the form components,
 * and the four fields are the whole contract.
 */
type HbcfDocumentReference = {
  fileId: string;
  fileName: string;
  url: string;
  kind: "hbcfInsurance";
};

/**
 * Reads the certificate number off an uploaded HBCF certificate.
 *
 * Never throws. This runs behind a response that has already been sent, on top
 * of an upload that has already succeeded — a scanner that cannot read the
 * document leaves the number blank for somebody to type in, which is the same
 * place the Overview tab's own upload lands when extraction comes back empty.
 */
async function readHbcfNumber(url: string): Promise<string> {
  try {
    const markdown = ocrPagesToText(await processPDFWithMistral(url));
    if (!markdown) {
      return "";
    }
    const extraction = await handleHbcfExtractionGeneration({ markdown });
    return extraction.hbcfInsuranceNumber.trim();
  } catch (error) {
    console.error("Could not read the HBCF number off the certificate", error);
    return "";
  }
}

/**
 * Files a home insurance certificate on the project, not just the engagement.
 *
 * There is one certificate, and two places that care about it: the compliance
 * checklist needs it as evidence for the certifier, and the project's legal
 * administration needs the HBCF number off it — the header chip, the banner
 * above the tabs and the date blockers all read that number, and a project can
 * be held from starting for want of it. Uploading in Compliance used to satisfy
 * only the first, so a build with its certificate already collected still wore
 * "HBCF insurance number is not recorded" and had to be given the same PDF a
 * second time on the Overview tab.
 *
 * The number is only extracted when there is none. OCR plus a model round trip
 * is minutes of work, and a number somebody has already typed in is not
 * improved by a second opinion from a scanner — so a re-upload replaces the
 * document reference and leaves the number alone.
 *
 * Never throws, for the same reason `notifyCompliance` does not: the upload it
 * follows has already been committed, and failing it here would undo real work
 * to report a field that did not get filled in.
 */
export async function recordHomeInsuranceOnProject(params: {
  projectId: string;
  fileId: string;
}): Promise<void> {
  try {
    const [file, project] = await Promise.all([
      prisma.file.findUnique({
        where: { id: params.fileId },
        select: { id: true, filename: true, url: true },
      }),
      prisma.project.findUnique({
        where: { id: params.projectId },
        select: { requirements: true },
      }),
    ]);

    if (!file || !project) {
      return;
    }

    const requirements = (project.requirements ?? {}) as Record<
      string,
      unknown
    >;
    const legal = (requirements.legalAdministration ?? {}) as Record<
      string,
      unknown
    >;

    const recorded =
      typeof legal.hbcfInsuranceNumber === "string"
        ? legal.hbcfInsuranceNumber.trim()
        : "";
    const hbcfInsuranceNumber = recorded || (await readHbcfNumber(file.url));

    const hbcfInsuranceDocument: HbcfDocumentReference = {
      fileId: file.id,
      fileName: file.filename,
      url: file.url,
      kind: "hbcfInsurance",
    };

    await prisma.project.update({
      where: { id: params.projectId },
      data: {
        // Spread rather than replaced: `requirements` is one JSON column
        // holding every section of the Overview form, and writing only the
        // legal block into it would take the other nine with it.
        requirements: {
          ...requirements,
          legalAdministration: {
            ...legal,
            hbcfInsuranceNumber: hbcfInsuranceNumber || null,
            hbcfInsuranceDocument,
          },
        } as never,
      },
    });

    revalidateTag(`project-${params.projectId}`, CACHE_PROFILES.SHORT);
  } catch (error) {
    console.error(
      `Could not file the home insurance certificate on project ${params.projectId}`,
      error,
    );
  }
}
