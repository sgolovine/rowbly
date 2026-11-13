import { Text } from "ink";
import type { ConversationPage } from "../../../services/conversation/conversation.js";
import { theme } from "../../theme.js";

export interface ConversationNoticeProps {
  /** Why the view shows no entries. */
  readonly status: Exclude<ConversationPage["status"], "ok"> | "loading" | "error";
  /** The message of a read that failed. */
  readonly error?: string;
}

/** The one row that a `ConversationView` shows in place of its entries: it loads, it failed, or there is nothing to show. */
export function ConversationNotice({ status, error }: ConversationNoticeProps) {
  if (status === "loading") {
    return <Text color={theme.inkFaint}>Loading the conversation…</Text>;
  }

  if (status === "error") {
    return (
      <Text color={theme.danger} wrap="wrap">
        Rowbly cannot read the conversation: {error}
      </Text>
    );
  }

  if (status === "missing") {
    return <Text color={theme.inkFaint}>No conversation yet. The worker has not sent its first message.</Text>;
  }

  return <Text color={theme.inkFaint}>Rowbly cannot show this session format.</Text>;
}
