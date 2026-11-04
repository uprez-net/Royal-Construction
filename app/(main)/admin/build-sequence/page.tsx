import type { Metadata } from "next";
import { connection } from "next/server";
import { BuildSequenceAdmin } from "@/components/admin/build-sequence-admin";
import { currentPrincipal } from "@/lib/data/current-principal";
import { getTradeTypesForAdmin } from "@/lib/data/trade-types";
import {
  readMilestoneTemplate,
  listTemplateCostTasks,
} from "@/lib/domain/projects/templates";
import prisma from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Build Sequence",
  description: "Manage project activities, durations and required trades.",
};

export default async function BuildSequencePage() {
  await connection();
  const principal = await currentPrincipal();
  const [snapshot, trades, costTasks] = await Promise.all([
    readMilestoneTemplate(principal, prisma),
    getTradeTypesForAdmin(),
    listTemplateCostTasks(principal, prisma),
  ]);
  return (
    <BuildSequenceAdmin
      initial={snapshot}
      trades={trades}
      costTasks={costTasks}
    />
  );
}
