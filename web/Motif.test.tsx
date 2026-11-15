import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Motif, type MotifKind } from "./Motif.tsx";
import { Cell } from "./overview/cells.tsx";
import { Card } from "./setup/ui.tsx";

const kinds: MotifKind[] = ["target", "allocation", "comparison", "coverage", "entries", "copy"];
const render = (node: React.ReactNode) => renderToStaticMarkup(node);

describe("section motifs", () => {
  it("renders every supported kind as decorative artwork using palette tokens", () => {
    for (const kind of kinds) {
      const markup = render(<Motif kind={kind} />);
      expect(markup).toContain(`data-motif="${kind}"`);
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toMatch(/(?:fill|stroke)="var\(--(?:slot[245]|ink)\)"/);
    }
  });

  it("adds a Card motif only when explicitly requested and keeps its heading controls linked", () => {
    const plain = render(<Card title="Goals">Content</Card>);
    expect(plain).not.toContain("data-motif=");

    const marked = render(
      <Card title="Goals" motif="target">
        Content
      </Card>,
    );
    expect(marked).toContain('data-motif="target"');
    const titleId = /<span id="([^"]+)">Goals<\/span>/.exec(marked)?.[1];
    const bodyId = /<div class="card-body" id="([^"]+)"/.exec(marked)?.[1];
    expect(titleId).toBeDefined();
    expect(bodyId).toBeDefined();
    expect(marked).toContain(`aria-labelledby="${titleId}"`);
    expect(marked).toContain(`aria-controls="${bodyId}"`);
    expect(marked).toContain(`aria-expanded="true"`);
  });

  it("lets Cell opt into a motif without assigning one from its title", () => {
    const plain = render(
      <Cell id="goals" title="Goals">
        Rows
      </Cell>,
    );
    expect(plain).not.toContain("data-motif=");

    const marked = render(
      <Cell id="goals" title="Goals" motif="entries">
        Rows
      </Cell>,
    );
    expect(marked).toContain('data-motif="entries"');
  });
});
