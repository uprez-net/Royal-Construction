import { useChatContext } from "@/context/ChatContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMemo } from "react";
import {
  extractLineItemsFromMessage,
  extractOfferFileFromMessage,
} from "@/utils/chat";

export function OfferVersionSelector() {
  const { currentVersion, offerFile, versions, messages, setVersion } = useChatContext();
  const { initialLineItems, initialOfferFile } = useMemo(() => {
    return {
      initialLineItems: extractLineItemsFromMessage(messages),
      initialOfferFile: extractOfferFileFromMessage(messages, offerFile),
    };
  }, [messages, offerFile]);

  const disableCurrent = useMemo(() => {
    if (
      (initialLineItems.length > 0 &&
        initialOfferFile.projectWelcomeMessage?.length) ||
      initialOfferFile.projectScope?.length
    ) {
      return false;
    } else {
      return currentVersion === "current" ? false : true;
    }
  }, [initialLineItems, initialOfferFile, currentVersion]);

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
        {!disableCurrent && <SelectItem value="current">Current</SelectItem>}
        {Array.from({ length: versions }, (_, i) => (
          <SelectItem key={i + 1} value={(i + 1).toString()}>
            Version {i + 1}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
