import type { ReactNode } from "react";
import { useLoad } from "../api.ts";
import { CURRENT_PORTFOLIO_ROUTE } from "../nav.ts";
import { SampleCard } from "../setup/SampleCard.tsx";
import { Card, Resource } from "../setup/ui.tsx";

/** The first-run state of the Overview, from `GET /api/setup-progress`. */
export interface SetupProgress {
  products: boolean;
  goals: boolean;
  openingPosition: boolean;
  /** True while the data folder is empty, so the sample loader cannot collide with real data. */
  sampleAvailable: boolean;
}

interface Step {
  label: string;
  href: string;
  done: boolean;
  /** Why the step is locked; undefined when it can be opened. */
  locked?: string;
}

const stepsOf = ({ products, goals, openingPosition }: SetupProgress): Step[] => [
  { label: "Add your products", href: "#/setup/products", done: products },
  { label: "Add your goals", href: "#/setup/goals", done: goals },
  {
    label: "Enter your current portfolio",
    href: `#/${CURRENT_PORTFOLIO_ROUTE}?tab=portfolio`,
    done: openingPosition,
    locked: products && goals ? undefined : "Add at least one product and one goal first.",
  },
];

/**
 * The Overview: a three-step checklist while setup is incomplete, "Load the sample data" while the
 * data folder is empty, and `done` (the dashboard slot) once every step is done.
 */
export function FirstRunChecklist({ done }: { done: ReactNode }) {
  const progress = useLoad<SetupProgress>("/api/setup-progress");
  return (
    <Resource loaded={progress}>
      {(state) => {
        const steps = stepsOf(state);
        if (steps.every((step) => step.done)) return done;
        return (
          <>
            <div className="tag">First run</div>
            <h1 className="title">Set up your planner</h1>
            <Card title="Three steps">
              <ol className="steps">
                {steps.map((step) => (
                  <li key={step.label}>
                    {step.locked && !step.done ? (
                      <span aria-disabled="true">
                        {step.label} <span className="sub">{step.locked}</span>
                      </span>
                    ) : (
                      <a href={step.href}>{step.label}</a>
                    )}{" "}
                    <span className="saved">
                      {step.done ? "Done" : step.locked ? "Locked" : "Open"}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
            {state.sampleAvailable ? <SampleCard onLoaded={progress.reload} /> : null}
          </>
        );
      }}
    </Resource>
  );
}
