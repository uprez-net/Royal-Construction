import { auth } from "@clerk/nextjs/server";

import prisma from "@/lib/prisma";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const tradies = await prisma.tradie.findMany({
    orderBy: { name: "asc" },
  });

  return Response.json(tradies);
}
