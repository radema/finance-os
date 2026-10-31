import { useEffect, useState } from "react";
import { AppShell } from "./AppShell.tsx";
import { DEFAULT_ROUTE } from "./nav.ts";

const routeFromHash = (): string =>
  window.location.hash.replace(/^#\/?/, "").split("?")[0] || DEFAULT_ROUTE;

export function App() {
  const [route, setRoute] = useState(routeFromHash);
  useEffect(() => {
    const onChange = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return <AppShell route={route} />;
}
