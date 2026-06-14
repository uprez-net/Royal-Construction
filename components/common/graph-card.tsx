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
        <h4 className="uppercase font-bold text-muted-foreground">{title}</h4>

        {actionNode}
      </CardHeader>
      <CardContent>{graphNode}</CardContent>
    </Card>
  );
}
