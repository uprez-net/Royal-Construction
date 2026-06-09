import { useChatContext } from "@/context/ChatContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function OfferVersionSelector() {
  const { currentVersion, versions, setVersion } = useChatContext();
  return (
    <Select
      
      value={currentVersion.toString()}
      onValueChange={(value) =>
        setVersion(value === "current" ? "current" : parseInt(value))
      }
    >
      <SelectTrigger size="sm">
        <SelectValue placeholder="Select version" />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectItem value="current">Current</SelectItem>
        {Array.from({ length: versions }, (_, i) => (
          <SelectItem key={i + 1} value={(i + 1).toString()}>
            Version {i + 1}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
