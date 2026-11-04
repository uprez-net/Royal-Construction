-- CreateTable
CREATE TABLE "TradeType" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradeType_label_key" ON "TradeType"("label");

-- The trades that were the TRADIE_TYPES constant in constants/tradieTypes.ts,
-- plus Lighting. Labels are exactly what Tradie.trade already holds.
INSERT INTO "TradeType" ("id", "label", "icon", "updatedAt")
SELECT gen_random_uuid()::text, seed.label, seed.icon, CURRENT_TIMESTAMP
FROM (VALUES
    ('Electrician', 'zap'),
    ('Lighting', 'lightbulb'),
    ('Plumbing', 'wrench'),
    ('Carpentry', 'hammer'),
    ('Painting', 'paintbrush'),
    ('Roofing', 'house'),
    ('HVAC', 'fan'),
    ('Landscaping', 'trees'),
    ('Masonry', 'brick-wall'),
    ('Bricklaying', 'brick-wall'),
    ('Plastering', 'panel-top'),
    ('Tiling', 'grid-3x3'),
    ('Glazing', 'square-stack'),
    ('Flooring', 'layout-grid'),
    ('Kitchen Installation', 'building-2'),
    ('Concrete', 'hammer'),
    ('Windows & Doors', 'door-open'),
    ('Joinery', 'drill'),
    ('Structural Engineering', 'ruler'),
    ('Pest Control', 'bug'),
    ('Surveying', 'compass'),
    ('Sydney Water', 'droplets'),
    ('Scaffolding', 'construction'),
    ('Waterproofing', 'shield-check'),
    ('Fit-out Carpentry', 'hammer'),
    ('Interior Fit-out', 'sofa'),
    ('Gyprock', 'panel-top'),
    ('Metal Roofing', 'warehouse'),
    ('Certifier', 'badge-check'),
    ('Architecture', 'pencil-ruler'),
    ('BASIX Assessment', 'leaf'),
    ('Bushfire Assessment', 'flame'),
    ('Traffic Control', 'traffic-cone')
) AS seed(label, icon);

-- The directory used to group a tradie by looking its trade up against both a
-- constant's key ("PLUMBER") and its label ("Plumbing"), case-insensitively. It
-- now groups by the label as stored, so rewrite any other spelling to the label
-- once, here, and nobody moves group.
UPDATE "Tradie" AS t
SET "trade" = alias.label
FROM (VALUES
    ('electrician', 'Electrician'),
    ('plumber', 'Plumbing'),
    ('carpenter', 'Carpentry'),
    ('painter', 'Painting'),
    ('roofer', 'Roofing'),
    ('hvac_technician', 'HVAC'),
    ('landscaper', 'Landscaping'),
    ('mason', 'Masonry'),
    ('bricklayer', 'Bricklaying'),
    ('plasterer', 'Plastering'),
    ('tiling_specialist', 'Tiling'),
    ('glazier', 'Glazing'),
    ('flooring_specialist', 'Flooring'),
    ('kitchen_specialist', 'Kitchen Installation'),
    ('concrete_specialist', 'Concrete'),
    ('window_door_specialist', 'Windows & Doors'),
    ('joiner', 'Joinery'),
    ('structural_engineer', 'Structural Engineering'),
    ('pest_control', 'Pest Control'),
    ('surveyor', 'Surveying'),
    ('water_authority', 'Sydney Water'),
    ('scaffolder', 'Scaffolding'),
    ('waterproofer', 'Waterproofing'),
    ('fitout_carpenter', 'Fit-out Carpentry'),
    ('interior_fitout', 'Interior Fit-out'),
    ('gyprock_installer', 'Gyprock'),
    ('metal_roofer', 'Metal Roofing'),
    ('certifier', 'Certifier'),
    ('architect', 'Architecture'),
    ('basix_assessor', 'BASIX Assessment'),
    ('bushfire_assessor', 'Bushfire Assessment'),
    ('traffic_controller', 'Traffic Control')
) AS alias(key, label)
WHERE lower(trim(t."trade")) IN (alias.key, lower(alias.label))
  AND t."trade" <> alias.label;
