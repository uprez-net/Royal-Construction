import { Card, CardContent, CardHeader } from "../ui/card";

export function GraphCard({
  title,
  actionNode,
  graphNode,
}: {
  title: string;
  actionNode?: React.ReactNode;
  graphNode: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between border-b border-border/60 pb-4">
        <h2 className="font-heading text-[1.0625rem] leading-[1.3] font-semibold tracking-[-0.01em] text-foreground">
          {title}
        </h2>

        {actionNode}
      </CardHeader>
      <CardContent>{graphNode}</CardContent>
    </Card>
  );
}
