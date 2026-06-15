import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { queryKeys } from "../../queries/keys";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { useAppStore } from "../../store/appStore";

/** Settings card listing persisted chat permission policies (allow/reject always). */
export function ChatPermissionPoliciesCard() {
  const queryClient = useQueryClient();
  const policiesQuery = useQuery({
    queryKey: queryKeys.chatPermissionPolicies(),
    queryFn: () => api.listChatPermissionPolicies(),
  });
  const policies = policiesQuery.data ?? [];

  return (
    <div className="flex flex-col gap-2" data-testid="chat-permission-policies">
      <p className="text-xs text-muted-foreground">
        Tool permissions you chose &ldquo;always&rdquo; in chat are remembered here and auto-applied on
        future prompts.
      </p>
      {policies.length === 0 ? (
        <p className="text-sm text-muted-foreground">No saved policies yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {policies.map((policy) => (
            <li
              key={policy.toolTitle}
              className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm"
            >
              <span className="truncate font-medium">{policy.toolTitle}</span>
              <Badge variant="outline" className="shrink-0 capitalize">
                {policy.kind.replace("_", " ")}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={policies.length === 0}
        onClick={() => {
          void api
            .clearChatPermissionPolicies()
            .then(() =>
              queryClient.invalidateQueries({ queryKey: queryKeys.chatPermissionPolicies() }),
            )
            .catch((error) => useAppStore.getState().setMessage(String(error)));
        }}
      >
        Clear all policies
      </Button>
    </div>
  );
}
