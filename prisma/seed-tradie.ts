import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set.");
}

const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: ["error"],
});

async function main() {
    // Clear existing data
    await prisma.tradie.deleteMany();

    // Seed tradies
    const insertInfo = await prisma.tradie.createMany({
        data: [
            {
                name: "Just Magic Plumbing",
                trade: "Plumbing",
                abn: "10000000001",
                phone: "0492321493",
                email: "justmagicplumbingsolutions@gmail.com",
            },
            {
                name: "Rideg Water Plumbing",
                trade: "Plumbing",
                abn: "10000000002",
                phone: "0401744872",
                email: "rideg-water-plumbing@example.com",
            },
            {
                name: "AR Electrical Contract Service Pty Ltd",
                trade: "Electrician",
                abn: "10000000003",
                phone: "0421542985",
                email: "arelectrical70@gmail.com",
            },
            {
                name: "Aluming Windows and Doors",
                trade: "Windows & Doors",
                abn: "10000000004",
                phone: "0400000004",
                email: "aluming@example.com",
            },
            {
                name: "Grade Joinery",
                trade: "Joinery",
                abn: "10000000005",
                phone: "452419866",
                email: "Gradejoinerys@gmail.com",
            },
            {
                name: "Aussie Structural Engineers Pty Ltd",
                trade: "Structural Engineering",
                abn: "10000000006",
                phone: "0449570491",
                email: "aussie-structural@example.com",
            },
            {
                name: "Span Consulting Engineers Pty Ltd",
                trade: "Structural Engineering",
                abn: "10000000007",
                phone: "0432544626",
                email: "span-consulting@example.com",
            },
            {
                name: "Hi Tech Pest Control NSW P/L",
                trade: "Pest Control",
                abn: "10000000008",
                phone: "1300073789",
                email: "hitechpest@bigpond.com",
            },
            {
                name: "Land Surveying Services Pty Ltd",
                trade: "Surveying",
                abn: "10000000009",
                phone: "0413136670",
                email: "landsurveyingservices1@gmail.com",
            },
            {
                name: "RMA Infrastructure Pty Ltd",
                trade: "Sydney Water",
                abn: "10000000010",
                phone: "+61247222774",
                email: "alison@rmai.com.au",
            },
            {
                name: "Supreme Concrete (Aus) Pty Ltd",
                trade: "Concrete",
                abn: "10000000011",
                phone: "0405464102",
                email: "info@supremeconcrete.com.au",
            },
            {
                name: "AS Bricklaying",
                trade: "Bricklaying",
                abn: "10000000012",
                phone: "0450243045",
                email: "as-bricklaying@example.com",
            },
            {
                name: "AP Stacks Constructions",
                trade: "Carpentry",
                abn: "10000000013",
                phone: "0431171839",
                email: "apstack@outlook.com",
            },
            {
                name: "Scaffolding Australia",
                trade: "Scaffolding",
                abn: "10000000014",
                phone: "0404803680",
                email: "accounts@scaffoldingaustralia.com.au",
            },
            {
                name: "Unknown Waterproofer",
                trade: "Waterproofing",
                abn: "10000000015",
                phone: "0421593026",
                email: "waterproofing@example.com",
            },
            {
                name: "Goroya Building Supplys",
                trade: "Fit-out Carpentry",
                abn: "10000000016",
                phone: "0435465417",
                email: "goroya@example.com",
            },
            {
                name: "Stefan's Interior Fixout",
                trade: "Interior Fit-out",
                abn: "10000000017",
                phone: "0406618442",
                email: "stefansinteriorfixout@gmail.com",
            },
            {
                name: "Pro-Build Constructions",
                trade: "Carpentry",
                abn: "10000000018",
                phone: "0400000018",
                email: "probuild.constructions@hotmail.com",
            },
            {
                name: "NSW Business Group",
                trade: "Gyprock",
                abn: "10000000019",
                phone: "0451788788",
                email: "nsw-business-group@example.com",
            },
            {
                name: "Streamline Tiling",
                trade: "Tiling",
                abn: "10000000020",
                phone: "0434382071",
                email: "streamline-tiling@example.com",
            },
            {
                name: "Metal Roofing Australia",
                trade: "Metal Roofing",
                abn: "10000000021",
                phone: "0405229795",
                email: "info@metalroofingaustralia.com",
            },
        ],
        skipDuplicates: true,
    });

    console.log(`Seeded tradies successfully. ${insertInfo.count} records inserted.`);
}

main()
.catch((e) => {
    console.error(e);
    process.exit(1);
})
.finally(async () => {
    await prisma.$disconnect();
});