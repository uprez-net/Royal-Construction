import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";

type UserCellProps = {
  name: string;
  avatarUrl?: string | null;
};

const gradients = [
  "from-blue-500 to-cyan-500",
  "from-violet-500 to-purple-500",
  "from-pink-500 to-rose-500",
  "from-emerald-500 to-teal-500",
  "from-orange-500 to-amber-500",
  "from-red-500 to-pink-500",
  "from-indigo-500 to-blue-500",
  "from-fuchsia-500 to-violet-500",
  "from-sky-500 to-indigo-500",
  "from-green-500 to-emerald-500",
];

/**
 * Deterministic hash from string
 */
function hashString(str: string): number {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash);
}

/**
 * John Doe => JD
 * John => J
 * john michael doe => JD
 */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0][0].toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function UserCell({ name, avatarUrl }: UserCellProps) {
  const gradient = gradients[hashString(name) % gradients.length];

  const initials = getInitials(name);

  return (
    <div className="flex items-center gap-3">
      <Avatar className="h-8 w-8">
        <AvatarImage src={avatarUrl ?? undefined} alt={name} />

        <AvatarFallback
          className={`bg-gradient-to-br ${gradient} text-xs font-semibold text-white`}
        >
          {initials}
        </AvatarFallback>
      </Avatar>

      <span className="font-medium">{name}</span>
    </div>
  );
}
