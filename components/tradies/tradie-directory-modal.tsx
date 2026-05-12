"use client";

import { useState } from "react";
import { List } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppSelector } from "@/lib/store/hooks";

export function TradieDirectoryModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const tradies = useAppSelector((state) => state.tradies.tradies);
  const [search, setSearch] = useState("");

  const filteredTradies = tradies.filter((tradie) => {
    const query = search.toLowerCase();
    return [tradie.name, tradie.company ?? "", tradie.tradeType].some((value) => value.toLowerCase().includes(query));
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setSearch("");
        }

        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Tradie Directory</DialogTitle>
          <DialogDescription>Read-only directory of all active tradies in the database.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, company, or trade type"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredTradies.map((tradie) => (
              <div key={tradie.id} className="rounded-2xl border border-border bg-background p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-950">{tradie.name}</p>
                    <p className="text-sm text-muted-foreground">{tradie.company ?? "Independent"}</p>
                  </div>
                  <List className="size-4 text-teal-700" />
                </div>
                <div className="mt-3 space-y-1 text-sm text-slate-700">
                  <p>{tradie.tradeType}</p>
                  <p>{tradie.phone}</p>
                  <p>{tradie.email}</p>
                  <p>Rating: {tradie.rating ? String(tradie.rating) : "N/A"}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
