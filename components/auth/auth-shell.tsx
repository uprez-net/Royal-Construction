import type { ReactNode } from "react";
import Image from "next/image";

export function AuthShell({
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-[calc(100dvh_-_var(--sandbox-banner-height,0px))] flex-col items-center justify-center bg-background px-8 py-12">
      <div className="mb-8">
        <Image
          src="/logo-1024x713.png"
          alt="Royal Constructions"
          width={160}
          height={111}
          className="object-contain"
          priority
        />
      </div>
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
