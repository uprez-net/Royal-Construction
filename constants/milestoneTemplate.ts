import { ProjectStage } from "@prisma/client";

interface MilestoneTemplate {
  order: number;
  name: string;
  parentId: number | null;
  projectStage: ProjectStage;
}

export const milestoneTemplates: MilestoneTemplate[] = [
  { order: 1, name: "Surveyor comes to do peg out survey", parentId: null, projectStage: ProjectStage.Deposit },
  { order: 2, name: "Fence & Sedimentation Booking", parentId: null, projectStage: ProjectStage.Deposit },
  { order: 3, name: "Cut & Fill - Concretor (Land Leveling)", parentId: null, projectStage: ProjectStage.Slab },

  { order: 4, name: "Piering & Pouring", parentId: null, projectStage: ProjectStage.Slab },
  { order: 5, name: "Sydney Water Co-ordinator Inspection", parentId: 4, projectStage: ProjectStage.Slab },
  { order: 6, name: "Engineer Inspection", parentId: 4, projectStage: ProjectStage.Slab },
  { order: 7, name: "Certifier Inspection", parentId: 4, projectStage: ProjectStage.Slab },

  { order: 8, name: "Follow Up Certificates Issued", parentId: null, projectStage: ProjectStage.Slab },
  { order: 9, name: "Internal Plumbing (Underground)", parentId: null, projectStage: ProjectStage.Slab },
  { order: 10, name: "Termite Pipe Penetration", parentId: null, projectStage: ProjectStage.Slab },

  { order: 11, name: "Steel Reinforcement", parentId: null, projectStage: ProjectStage.Slab },
  { order: 12, name: "Formwork Check", parentId: 11, projectStage: ProjectStage.Slab },
  { order: 13, name: "Engineer Inspection", parentId: 11, projectStage: ProjectStage.Slab },
  { order: 14, name: "Certifier Inspection", parentId: 11, projectStage: ProjectStage.Slab },

  { order: 15, name: "Follow Up Certificates Issued", parentId: null, projectStage: ProjectStage.Slab },
  { order: 16, name: "Slab Gets Poured", parentId: null, projectStage: ProjectStage.Slab },
  { order: 17, name: "Apply for Electricity Connection", parentId: null, projectStage: ProjectStage.Frame },
  { order: 18, name: "Apply for Gas Connection", parentId: null, projectStage: ProjectStage.Frame },

  { order: 19, name: "Stormwater Plumbing", parentId: null, projectStage: ProjectStage.Frame },
  { order: 20, name: "Certifier Conducts Inspection for Stormwater Plumbing", parentId: null, projectStage: ProjectStage.Frame },
  { order: 21, name: "Follow Up Certificates Issued", parentId: null, projectStage: ProjectStage.Frame },
  { order: 22, name: "Electrical Level 2 Work", parentId: null, projectStage: ProjectStage.Frame },
  { order: 23, name: "Termite Barrier", parentId: null, projectStage: ProjectStage.Frame },

  { order: 24, name: "Frame", parentId: null, projectStage: ProjectStage.Frame },
  { order: 25, name: "Windows", parentId: null, projectStage: ProjectStage.Frame },
  { order: 26, name: "Order Bricks", parentId: null, projectStage: ProjectStage.Frame },
  { order: 27, name: "Select Paint Colour for Eaves Internal & External (Refer to 24 & 39)", parentId: null, projectStage: ProjectStage.Frame },
  { order: 28, name: "Scaffolding (If Double Storey)", parentId: null, projectStage: ProjectStage.Frame },
  { order: 29, name: "Frame Inspection Certifier", parentId: null, projectStage: ProjectStage.Frame },
  { order: 30, name: "Frame Inspection Engineer", parentId: null, projectStage: ProjectStage.Frame },
  { order: 31, name: "Follow Up Certificates Issued", parentId: null, projectStage: ProjectStage.Frame },

  { order: 32, name: "Brick Laying", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 33, name: "Termite Guys Book to Glue", parentId: 29, projectStage: ProjectStage.Lockup },

  { order: 34, name: "Roof", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 35, name: "Brick Wash", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 36, name: "Brick Joint Silicone + Window Angles", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 37, name: "Garage Door to be Selected and Ordered", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 38, name: "Tiles to be Selected and Ordered Before Insulation", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 39, name: "Send Site Ready Photos to GAS (Single Storey)", parentId: null, projectStage: ProjectStage.Lockup },

  { order: 40, name: "Select Stairs (If Applicable)", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 41, name: "Kitchen Design + Joinery + Appliances to Order (Must Be Finished Before Plumbing Start)", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 42, name: "Eaves", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 43, name: "Paint Eaves", parentId: null, projectStage: ProjectStage.Lockup },

  { order: 44, name: "PC Items Must Be Selected and Ordered Before Plumbing Schedule", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 45, name: "Aircon (Ducted Vacuum if Applicable)", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 46, name: "Window Glazing", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 47, name: "Electrical Wiring - Schedule Only", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 48, name: "Plumbing Schedule (Hot, Cold, Stack Work)", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 49, name: "Timbers for Vanities + Cavities", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 50, name: "Camera Wiring (If Applicable)", parentId: null, projectStage: ProjectStage.Lockup },

  { order: 51, name: "Select Flooring", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 52, name: "Insulation", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 53, name: "Door & Handle Selection", parentId: null, projectStage: ProjectStage.Lockup },
  { order: 54, name: "Select Skirting / Cornice / Pelmets / Architraves", parentId: null, projectStage: ProjectStage.Lockup },

  { order: 55, name: "Gyprock", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },
  { order: 56, name: "Joinery Measurement", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },

  { order: 57, name: "Garage Door", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },

  { order: 58, name: "Stairs (If Double Storey)", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },

  { order: 59, name: "Sanding", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },
  { order: 60, name: "Painting", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },

  { order: 61, name: "Waterproofing", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },
  { order: 62, name: "Waterproofing Inspection", parentId: 61, projectStage: ProjectStage.Interior_Fit_Out },

  { order: 63, name: "Follow Up Certificates Issued", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },
  { order: 64, name: "Wet Areas Architraves", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },
  { order: 65, name: "Tiling", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },
  { order: 66, name: "Doors + Carpet Skirting (If Applicable)", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },
  { order: 67, name: "Shower & Wardrobe Measurements", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },



  { order: 68, name: "Electrician Installs All Lights", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },
  { order: 69, name: "Kitchen & Joinery Installation", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },
  { order: 70, name: "Wardrobes", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },
  { order: 71, name: "Showers", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },
  { order: 72, name: "Aircon Machine", parentId: null, projectStage: ProjectStage.Interior_Fit_Out },


  { order: 73, name: "Driveway Steel Reinforcement (Check Gas Installed)", parentId: null, projectStage: ProjectStage.Final },
  { order: 74, name: "Council Driveway Inspection", parentId: 73, projectStage: ProjectStage.Final },
  { order: 75, name: "Driveway Gets Poured", parentId: null, projectStage: ProjectStage.Final },
  { order: 76, name: "Final Survey", parentId: null, projectStage: ProjectStage.Final },
  { order: 77, name: "Landscaping & Fencing", parentId: null, projectStage: ProjectStage.Final },
  { order: 78, name: "Final Inspection", parentId: null, projectStage: ProjectStage.Final },
];