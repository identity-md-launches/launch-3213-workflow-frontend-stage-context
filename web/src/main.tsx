import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { loadRuntime } from "./config";
import "./styles.css";
const root = createRoot(document.getElementById("root")!);
root.render(
  <main className="boot">
    <h1>The Firm.</h1>
    <p>Verifying deployment files…</p>
  </main>,
);
loadRuntime()
  .then((r) => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { refetchOnWindowFocus: false, retry: false },
      },
    });
    root.render(
      <WagmiProvider config={r.wagmi} reconnectOnMount={false}>
        <QueryClientProvider client={queryClient}>
          <App r={r} />
        </QueryClientProvider>
      </WagmiProvider>,
    );
  })
  .catch((e) =>
    root.render(
      <main className="boot">
        <h1>The Firm.</h1>
        <p role="alert">
          {e instanceof Error ? e.message : "Unable to load deployment."}
        </p>
        <button onClick={() => location.reload()}>Reload deployment</button>
      </main>,
    ),
  );
