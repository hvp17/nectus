import { CheckCircle2Icon, InfoIcon, XIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";

function getToastContent(message: string) {
  const separator = message.indexOf(": ");
  if (separator > 0) {
    return {
      title: message.slice(0, separator),
      body: message.slice(separator + 2),
      icon: "success" as const,
    };
  }

  return {
    title: "Nectus",
    body: message,
    icon: "info" as const,
  };
}

export function ToastNotification({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const toast = getToastContent(message);
  const Icon = toast.icon === "success" ? CheckCircle2Icon : InfoIcon;

  return (
    <div className="toast-viewport animate-in fade-in slide-in-from-top-3 duration-300">
      <Alert className="nectus-toast">
        <Icon />
        <AlertTitle>{toast.title}</AlertTitle>
        <AlertDescription className="toast-body">{toast.body}</AlertDescription>
        <AlertAction>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="toast-dismiss"
            aria-label="Dismiss notification"
            onClick={onDismiss}
          >
            <XIcon />
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
