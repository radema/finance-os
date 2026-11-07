import { SETUP_TABS } from "../nav.ts";

/** The Setup tab bar, shared by every Setup screen. `route` is the current tab's route key. */
export function SetupTabs({ route }: { route: string }) {
  return (
    <nav className="tabs" aria-label="Setup">
      {SETUP_TABS.map((tab) => (
        <a
          key={tab.key}
          className="tab"
          href={`#/${tab.key}`}
          aria-current={tab.key === route ? "page" : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
