import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "./components/ui/tooltip";
import { createQueryClient } from "./queries/queryClient";
import { AppLayout } from "./AppRouter";

/**
 * Root component. Owns the app-wide providers (TanStack Query + Tooltip) so every
 * hook below has them in scope, then renders the persistent shell (`AppLayout`),
 * which switches between views off the store's `currentView` (no router).
 *
 * A fresh `QueryClient` per mount keeps each `render(<App/>)` in the test suite
 * isolated (no cache bleed between tests).
 */
function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppLayout />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
