"use client";

import { useEffect, useState } from "react";
import { List, Loader2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Tradie = {
  id: string;
  name: string;
  company: string | null;
  tradeType: string;
  phone: string;
  email: string;
  rating: string | null;
};

export function TradieDirectoryModal() {
  const [open, setOpen] = useState(false);
  const [tradies, setTradies] = useState<Tradie[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    async function loadTradies() {
      setLoading(true);
      const response = await fetch("/api/tradies");
      const data = (await response.json()) as Tradie[];
      setTradies(data);
      setLoading(false);
    }

    void loadTradies();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Users className="size-4" />
        Tradie Directory
      </Button>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Tradie Directory</DialogTitle>
          <DialogDescription>Read-only directory of all active tradies in the database.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Loading tradies
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {tradies.map((tradie) => (
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
                  <p>Rating: {tradie.rating ?? "N/A"}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
