import { getTradieById } from "@/lib/data/tradie-management";
import { notFound } from "next/navigation";

interface TradieDetailPageProps {
    params: Promise<{
        id: string;
    }>;
}

export default async function TradieDetailPage({ params }: TradieDetailPageProps) {
    const { id } = await params;
    const tradieDetails = await getTradieById(id);

    if(!tradieDetails) {
        notFound();
    }

    return (
        <div className="flex flex-col gap-4 p-4">
            {JSON.stringify(tradieDetails, null, 2)}
        </div>
    );
}