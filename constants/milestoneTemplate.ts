interface MilestoneTemplate {
  order: number;
  name: string;
  parentId: number | null;
}

export const milestoneTemplates: MilestoneTemplate[] = [
  { order: 1, name: "Surveyor comes to do peg out survey", parentId: null },
  { order: 2, name: "Fence & Sedimentation Booking", parentId: null },
  { order: 3, name: "Cut & Fill - Concretor (Land Leveling)", parentId: null },

  { order: 4, name: "Piering & Pouring", parentId: null },
  { order: 5, name: "Sydney Water Co-ordinator Inspection", parentId: 4 },
  { order: 6, name: "Engineer Inspection", parentId: 4 },
  { order: 7, name: "Certifier Inspection", parentId: 4 },

  { order: 8, name: "Follow Up Certificates Issued", parentId: null },
  { order: 9, name: "Internal Plumbing (Underground)", parentId: null },
  { order: 10, name: "Termite Pipe Penetration", parentId: null },

  { order: 11, name: "Steel Reinforcement", parentId: null },
  { order: 12, name: "Formwork Check", parentId: 11 },
  { order: 13, name: "Engineer Inspection", parentId: 11 },
  { order: 14, name: "Certifier Inspection", parentId: 11 },

  { order: 15, name: "Follow Up Certificates Issued", parentId: null },
  { order: 16, name: "Slab Gets Poured", parentId: null },
  { order: 17, name: "Apply for Electricity Connection", parentId: null },
  { order: 18, name: "Apply for Gas Connection", parentId: null },

  { order: 19, name: "Stormwater Plumbing", parentId: null },
  { order: 20, name: "Certifier Conducts Inspection for Stormwater Plumbing", parentId: null },
  { order: 21, name: "Follow Up Certificates Issued", parentId: null },
  { order: 22, name: "Electrical Level 2 Work", parentId: null },
  { order: 23, name: "Termite Barrier", parentId: null },

  { order: 24, name: "Frame", parentId: null },
  { order: 25, name: "Windows", parentId: null },
  { order: 26, name: "Order Bricks", parentId: null },
  { order: 27, name: "Select Paint Colour for Eaves Internal & External (Refer to 24 & 39)", parentId: null },
  { order: 28, name: "Scaffolding (If Double Storey)", parentId: null },

  { order: 29, name: "Brick Laying", parentId: null },
  { order: 30, name: "Termite Guys Book to Glue", parentId: 29 },

  { order: 31, name: "Roof", parentId: null },
  { order: 32, name: "Brick Wash", parentId: null },
  { order: 33, name: "Brick Joint Silicone + Window Angles", parentId: null },
  { order: 34, name: "Garage Door to be Selected and Ordered", parentId: null },
  { order: 35, name: "Tiles to be Selected and Ordered Before Insulation", parentId: null },
  { order: 36, name: "Send Site Ready Photos to GAS (Single Storey)", parentId: null },

  { order: 37, name: "Frame Inspection Certifier", parentId: null },
  { order: 38, name: "Frame Inspection Engineer", parentId: null },

  { order: 39, name: "Follow Up Certificates Issued", parentId: null },
  { order: 40, name: "Select Stairs (If Applicable)", parentId: null },
  { order: 41, name: "Kitchen Design + Joinery + Appliances to Order (Must Be Finished Before Plumbing Start)", parentId: null },
  { order: 42, name: "Eaves", parentId: null },
  { order: 43, name: "Paint Eaves", parentId: null },

  { order: 44, name: "PC Items Must Be Selected and Ordered Before Plumbing Schedule", parentId: null },
  { order: 45, name: "Aircon (Ducted Vacuum if Applicable)", parentId: null },
  { order: 46, name: "Window Glazing", parentId: null },
  { order: 47, name: "Electrical Wiring - Schedule Only", parentId: null },
  { order: 48, name: "Plumbing Schedule (Hot, Cold, Stack Work)", parentId: null },
  { order: 49, name: "Timbers for Vanities + Cavities", parentId: null },

  { order: 50, name: "Camera Wiring (If Applicable)", parentId: null },

  { order: 51, name: "Select Flooring", parentId: null },
  { order: 52, name: "Insulation", parentId: null },
  { order: 53, name: "Door & Handle Selection", parentId: null },
  { order: 54, name: "Select Skirting / Cornice / Pelmets / Architraves", parentId: null },
  { order: 55, name: "Gyprock", parentId: null },
  { order: 56, name: "Joinery Measurement", parentId: null },

  { order: 57, name: "Garage Door", parentId: null },

  { order: 58, name: "Stairs (If Double Storey)", parentId: null },

  { order: 59, name: "Sanding", parentId: null },
  { order: 60, name: "Painting", parentId: null },

  { order: 61, name: "Waterproofing", parentId: null },
  { order: 62, name: "Waterproofing Inspection", parentId: 61 },

  { order: 63, name: "Follow Up Certificates Issued", parentId: null },
  { order: 64, name: "Wet Areas Architraves", parentId: null },
  { order: 65, name: "Tiling", parentId: null },
  { order: 66, name: "Doors + Carpet Skirting (If Applicable)", parentId: null },
  { order: 67, name: "Shower & Wardrobe Measurements", parentId: null },

  { order: 68, name: "Driveway Steel Reinforcement (Check Gas Installed)", parentId: null },
  { order: 69, name: "Council Driveway Inspection", parentId: 68 },

  { order: 70, name: "Driveway Gets Poured", parentId: null },
  { order: 71, name: "Electrician Installs All Lights", parentId: null },
  { order: 72, name: "Kitchen & Joinery Installation", parentId: null },
  { order: 73, name: "Wardrobes", parentId: null },
  { order: 74, name: "Showers", parentId: null },
  { order: 75, name: "Final Plumbing Fit Out", parentId: null },
  { order: 76, name: "Floor Board (If Applicable)", parentId: null },
  { order: 77, name: "Floor Board Skirting Painting (If Applicable)", parentId: null },
  { order: 78, name: "Aircon Machine", parentId: null },
  { order: 79, name: "Final Survey", parentId: null },
  { order: 80, name: "Landscaping & Fencing", parentId: null },
  { order: 81, name: "Final Inspection", parentId: null },
];