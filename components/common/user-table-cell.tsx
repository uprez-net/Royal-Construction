import { Avatar, AvatarImage, AvatarFallback } from "../ui/avatar";

type UserCellProps = {
  name: string;
  avatarUrl?: string | null;
};

export function UserCell({
  name,
  avatarUrl,
}: UserCellProps) {
  return (
    <div className="flex items-center gap-3">
      <Avatar className="h-8 w-8">
        <AvatarImage src={avatarUrl ?? undefined} alt={name} />
        <AvatarFallback>
          {name.trim().charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <span className="font-medium">{name}</span>
    </div>
  );
}