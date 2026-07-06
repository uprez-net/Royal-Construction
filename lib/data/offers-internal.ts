import "server-only";

import { Prisma } from "@prisma/client";
import { revalidateTag } from "next/cache";
import type { OfferFile } from "@/context/ChatContext";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";

export interface CreateOfferInput {
    leadId: number;
    offerFileInput: {
        id: string;
        filename: string;
        fileType: string;
        filesize: number;
        url: string;
        offerContent: OfferFile;
    };
    amount: string;
    gstAmount: string;
    totalAmount: string;
    offerItems: {
        id: string;
        item: string;
        description: string;
        quantity: number;
        unitPrice: string;
        totalPrice: string;
        unit: string;
    }[];
}

export const createOrUpdateOfferInternal = async ({
    leadId,
    offerFileInput,
    amount,
    gstAmount,
    totalAmount,
    offerItems,
}: CreateOfferInput) => {
    const { version, newOffer, newOfferFile, offerItemsData } = await prisma.$transaction(async (tx) => {
        const version = await tx.offerFile.count({
            where: { offer: { leadId } },
        }) + 1;
        // A Lead can now have many offer revisions; update the active one or
        // create the first. (Replaces upsert-by-leadId, which required a
        // unique leadId that no longer exists.)
        const existingOffer = await tx.offer.findFirst({
            where: { leadId, isActive: true },
            orderBy: { createdAt: "desc" },
        });
        const offerAmounts = {
            amount: new Prisma.Decimal(amount),
            gstAmount: new Prisma.Decimal(gstAmount),
            totalAmount: new Prisma.Decimal(totalAmount),
        };
        const newOffer = existingOffer
            ? await tx.offer.update({
                where: { id: existingOffer.id },
                data: offerAmounts,
                include: { lead: true },
            })
            : await tx.offer.create({
                data: { leadId, ...offerAmounts },
                include: { lead: true },
            });

        const newOfferFile = await tx.offerFile.create({
            data: {
                id: offerFileInput.id,
                offerId: newOffer.id,
                filename: offerFileInput.filename,
                fileType: offerFileInput.fileType,
                filesize: offerFileInput.filesize,
                url: offerFileInput.url,
                offerContent: offerFileInput.offerContent as Prisma.InputJsonValue,
                version: version,
            },
        });

        const offerItemsData = await tx.offerItem.createManyAndReturn({
            data: offerItems.map(item => ({
                id: item.id,
                offerId: newOffer.id,
                item: item.item,
                description: item.description,
                quantity: item.quantity,
                unitPrice: new Prisma.Decimal(item.unitPrice),
                totalPrice: new Prisma.Decimal(item.totalPrice),
                unit: item.unit,
                version: version,
            })),
        });

        return { version, newOffer, newOfferFile, offerItemsData };
    });

    revalidateTag("offers", CACHE_PROFILES.MEDIUM);
    revalidateTag(`offer-${newOffer.id}`, CACHE_PROFILES.MEDIUM);
    revalidateTag(`offer-lead-${newOffer.leadId}`, CACHE_PROFILES.MEDIUM);

    return {
        ...newOffer,
        amount: newOffer.amount.toString(),
        gstAmount: newOffer.gstAmount.toString(),
        totalAmount: newOffer.totalAmount.toString(),
        version: version,
        newOfferItems: offerItemsData.map(item => ({
            ...item,
            unitPrice: item.unitPrice.toString(),
            totalPrice: item.totalPrice.toString(),
        })) ?? [],
        newOfferFile: {
            ...newOfferFile,
            offerContent: newOfferFile.offerContent as OfferFile,
        },
    };
}
