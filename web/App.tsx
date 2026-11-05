import { useEffect, useState } from "react";
import { AppShell } from "./AppShell.tsx";
import { DEFAULT_ROUTE, resolveRoute } from "./nav.ts";

const routeFromHash = (): string =>
  window.location.hash.replace(/^#\/?/, "").split("?")[0] || DEFAULT_ROUTE;

export function App() {
  const [route, setRoute] = useState(() => resolveRoute(routeFromHash()));
  useEffect(() => {
    const onChange = () => {
      const asked = routeFromHash();
      const shown = resolveRoute(asked);
      if (shown !== asked) window.location.replace(`#/${shown}`);
      setRoute(shown);
    };
    onChange();
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return <AppShell route={route} />;
}
