import { useMemo } from "react";
import { cn } from "../../lib/utils";
import type { ChatMessage } from "../../types";
import { ChatPartView, type ChatPartHandlers } from "./ChatParts";

export interface ChatTranscriptProps extends ChatPartHandlers {
  messages: ChatMessage[];
}

/**
 * Presentational transcript: renders normalized [`ChatMessage`] turns as rows of
 * [`ChatPartView`] parts. Pure and data-driven — the live ACP stream and the
 * persisted transcript both feed the same shape, so this renders either.
 */
export function ChatTranscript({ messages, onRespondPermission, onOpenFile }: ChatTranscriptProps) {
  // Stable identity so the memoized ChatPartView isn't defeated on every
  // streaming snapshot (which re-creates the messages array).
  const handlers = useMemo<ChatPartHandlers>(
    () => ({ onRespondPermission, onOpenFile }),
    [onRespondPermission, onOpenFile],
  );
  return (
    <div className="nx-chat-transcript" data-testid="chat-transcript">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn("nx-chat-row", `nx-chat-row-${message.role}`)}
          data-role={message.role}
          data-testid="chat-message"
        >
          {message.parts.map((part, index) => (
            <ChatPartView key={`${message.id}-${index}`} part={part} handlers={handlers} />
          ))}
        </div>
      ))}
    </div>
  );
}
