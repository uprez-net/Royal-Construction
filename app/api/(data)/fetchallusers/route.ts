import prisma from "@/lib/prisma";
import { errorResponse } from "@/utils/validators";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
      try {

            const Users = await prisma.user.findMany({
                  select: {
                        id: true,
                        name: true,
                        email: true,
                  }
            });

            console.log("Total Users", Users.length);
            return new Response(JSON.stringify({ users: Users }), {
                  status: 200,
            });

      } catch (error) {
            console.error("/api/fetchallusers GET error", error);
            return errorResponse("Failed to fetch users", {
                  status: 500,
                  code: "INTERNAL_ERROR",
            });
      }
}