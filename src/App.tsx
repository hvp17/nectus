import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "./components/ui/tooltip";
import { createQueryClient } from "./queries/queryClient";
import { createAppRouter, RouterProvider } from "./AppRouter";

/**
 * Root component. Owns the app-wide providers (TanStack Query + Tooltip) so every
 * hook below — including `useApp` — has them in scope, then hands off to the
 * TanStack Router which renders the persistent shell and the routed views.
 *
 * A fresh `QueryClient` and router per mount keep each `render(<App/>)` in the test
 * suite isolated (no cache or navigation-state bleed between tests).
 */
function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(createAppRouter);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
