import "dotenv/config";
import { LeadStage, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: ["error"],
});

// Map human-readable stage strings to Prisma enum
const stageMap: Record<string, LeadStage> = {
  "New": LeadStage.NEW,
  "Contacted": LeadStage.CONTACTED,
  "Qualified": LeadStage.QUALIFIED,
  "Quoted": LeadStage.QUOTED,
  "Negotiating": LeadStage.NEGOTIATING,
  "Won": LeadStage.WON,
  "Lost": LeadStage.LOST,
  "Meeting Scheduled": LeadStage.MEETING_SCHEDULED,
  "In Follow-up": LeadStage.IN_FOLLOW_UP,
  "No Response": LeadStage.NO_RESPONSE,
  "Converted": LeadStage.CONVERTED,
  "Cancelled": LeadStage.CANCELLED,
  "Disqualified": LeadStage.DISQUALIFIED,
};

// Parse M/D/YYYY date strings
function parseDate(dateStr: string): Date | null {
  if (!dateStr || dateStr.trim() === "") return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const [month, day, year] = parts.map(Number);
  return new Date(year, month - 1, day);
}

// All lead data from eun-leads-data.ts
const data = [
  { name: "Ingrid CM", phone: "0435 673 215", email: "", location: "", sourceDetail: "Personal", stage: "Meeting Scheduled", assigned: "", budget: "", type: [] as string[], notes: "Ingrid sending plans soon, plan meeting date & time", followupDate: "2/9/2026", followupTime: "", followupNotes: "", lostReason: "", created: "1/27/2026", urgent: false },
  { name: "Justin Nulot", phone: "0432 566 312", email: "", location: "", sourceDetail: "Personal", stage: "In Follow-up", assigned: "", budget: "", type: ["Granny Flat"], notes: "Calling 9/2/2026", followupDate: "1/29/2026", followupTime: "", followupNotes: "", lostReason: "", created: "1/27/2026", urgent: false },
  { name: "Vikram", phone: "", email: "", location: "27 Bride Ave", sourceDetail: "Personal", stage: "In Follow-up", assigned: "", budget: "", type: ["Dual Occupancy"], notes: "Received endorsed plans & planning permit", followupDate: "2/10/2026", followupTime: "", followupNotes: "", lostReason: "", created: "1/20/2026", urgent: false },
  { name: "Kathy Ondap", phone: "0409 814 839", email: "", location: "", sourceDetail: "Personal", stage: "Meeting Scheduled", assigned: "", budget: "", type: ["Double Storey", "Dual Occupancy"], notes: "Followed up email to organise meeting", followupDate: "2/25/2026", followupTime: "", followupNotes: "Organise a Meeting", lostReason: "", created: "2/3/2026", urgent: false },
  { name: "Manpreet Singh", phone: "0451 175 322", email: "", location: "", sourceDetail: "Personal", stage: "Meeting Scheduled", assigned: "", budget: "", type: ["Duplex"], notes: "Meeting with Gurpinder 9/2/2026", followupDate: "3/15/2026", followupTime: "", followupNotes: "Organise a Meeting", lostReason: "", created: "2/4/2026", urgent: false },
  { name: "Craig Krause", phone: "0448 526 129", email: "", location: "", sourceDetail: "Personal", stage: "No Response", assigned: "", budget: "", type: [], notes: "called didn't ans", followupDate: "9/13/2026", followupTime: "", followupNotes: "Follow-up in 1 day", lostReason: "", created: "2/4/2026", urgent: false },
  { name: "Richard Sutherland", phone: "0418 234 567", email: "", location: "", sourceDetail: "Personal", stage: "Lost", assigned: "", budget: "", type: [], notes: "scam", followupDate: "2/8/2026", followupTime: "", followupNotes: "Waiting for information", lostReason: "Scam", created: "2/7/2026", urgent: false },
  { name: "Tina", phone: "0402 876 422", email: "", location: "", sourceDetail: "Personal", stage: "In Follow-up", assigned: "", budget: "", type: ["Granny Flat"], notes: "Follow up in 6 months -> Interested in knockdown & rebuild (Jervis Bay)", followupDate: "8/10/2026", followupTime: "", followupNotes: "Follow-up in 6 months", lostReason: "", created: "2/10/2026", urgent: false },
  { name: "Hekmat", phone: "0401 685 215", email: "", location: "", sourceDetail: "Personal", stage: "In Follow-up", assigned: "", budget: "", type: ["Granny Flat"], notes: "Looking to build a granny flat, doesn't have any plans yet", followupDate: "", followupTime: "", followupNotes: "Follow-up in 1 day", lostReason: "", created: "2/13/2026", urgent: false },
  { name: "Cheri", phone: "0430 766 629", email: "", location: "23 Sudbury St, Belmore", sourceDetail: "Personal", stage: "Meeting Scheduled", assigned: "", budget: "", type: ["Single Storey", "Duplex"], notes: "Knockdown and rebuild a single storey duplex", followupDate: "", followupTime: "", followupNotes: "Organise a Meeting", lostReason: "", created: "2/14/2026", urgent: false },
  { name: "Balvindar Dhillon", phone: "0415 851 522", email: "", location: "", sourceDetail: "Personal", stage: "In Follow-up", assigned: "", budget: "", type: [], notes: "Need to find land", followupDate: "", followupTime: "", followupNotes: "Follow-up in 7 days", lostReason: "", created: "2/16/2026", urgent: false },
  { name: "Jay", phone: "0426 213 744", email: "", location: "", sourceDetail: "Personal", stage: "Meeting Scheduled", assigned: "", budget: "", type: ["Double Storey"], notes: "meeting done / give him rough estimate to get sgin in", followupDate: "3/2/2026", followupTime: "", followupNotes: "Follow-up in 7 days", lostReason: "", created: "2/19/2026", urgent: false },
  { name: "Mani Aggarwal", phone: "0452 323 014", email: "", location: "Springfield", sourceDetail: "Personal", stage: "Meeting Scheduled", assigned: "Call and organise meeting", budget: "", type: ["Single Storey"], notes: "Land registration is late, spoke on 1/4/26", followupDate: "4/13/2026", followupTime: "", followupNotes: "Organise a Meeting", lostReason: "", created: "2/22/2026", urgent: false },
  { name: "Ziad", phone: "0466 991 050", email: "", location: "", sourceDetail: "Personal", stage: "In Follow-up", assigned: "", budget: "", type: ["Granny Flat"], notes: "Looking to build granny flat (Liverpool)", followupDate: "", followupTime: "", followupNotes: "Send an Email/Text", lostReason: "", created: "2/27/2026", urgent: false },
  { name: "Wasfy Tadros", phone: "0452 499 556", email: "wasfytadros@gmail.com", location: "", sourceDetail: "Personal", stage: "Cancelled", assigned: "", budget: "", type: ["New Home"], notes: "House 2 Bedroom", followupDate: "", followupTime: "", followupNotes: "Cancelled", lostReason: "", created: "3/1/2026", urgent: false },
  { name: "Alwin", phone: "0419 155 313", email: "", location: "", sourceDetail: "Personal", stage: "No Response", assigned: "Jessica to Call Back", budget: "", type: ["House and Granny"], notes: "House + granny flat in oran park", followupDate: "4/11/2026", followupTime: "", followupNotes: "Called multiple occasions", lostReason: "", created: "3/5/2026", urgent: false },
  { name: "Rex Zabat", phone: "0424 110 755", email: "rexzabat1997@gmail.com", location: "", sourceDetail: "Personal", stage: "Disqualified", assigned: "Lead Disquallified", budget: "", type: ["Dual Occupancy", "Knockdown and rebuild"], notes: "Knockdown and rebuild to build dual occupancy home in Oakhurst.", followupDate: "", followupTime: "", followupNotes: "Cancelled", lostReason: "", created: "3/5/2026", urgent: false },
  { name: "Elizabeth", phone: "0424 456 143", email: "elizabethsimsek@outlook.com", location: "", sourceDetail: "Personal", stage: "In Follow-up", assigned: "Jessica sent Follow Up Email", budget: "", type: ["Duplex", "Knockdown and rebuild"], notes: "Knockdown and rebuild duplex in Chesterhill", followupDate: "4/7/2026", followupTime: "", followupNotes: "Follow-up in 7 days", lostReason: "", created: "3/6/2026", urgent: false },
  { name: "Anna", phone: "0419 018 273", email: "", location: "", sourceDetail: "Personal", stage: "In Follow-up", assigned: "Do estimate & send", budget: "", type: ["Not Specified"], notes: "Need to quote on plans provided", followupDate: "", followupTime: "", followupNotes: "Need to call back", lostReason: "", created: "3/10/2026", urgent: false },
  { name: "Miryam", phone: "0417 071 165", email: "miriamnavar@gmail.com", location: "", sourceDetail: "Personal", stage: "No Response", assigned: "Gurpinder", budget: "", type: ["Duplex", "Knockdown and rebuild"], notes: "Knockdown and rebuild on 800sqm in Middle Cove", followupDate: "", followupTime: "", followupNotes: "Called multiple occasions", lostReason: "", created: "3/12/2026", urgent: false },
  { name: "Unknown", phone: "0449 571 885", email: "", location: "", sourceDetail: "Personal", stage: "Cancelled", assigned: "", budget: "", type: ["Granny Flat"], notes: "Interested in quote for 1 bedroom granny flat in Minto.", followupDate: "", followupTime: "", followupNotes: "Cancelled", lostReason: "", created: "3/13/2026", urgent: false },
  { name: "Ron", phone: "0449 760 773", email: "ronmage52@gmail.com", location: "258 Longhurst Rd, Minto", sourceDetail: "Personal", stage: "No Response", assigned: "Manbir", budget: "", type: ["Granny Flat"], notes: "Interested in quote for granny flat in Minto.", followupDate: "4/11/2026", followupTime: "", followupNotes: "Called multiple occasions", lostReason: "", created: "3/13/2026", urgent: false },
  { name: "Emmanuel Mani", phone: "419225143", email: "Emmanuel.mani1@hotmail.com", location: "", sourceDetail: "Personal", stage: "In Follow-up", assigned: "", budget: "", type: ["House and Granny"], notes: "Need to sell old house and then buy new land and build", followupDate: "", followupTime: "", followupNotes: "Follow-up in 3 months", lostReason: "", created: "3/13/2026", urgent: false },
  { name: "erwin satorre", phone: "0401 944 395", email: "MarkelC2005@gmail.com", location: "", sourceDetail: "Personal", stage: "In Follow-up", assigned: "Manbir", budget: "", type: ["Single Storey", "New Home"], notes: "Quote for 4 bed 2 bathrooms and 2 car garrage single storey 354 m land", followupDate: "4/10/2026", followupTime: "", followupNotes: "Follow-up in 1 day", lostReason: "", created: "3/18/2026", urgent: false },
  { name: "Nishaal Shankar", phone: "0451 167 577", email: "nishaalavi@gmail.com", location: "", sourceDetail: "Personal", stage: "Meeting Scheduled", assigned: "Gurpinder", budget: "", type: ["Double Storey"], notes: "2nd meeting booked on 17/04/2026", followupDate: "4/17/2026", followupTime: "", followupNotes: "Organise a Meeting", lostReason: "", created: "3/18/2026", urgent: false },
  { name: "Rajan", phone: "0402 441 139", email: "rajrp8702@gmail.com", location: "243 Flushcombe Road, Blacktown", sourceDetail: "Personal", stage: "In Follow-up", assigned: "", budget: "", type: ["Granny Flat"], notes: "Waiting for information", followupDate: "", followupTime: "", followupNotes: "Waiting for information", lostReason: "", created: "3/19/2026", urgent: false },
  { name: "Alan", phone: "0449 849 444", email: "alanorton6@hotmail.com", location: "16 Macarthur Ave Strathfield", sourceDetail: "Personal", stage: "Disqualified", assigned: "Sold Property", budget: "", type: ["Knockdown and rebuild"], notes: "Waiting for RMAI", followupDate: "", followupTime: "", followupNotes: "Cancelled", lostReason: "Sold Property", created: "3/19/2026", urgent: false },
  { name: "Sukh Multani", phone: "", email: "Sukh.Multani@AirservicesAustralia.com", location: "", sourceDetail: "Personal", stage: "In Follow-up", assigned: "Gurpinder", budget: "", type: ["Double Storey"], notes: "sent him qoute", followupDate: "4/10/2026", followupTime: "", followupNotes: "Follow-up in 7 days", lostReason: "", created: "3/19/2026", urgent: false },
  { name: "Caroline", phone: "0435 033 081", email: "", location: "", sourceDetail: "Personal", stage: "In Follow-up", assigned: "", budget: "", type: ["Duplex"], notes: "Discussed with Gurpinder in messages", followupDate: "5/10/2026", followupTime: "", followupNotes: "Follow-up in 1 month", lostReason: "", created: "3/25/2026", urgent: false },
  { name: "Harish Saluja", phone: "", email: "harish@richmanproperty.com.au", location: "Austral", sourceDetail: "Business", stage: "New", assigned: "", budget: "", type: ["New Home"], notes: "5 House Project", followupDate: "", followupTime: "", followupNotes: "", lostReason: "", created: "3/24/2026", urgent: false },
  { name: "Luke", phone: "0478 058 096", email: "", location: "", sourceDetail: "Personal", stage: "Meeting Scheduled", assigned: "Gurpinder", budget: "", type: ["Single Storey"], notes: "Referral by Lea Real Estate, met Luke on 10/04/2026", followupDate: "5/15/2026", followupTime: "", followupNotes: "Follow-up in 1 Day", lostReason: "", created: "4/10/2026", urgent: false },
  { name: "Belen", phone: "353490602", email: "annasmithxx109@gmail.com", location: "", sourceDetail: "Personal", stage: "In Follow-up", assigned: "", budget: "", type: ["Renovation"], notes: "Remodel 3 bed home into 2 bed home", followupDate: "4/10/2026", followupTime: "", followupNotes: "", lostReason: "", created: "4/10/2026", urgent: false },
  { name: "Kevin Lam", phone: "0404 843 226", email: "Kevinlam82@hotmail.com", location: "2171 area", sourceDetail: "Personal", stage: "In Follow-up", assigned: "", budget: "", type: ["New Home"], notes: "Looking to build custom home", followupDate: "", followupTime: "", followupNotes: "", lostReason: "", created: "4/11/2026", urgent: false },
  { name: "Gus", phone: "", email: "ghasan.jibrael@hotmail.com", location: "Horningsea Park", sourceDetail: "Personal", stage: "Meeting Scheduled", assigned: "", budget: "", type: ["Double Storey", "Granny Flat"], notes: "Looking to build 2 storey + granny", followupDate: "", followupTime: "", followupNotes: "Organise a Meeting", lostReason: "", created: "4/15/2026", urgent: false },
  { name: "Simon", phone: "0416 256 144", email: "salamfadia2002@gmail.com", location: "", sourceDetail: "Personal", stage: "Disqualified", assigned: "", budget: "", type: ["Double Storey"], notes: "Disqualified, Loan not proved", followupDate: "", followupTime: "", followupNotes: "Send an Email/Text", lostReason: "Loan not proved", created: "4/15/2026", urgent: false },
  { name: "Arthur Dsouza", phone: "0414 595 855", email: "arthurdsouza55@gmail.com", location: "sand beach front", sourceDetail: "Personal", stage: "In Follow-up", assigned: "Jessica to email", budget: "", type: ["Duplex"], notes: "Emailed a follow up - build a duplex 4 bed 2 bath with basement", followupDate: "4/22/2025", followupTime: "", followupNotes: "Waiting for information", lostReason: "", created: "4/22/2026", urgent: false },
  { name: "Shaktika Singh", phone: "0405 514 712", email: "shaktika.singh@harcourts.com.au", location: "Toongabbie", sourceDetail: "Personal", stage: "In Follow-up", assigned: "Gurpinder", budget: "", type: ["Not Specified"], notes: "Looking to build in Toongabbie", followupDate: "", followupTime: "", followupNotes: "Follow-up in 3 months", lostReason: "", created: "4/22/2026", urgent: false },
  { name: "Naima Omari", phone: "0434 504 234", email: "naimaomari@hotmail.com", location: "6 Steel Street, Granville", sourceDetail: "Personal", stage: "In Follow-up", assigned: "", budget: "", type: ["Not Specified"], notes: "Emailed", followupDate: "", followupTime: "", followupNotes: "Waiting for information", lostReason: "", created: "4/22/2026", urgent: false },
  { name: "Fouad", phone: "0400 499 370", email: "alternate contact: 0411647159", location: "Gregory Hills", sourceDetail: "Personal", stage: "In Follow-up", assigned: "", budget: "", type: ["Not Specified"], notes: "Want to build in Gregory hills area", followupDate: "", followupTime: "", followupNotes: "", lostReason: "", created: "4/22/2026", urgent: false },
  { name: "Sailaja", phone: "", email: "sailajayerrapureddy@gmail.com", location: "11 Wheat St, Oran park", sourceDetail: "Personal", stage: "Converted", assigned: "", budget: "", type: ["Double Storey"], notes: "won the job", followupDate: "", followupTime: "", followupNotes: "Send an Email/Text", lostReason: "", created: "4/23/2026", urgent: false },
  { name: "Jay", phone: "", email: "jaysimha_m@yahoo.com.in", location: "Lot 3100 in Orchard Hills", sourceDetail: "Personal", stage: "In Follow-up", assigned: "", budget: "", type: ["Double Storey", "Granny Flat"], notes: "Under Quote Stage", followupDate: "4/28/2026", followupTime: "", followupNotes: "Send an Email/Text", lostReason: "", created: "4/29/2026", urgent: false },
  { name: "Simran Singh", phone: "0449 831 860", email: "", location: "North Kellyville", sourceDetail: "Personal", stage: "Meeting Scheduled", assigned: "", budget: "", type: ["Double Storey"], notes: "Keen to meet in person", followupDate: "4/30/2026", followupTime: "", followupNotes: "Organise a Meeting", lostReason: "", created: "4/29/2026", urgent: false },
  { name: "Angie", phone: "", email: "angie.myyrylainen@gmail.com", location: "Wilton", sourceDetail: "Personal", stage: "Meeting Scheduled", assigned: "", budget: "", type: ["Dual Occupancy"], notes: "Interested in dual occupancy home in wilton", followupDate: "5/1/2026", followupTime: "", followupNotes: "", lostReason: "", created: "4/30/2026", urgent: false },
  { name: "Ganesh", phone: "", email: "", location: "Wilton", sourceDetail: "Personal", stage: "Converted", assigned: "", budget: "", type: ["Double Storey", "Granny Flat"], notes: "won the job", followupDate: "", followupTime: "", followupNotes: "", lostReason: "", created: "4/19/2026", urgent: false },
  { name: "Raza", phone: "0432 534 735", email: "info@rhhomes.com.au", location: "Leppington", sourceDetail: "Business", stage: "Qualified", assigned: "", budget: "", type: ["Not Specified"], notes: "", followupDate: "", followupTime: "", followupNotes: "", lostReason: "", created: "4/19/2026", urgent: false },
  { name: "Adriana", phone: "", email: "adrianazizovski@gmail.com", location: "6 Linum Place, Barrack Heights", sourceDetail: "Personal", stage: "Meeting Scheduled", assigned: "", budget: "", type: ["Double Storey", "Dual Occupancy"], notes: "", followupDate: "", followupTime: "", followupNotes: "", lostReason: "", created: "4/30/2026", urgent: false },
  { name: "David Semedo", phone: "0424 453 362", email: "", location: "Illawarra", sourceDetail: "Personal", stage: "In Follow-up", assigned: "", budget: "$750-800k", type: ["House + land package"], notes: "Interested in house and land package in Illawarra ($750-800k)", followupDate: "", followupTime: "", followupNotes: "", lostReason: "", created: "5/1/2026", urgent: false },
  { name: "Abbas Abdul-hadi", phone: "0415 104 639", email: "abbas9871@gmail.com", location: "", sourceDetail: "Personal", stage: "No Response", assigned: "Gurpinder", budget: "", type: ["Granny Flat"], notes: "Looking to build 2 bedroon granny flat - meeting w/ Guri 8/5", followupDate: "5/8/2026", followupTime: "", followupNotes: "", lostReason: "", created: "5/7/2026", urgent: false },
  { name: "Majd", phone: "0421 104 354", email: "", location: "", sourceDetail: "Personal", stage: "No Response", assigned: "", budget: "", type: ["Double Storey"], notes: "Called multiple occasions", followupDate: "4/10/2026", followupTime: "", followupNotes: "", lostReason: "", created: "3/26/2026", urgent: false },
];

async function main() {
  // Clear existing leads and their history
  console.log("🗑️  Clearing existing leads...");
  await prisma.leadHistory.deleteMany();
  await prisma.lead.deleteMany();

  console.log(`📥 Seeding ${data.length} leads...`);

  let count = 0;
  for (const lead of data) {
    const stage = stageMap[lead.stage];
    if (!stage) {
      console.error(`❌ Unknown stage "${lead.stage}" for lead "${lead.name}", skipping.`);
      continue;
    }

    await prisma.lead.create({
      data: {
        name: lead.name,
        phone: lead.phone || "",
        email: lead.email || "",
        location: lead.location || "",
        sourceDetail: lead.sourceDetail || null,
        stage,
        assigned: lead.assigned || null,
        budget: lead.budget || null,
        type: lead.type,
        notes: lead.notes || null,
        followupDate: parseDate(lead.followupDate),
        followupTime: lead.followupTime || null,
        followupNotes: lead.followupNotes || null,
        lostReason: lead.lostReason || null,
        urgent: lead.urgent,
        createdAt: parseDate(lead.created) ?? new Date(),
      },
    });
    count++;
  }

  console.log(`✅ Successfully seeded ${count} leads.`);
}

main()
  .catch((error) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
