import { useEffect, useMemo } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { ChatMessageRow, type ChatPartHandlers } from "@/lib/chat/renderChatParts";
import type { ChatMessage, ChatPart } from "@/types";

export interface ChatTranscriptProps extends ChatPartHandlers {
  messages: ChatMessage[];
}

/** Cheap signature of the transcript tail so streaming part growth re-triggers follow. */
function chatTranscriptTailSignature(messages: ChatMessage[]): string {
  const last = messages.at(-1);
  if (!last) return "empty";

  const partsSig = last.parts.map(partSignature).join("|");
  return `${messages.length}:${last.id}:${last.role}:${last.completedAt ?? ""}:${partsSig}`;
}

function partSignature(part: ChatPart): string {
  switch (part.type) {
    case "text":
    case "reasoning":
      return `${part.type}:${part.text.length}`;
    case "tool":
      return `tool:${part.status}:${part.output?.length ?? 0}`;
    case "file_edit":
      return `file:${part.path}`;
    case "permission":
      return `perm:${part.requestId}`;
    case "plan":
      return `plan:${part.entries.length}`;
    default:
      return "unknown";
  }
}

/** Keeps the viewport pinned while the user is following the thread or just sent a turn. */
function ChatTranscriptAutoScroll({ messages }: { messages: ChatMessage[] }) {
  const { scrollToBottom, isAtBottom } = useStickToBottomContext();
  const tailSignature = chatTranscriptTailSignature(messages);

  useEffect(() => {
    const last = messages.at(-1);
    const shouldFollow = isAtBottom || last?.role === "user";
    if (!shouldFollow) return;

    const frame = requestAnimationFrame(() => {
      void scrollToBottom("smooth");
    });
    return () => cancelAnimationFrame(frame);
  }, [tailSignature, isAtBottom, messages, scrollToBottom]);

  return null;
}

/**
 * Presentational transcript: renders normalized [`ChatMessage`] turns via AI Elements.
 * Pure and data-driven — the live ACP stream and the persisted transcript both feed
 * the same shape.
 */
export function ChatTranscript({ messages, onRespondPermission, onOpenFile }: ChatTranscriptProps) {
  const handlers = useMemo<ChatPartHandlers>(
    () => ({ onRespondPermission, onOpenFile }),
    [onRespondPermission, onOpenFile],
  );

  return (
    <Conversation className="min-h-0 flex-1" data-testid="chat-transcript" aria-live="polite" aria-relevant="additions">
      <ConversationContent>
        <ChatTranscriptAutoScroll messages={messages} />
        {messages.map((message) => (
          <ChatMessageRow key={message.id} handlers={handlers} message={message} />
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
