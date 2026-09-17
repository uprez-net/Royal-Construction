import { Mail, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface LeadEmailBadgeProps {
  emails: string[];
  onRemoveEmail: (email: string) => void;
}

export function LeadEmailBadges({
  emails,
  onRemoveEmail,
}: LeadEmailBadgeProps) {
  return (
    <div className="mt-3 rounded-xl border bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Recipients</span>
        </div>

        <Badge variant="secondary" className="rounded-full">
          {emails.length}
        </Badge>
      </div>

      <div className="max-h-48 overflow-y-auto scrollbar-thin">
        {emails.length === 0 ? (
          <div className="flex items-center justify-center px-4 py-8 text-sm text-muted-foreground">
            No leads with email
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 p-4">
            {emails.map((email) => (
              <Badge
                key={email}
                variant="outline"
                className="group flex items-center gap-2 rounded-full px-3 py-1 text-xs font-normal"
              >
                <span className="max-w-55 truncate">{email}</span>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 rounded-full p-0 opacity-60 transition-opacity hover:bg-transparent hover:opacity-100"
                  onClick={() => onRemoveEmail(email)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
