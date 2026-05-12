import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import {
  MilestoneStatus,
  Prisma,
  PrismaClient,
  ProjectStatus,
  Role,
  TradieScheduleStatus,
  VariationStatus,
} from "@prisma/client";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});

const decimal = (value: number) => new Prisma.Decimal(value);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

type ProjectSeed = {
  name: string;
  description: string;
  location: string;
  status: ProjectStatus;
  budget: number;
  spent: number;
  startDate: string;
  estimatedEndDate: string;
  customerKey: string;
  managerKey: string;
  requirements: string[];
  milestones: Array<{
    name: string;
    order: number;
    description?: string;
    targetDate: string;
    actualDate?: string;
    status: MilestoneStatus;
    isPhotoRequired?: boolean;
  }>;
  updates: Array<{
    milestoneOrder?: number;
    authorKey: string;
    notes: string;
    photoUrls: string[];
    createdAt: string;
  }>;
  variations: Array<{
    description: string;
    cost: number;
    requestedDate: string;
    approvedDate?: string;
    delayDays: number;
    status: VariationStatus;
  }>;
  schedules: Array<{
    tradieKey: string;
    milestoneOrder?: number;
    scheduledDate: string;
    durationDays: number;
    status: TradieScheduleStatus;
  }>;
};

async function main() {
  await prisma.activityLog.deleteMany();
  await prisma.siteUpdate.deleteMany();
  await prisma.variation.deleteMany();
  await prisma.tradieSchedule.deleteMany();
  await prisma.file.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.project.deleteMany();
  await prisma.tradie.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();

  const admin = await prisma.user.create({
    data: {
      name: "Guri Singh",
      email: "guri.singh@buildpro.com.au",
      phone: "+61 400 000 001",
      clerkId: "seed-admin-guri",
      role: Role.ADMIN,
    },
  });

  const siteManagers = await Promise.all([
    {
      key: "amrit",
      name: "Amrit Singh",
      email: "amrit.singh@buildpro.com.au",
      phone: "+61 400 000 101",
    },
    {
      key: "deepak",
      name: "Deepak Sharma",
      email: "deepak.sharma@buildpro.com.au",
      phone: "+61 400 000 102",
    },
    {
      key: "gurpreet",
      name: "Gurpreet Mann",
      email: "gurpreet.mann@buildpro.com.au",
      phone: "+61 400 000 103",
    },
    {
      key: "jasbir",
      name: "Jasbir Kaur",
      email: "jasbir.kaur@buildpro.com.au",
      phone: "+61 400 000 104",
    },
    {
      key: "harjot",
      name: "Harjot Bassi",
      email: "harjot.bassi@buildpro.com.au",
      phone: "+61 400 000 105",
    },
    {
      key: "ravinder",
      name: "Ravinder Pal",
      email: "ravinder.pal@buildpro.com.au",
      phone: "+61 400 000 106",
    },
  ].map(async (manager, index) => {
    const user = await prisma.user.create({
      data: {
        name: manager.name,
        email: manager.email,
        phone: manager.phone,
        clerkId: `seed-site-manager-${manager.key}`,
        role: Role.SITE_MANAGER,
      },
    });

    return { ...manager, user, index };
  }));

  const customers = await Promise.all([
    {
      key: "harpreet",
      name: "Harpreet Kaur",
      email: "harpreet.kaur@email.com",
      phone: "+61 445 678 123",
    },
    {
      key: "rajesh",
      name: "Rajesh Kumar",
      email: "rajesh.k@email.com",
      phone: "+61 434 567 890",
    },
    {
      key: "sukhwinder",
      name: "Sukhwinder Singh",
      email: "sukh.singh@email.com",
      phone: "+61 412 789 456",
    },
    {
      key: "david",
      name: "David Chen",
      email: "david.chen@email.com",
      phone: "+61 434 901 234",
    },
    {
      key: "manjit",
      name: "Manjit Brar",
      email: "manjit.brar@email.com",
      phone: "+61 456 234 789",
    },
  ].map(async (customerSeed, index) => {
    const user = await prisma.user.create({
      data: {
        name: customerSeed.name,
        email: customerSeed.email,
        phone: customerSeed.phone,
        clerkId: `seed-customer-${customerSeed.key}`,
        role: Role.CUSTOMER,
      },
    });

    const customer = await prisma.customer.create({
      data: {
        userId: user.id,
        name: customerSeed.name,
        email: customerSeed.email,
        phone: customerSeed.phone,
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { customerId: customer.id },
    });

    return { ...customerSeed, user, customer, index };
  }));

  const tradies = await Promise.all([
    {
      key: "plumbing",
      name: "Flow Right Plumbing",
      company: "Flow Right Plumbing Pty Ltd",
      trade: "Plumber",
      tradeType: "Plumbing",
      phone: "+61 408 100 201",
      email: "bookings@flowrightplumbing.com.au",
      hourlyRate: 125,
      rating: 4.8,
    },
    {
      key: "electrical",
      name: "NSW Spark Solutions",
      company: "NSW Spark Solutions",
      trade: "Electrician",
      tradeType: "Electrical",
      phone: "+61 408 100 202",
      email: "dispatch@nswspark.com.au",
      hourlyRate: 140,
      rating: 4.7,
    },
    {
      key: "carpentry",
      name: "Tims Framing Co",
      company: "Tims Framing Co",
      trade: "Carpenter",
      tradeType: "Carpentry",
      phone: "+61 408 100 203",
      email: "jobs@timsframingco.com.au",
      hourlyRate: 118,
      rating: 4.9,
    },
    {
      key: "roofing",
      name: "Apex Roofing NSW",
      company: "Apex Roofing NSW",
      trade: "Roofer",
      tradeType: "Roofing",
      phone: "+61 408 100 204",
      email: "quote@apexroofing.com.au",
      hourlyRate: 135,
      rating: 4.6,
    },
    {
      key: "tiling",
      name: "Precision Tiling",
      company: "Precision Tiling",
      trade: "Tiler",
      tradeType: "Tiling",
      phone: "+61 408 100 205",
      email: "team@precisiontiling.com.au",
      hourlyRate: 110,
      rating: 4.5,
    },
    {
      key: "concreting",
      name: "Punjab Concreting",
      company: "Punjab Concreting",
      trade: "Concreter",
      tradeType: "Concreting",
      phone: "+61 408 100 206",
      email: "bookings@punjabconcreting.com.au",
      hourlyRate: 115,
      rating: 4.8,
    },
  ].map((tradieSeed) =>
    prisma.tradie.create({
      data: {
        name: tradieSeed.name,
        company: tradieSeed.company,
        trade: tradieSeed.trade,
        tradeType: tradieSeed.tradeType,
        phone: tradieSeed.phone,
        email: tradieSeed.email,
        hourlyRate: decimal(tradieSeed.hourlyRate),
        rating: decimal(tradieSeed.rating),
      },
    }),
  ));

  const projectSeeds: ProjectSeed[] = [
    {
      name: "Penrith Residence",
      description: "Double storey 4BR + study home drawn from the legacy BuildPro mock.",
      location: "42 Railway St, Penrith NSW 2750",
      status: ProjectStatus.ON_TRACK,
      budget: 485000,
      spent: 312400,
      startDate: "2025-02-10",
      estimatedEndDate: "2025-11-20",
      customerKey: "harpreet",
      managerKey: "amrit",
      requirements: [
        "4 bedrooms with built-in robes",
        "2 bathrooms + 1 ensuite",
        "Open-plan kitchen/living",
        "Double garage",
        "Alfresco with ceiling fans",
        "900mm cooktop + wall oven",
      ],
      milestones: [
        { name: "Site Preparation & Foundation", order: 1, targetDate: "2025-02-15", actualDate: "2025-02-15", status: MilestoneStatus.DONE, isPhotoRequired: true },
        { name: "Slab Pour & Cure", order: 2, targetDate: "2025-03-20", actualDate: "2025-03-20", status: MilestoneStatus.DONE, isPhotoRequired: true },
        { name: "Frame Erection", order: 3, targetDate: "2025-05-10", actualDate: "2025-05-10", status: MilestoneStatus.DONE, isPhotoRequired: true },
        { name: "Roof Installation", order: 4, targetDate: "2025-07-28", status: MilestoneStatus.ACTIVE, isPhotoRequired: true },
      ],
      updates: [
        { milestoneOrder: 3, authorKey: "amrit", notes: "Frame inspection passed and the certifier has cleared the main structure for roof works.", photoUrls: ["https://images.unsplash.com/photo-1504307651254-35680f356dfd"], createdAt: "2025-05-11" },
        { milestoneOrder: 4, authorKey: "amrit", notes: "Roof trusses staged on site and the roofing crew confirmed for the next window.", photoUrls: ["https://images.unsplash.com/photo-1513694203232-719a280e022f"], createdAt: "2025-05-12" },
      ],
      variations: [
        { description: "Kitchen island upgrade to waterfall edge", cost: 4500, requestedDate: "2025-05-15", approvedDate: "2025-05-19", delayDays: 2, status: VariationStatus.APPROVED },
      ],
      schedules: [
        { tradieKey: "carpentry", milestoneOrder: 4, scheduledDate: "2025-07-28", durationDays: 3, status: TradieScheduleStatus.CONFIRMED },
        { tradieKey: "roofing", milestoneOrder: 4, scheduledDate: "2025-07-30", durationDays: 2, status: TradieScheduleStatus.PENDING_RESPONSE },
      ],
    },
    {
      name: "Castle Hill Villa",
      description: "Luxury 5BR home in planning with pending DA approvals and premium finishes.",
      location: "Castle Hill, NSW 2154",
      status: ProjectStatus.ACTIVE,
      budget: 620000,
      spent: 45200,
      startDate: "2025-06-01",
      estimatedEndDate: "2026-04-15",
      customerKey: "rajesh",
      managerKey: "deepak",
      requirements: [
        "5 bedrooms + study room",
        "3 bathrooms + 2 ensuites",
        "Gourmet kitchen with butler pantry",
        "Theatre room",
        "Double garage with internal access",
      ],
      milestones: [
        { name: "Architectural Design Finalisation", order: 1, targetDate: "2025-06-10", actualDate: "2025-06-10", status: MilestoneStatus.DONE },
        { name: "Council DA Submission", order: 2, targetDate: "2025-07-01", status: MilestoneStatus.ACTIVE, isPhotoRequired: false },
        { name: "DA Approval & Conditions", order: 3, targetDate: "2025-08-15", status: MilestoneStatus.PENDING },
        { name: "Certification & Compliance", order: 4, targetDate: "2025-09-01", status: MilestoneStatus.PENDING },
      ],
      updates: [
        { milestoneOrder: 1, authorKey: "deepak", notes: "Concept package locked in with the client and consultant coordination underway.", photoUrls: ["https://images.unsplash.com/photo-1505693416388-ac5ce068fe85"], createdAt: "2025-06-11" },
        { milestoneOrder: 2, authorKey: "deepak", notes: "DA package lodged and the council submission receipt has been filed.", photoUrls: ["https://images.unsplash.com/photo-1494526585095-c41746248156"], createdAt: "2025-06-12" },
      ],
      variations: [
        { description: "Add home office joinery and upgraded lighting plan", cost: 12000, requestedDate: "2025-06-25", delayDays: 0, status: VariationStatus.PENDING },
      ],
      schedules: [
        { tradieKey: "electrical", milestoneOrder: 2, scheduledDate: "2025-07-02", durationDays: 1, status: TradieScheduleStatus.PENDING },
        { tradieKey: "carpentry", milestoneOrder: 1, scheduledDate: "2025-07-05", durationDays: 2, status: TradieScheduleStatus.NO_RESPONSE },
      ],
    },
    {
      name: "Blacktown Duplex",
      description: "Two-unit duplex at slab stage with active framing and brickwork planning.",
      location: "Blacktown, NSW 2148",
      status: ProjectStatus.NEEDS_ATTENTION,
      budget: 380000,
      spent: 198600,
      startDate: "2025-03-15",
      estimatedEndDate: "2025-12-30",
      customerKey: "sukhwinder",
      managerKey: "gurpreet",
      requirements: [
        "Duplex — 2 x 3BR units",
        "Separate driveways",
        "Individual metering",
        "Matching facade design",
        "Open-plan living areas",
      ],
      milestones: [
        { name: "Demolition & Site Clear", order: 1, targetDate: "2025-03-20", actualDate: "2025-03-20", status: MilestoneStatus.DONE, isPhotoRequired: true },
        { name: "Earthworks & Footings", order: 2, targetDate: "2025-04-25", actualDate: "2025-04-25", status: MilestoneStatus.DONE, isPhotoRequired: true },
        { name: "Slab Pour (Both Units)", order: 3, targetDate: "2025-06-05", actualDate: "2025-06-05", status: MilestoneStatus.DONE, isPhotoRequired: true },
        { name: "Frame Erection", order: 4, targetDate: "2025-07-15", status: MilestoneStatus.ACTIVE, isPhotoRequired: true },
      ],
      updates: [
        { milestoneOrder: 3, authorKey: "gurpreet", notes: "Slab pour completed across both units and the concrete finish has been checked.", photoUrls: ["https://images.unsplash.com/photo-1504307651254-35680f356dfd"], createdAt: "2025-06-06" },
        { milestoneOrder: 4, authorKey: "gurpreet", notes: "Framing crew mobilised, with the east unit lead already standing.", photoUrls: ["https://images.unsplash.com/photo-1517048676732-d65bc937f952"], createdAt: "2025-06-07" },
      ],
      variations: [
        { description: "Upgrade to Colorbond roof across both units", cost: 6800, requestedDate: "2025-05-20", approvedDate: "2025-05-24", delayDays: 3, status: VariationStatus.APPROVED },
      ],
      schedules: [
        { tradieKey: "concreting", milestoneOrder: 3, scheduledDate: "2025-06-05", durationDays: 1, status: TradieScheduleStatus.COMPLETED },
        { tradieKey: "carpentry", milestoneOrder: 4, scheduledDate: "2025-07-15", durationDays: 4, status: TradieScheduleStatus.CONFIRMED },
      ],
    },
    {
      name: "Parramatta Home",
      description: "Main dwelling and granny flat now into lock-up and rough-in coordination.",
      location: "Parramatta, NSW 2150",
      status: ProjectStatus.DELAYED,
      budget: 550000,
      spent: 410000,
      startDate: "2024-11-01",
      estimatedEndDate: "2025-08-30",
      customerKey: "david",
      managerKey: "amrit",
      requirements: [
        "4 bedroom main house",
        "Separate 1BR granny flat",
        "Granny flat with kitchenette",
        "Shared laundry access",
        "Main house open-plan",
      ],
      milestones: [
        { name: "Foundation & Slab", order: 1, targetDate: "2024-11-20", actualDate: "2024-11-20", status: MilestoneStatus.DONE, isPhotoRequired: true },
        { name: "Frame — Main House", order: 2, targetDate: "2025-01-15", actualDate: "2025-01-15", status: MilestoneStatus.DONE, isPhotoRequired: true },
        { name: "Frame — Granny Flat", order: 3, targetDate: "2025-01-30", actualDate: "2025-01-30", status: MilestoneStatus.DONE, isPhotoRequired: true },
        { name: "Brickwork Complete", order: 4, targetDate: "2025-03-10", status: MilestoneStatus.ACTIVE, isPhotoRequired: true },
      ],
      updates: [
        { milestoneOrder: 4, authorKey: "amrit", notes: "Brickwork is tracking but the next trade window needs to be tightened around supply delivery.", photoUrls: ["https://images.unsplash.com/photo-1504384308090-c894fdcc538d"], createdAt: "2025-03-11" },
        { milestoneOrder: 4, authorKey: "amrit", notes: "Site meeting completed with the client and rough-in sequencing confirmed.", photoUrls: ["https://images.unsplash.com/photo-1531835551805-16f43b6bfb27"], createdAt: "2025-03-12" },
      ],
      variations: [
        { description: "Kitchen upgrade — Caesarstone island bench", cost: 5200, requestedDate: "2025-06-20", delayDays: 0, status: VariationStatus.PENDING },
      ],
      schedules: [
        { tradieKey: "plumbing", milestoneOrder: 4, scheduledDate: "2025-03-20", durationDays: 2, status: TradieScheduleStatus.DECLINED },
        { tradieKey: "electrical", milestoneOrder: 4, scheduledDate: "2025-03-22", durationDays: 2, status: TradieScheduleStatus.PENDING_RESPONSE },
      ],
    },
    {
      name: "Liverpool Estate",
      description: "Large double-storey build progressing through foundation and early structure.",
      location: "Liverpool, NSW 2170",
      status: ProjectStatus.COMPLETED,
      budget: 720000,
      spent: 720000,
      startDate: "2025-05-20",
      estimatedEndDate: "2026-06-01",
      customerKey: "manjit",
      managerKey: "jasbir",
      requirements: [
        "6 bedrooms over 2 storeys",
        "Home office / study",
        "Butler pantry off kitchen",
        "2 living areas",
        "3 bathrooms + 2 ensuites",
      ],
      milestones: [
        { name: "Site Preparation", order: 1, targetDate: "2025-05-25", actualDate: "2025-05-25", status: MilestoneStatus.DONE, isPhotoRequired: true },
        { name: "Foundation Pour", order: 2, targetDate: "2025-07-10", actualDate: "2025-07-10", status: MilestoneStatus.DONE, isPhotoRequired: true },
        { name: "Ground Floor Slab", order: 3, targetDate: "2025-08-01", actualDate: "2025-08-01", status: MilestoneStatus.DONE, isPhotoRequired: true },
        { name: "Ground Floor Frame", order: 4, targetDate: "2025-09-01", actualDate: "2025-09-01", status: MilestoneStatus.DONE, isPhotoRequired: true },
      ],
      updates: [
        { milestoneOrder: 2, authorKey: "jasbir", notes: "Concrete crew completed the pour and the site has been handed over to carpentry ahead of schedule.", photoUrls: ["https://images.unsplash.com/photo-1581092580497-e0d23cbdf1dc"], createdAt: "2025-07-11" },
        { milestoneOrder: 4, authorKey: "jasbir", notes: "Ground floor framing is complete and the final inspection report has been uploaded.", photoUrls: ["https://images.unsplash.com/photo-1489515217757-5fd1be406fef"], createdAt: "2025-09-02" },
      ],
      variations: [
        { description: "Solar battery upgrade for the roof package", cost: 9000, requestedDate: "2025-08-01", approvedDate: "2025-08-10", delayDays: 4, status: VariationStatus.APPROVED },
      ],
      schedules: [
        { tradieKey: "concreting", milestoneOrder: 2, scheduledDate: "2025-07-10", durationDays: 1, status: TradieScheduleStatus.COMPLETED },
        { tradieKey: "carpentry", milestoneOrder: 4, scheduledDate: "2025-09-01", durationDays: 5, status: TradieScheduleStatus.COMPLETED },
      ],
    },
  ];

  const customerMap = new Map(customers.map((customer) => [customer.key, customer]));
  const managerMap = new Map(siteManagers.map((manager) => [manager.key, manager]));
  const tradieMap = new Map(tradies.map((tradie) => [tradie.tradeType.toLowerCase(), tradie]));

  for (const projectSeed of projectSeeds) {
    const customer = customerMap.get(projectSeed.customerKey);
    const manager = managerMap.get(projectSeed.managerKey);

    if (!customer || !manager) {
      throw new Error(`Missing seed reference for ${projectSeed.name}`);
    }

    const project = await prisma.project.create({
      data: {
        name: projectSeed.name,
        description: projectSeed.description,
        customerId: customer.customer.id,
        location: projectSeed.location,
        siteManagerId: manager.user.id,
        status: projectSeed.status,
        totalBudget: decimal(projectSeed.budget),
        spent: decimal(projectSeed.spent),
        startDate: day(projectSeed.startDate),
        estimatedEndDate: day(projectSeed.estimatedEndDate),
        requirements: projectSeed.requirements as Prisma.InputJsonValue,
      },
    });

    const milestones: Record<number, { id: string; name: string }> = {};

    for (const milestoneSeed of projectSeed.milestones) {
      const milestone = await prisma.milestone.create({
        data: {
          projectId: project.id,
          name: milestoneSeed.name,
          order: milestoneSeed.order,
          description: milestoneSeed.description,
          targetDate: day(milestoneSeed.targetDate),
          actualDate: milestoneSeed.actualDate ? day(milestoneSeed.actualDate) : null,
          status: milestoneSeed.status,
          isPhotoRequired: milestoneSeed.isPhotoRequired ?? false,
        },
      });

      milestones[milestoneSeed.order] = { id: milestone.id, name: milestone.name };
    }

    for (const updateSeed of projectSeed.updates) {
      const milestone = updateSeed.milestoneOrder ? milestones[updateSeed.milestoneOrder] : undefined;

      await prisma.siteUpdate.create({
        data: {
          projectId: project.id,
          milestoneId: milestone?.id,
          authorId: manager.user.id,
          notes: updateSeed.notes,
          photoUrls: updateSeed.photoUrls,
          createdAt: day(updateSeed.createdAt),
        },
      });
    }

    for (const variationSeed of projectSeed.variations) {
      await prisma.variation.create({
        data: {
          projectId: project.id,
          description: variationSeed.description,
          cost: decimal(variationSeed.cost),
          requestedDate: day(variationSeed.requestedDate),
          approvedDate: variationSeed.approvedDate ? day(variationSeed.approvedDate) : null,
          delayDays: variationSeed.delayDays,
          status: variationSeed.status,
        },
      });
    }

    for (const scheduleSeed of projectSeed.schedules) {
      const tradie = tradieMap.get(scheduleSeed.tradieKey);
      if (!tradie) {
        throw new Error(`Missing tradie seed for ${projectSeed.name}`);
      }

      const milestone = scheduleSeed.milestoneOrder ? milestones[scheduleSeed.milestoneOrder] : undefined;

      await prisma.tradieSchedule.create({
        data: {
          tradieId: tradie.id,
          projectId: project.id,
          milestoneId: milestone?.id,
          scheduledDate: day(scheduleSeed.scheduledDate),
          durationDays: scheduleSeed.durationDays,
          status: scheduleSeed.status,
        },
      });
    }

    await prisma.activityLog.create({
      data: {
        projectId: project.id,
        authorId: manager.user.id,
        type: "seed",
        message: `${projectSeed.name} imported from the legacy mock data set.`,
      },
    });
  }

  await prisma.activityLog.create({
    data: {
      projectId: (await prisma.project.findFirst({ select: { id: true } }))!.id,
      authorId: admin.id,
      type: "seed",
      message: "Seed completed for admin oversight.",
    },
  });

  console.log(`Seeded ${customers.length} customers, ${siteManagers.length} site managers, ${tradies.length} tradies, and ${projectSeeds.length} projects.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });