# Feature candidate — computed portfolio / bucket risk level

| | |
|---|---|
| **Status** | Candidate. Not scoped, not committed to a version |
| **Raised** | 2026-07-30, by the product owner, while ratifying `RiskLevel` for V1.0 |
| **Roadmap position** | Partially sketched: `EXECUTION-PLAN.md` §"Out of scope" names **V1.2 — risk/classification axes**, sequenced in RFC-0010 §3. The computed *level* itself is named nowhere |
| **Blocked by** | The return/volatility series, which `EXECUTION-PLAN.md` places at **V1.3** (`valuation/return series, drawdown/vol/sharpe`) |
| **Authority** | None. This file records a candidate and a dependency; it decides nothing and amends no RFC |

---

## 1. The two concepts, which are not the same thing

**Declared strategy risk profile — exists, V1.0.** `RiskProfile.level`
(`core/strategy/strategy.py:53`) is a value the user declares in `strategy.yaml` alongside free-text
principles (RFC-0004 §2.1). It is an input. Nothing computes it, and V1.0 must not imply otherwise —
it is expressed *on* the KIID/PRIIPs 1–7 ordinal scale, borrowed, not derived.

**Computed portfolio / bucket risk level — this candidate.** A level *derived from what is actually
held*, per portfolio and per bucket. It is an output, and it is the thing that makes the declared
profile falsifiable: without it, the system can report drift against target weights but cannot report
that the holdings are riskier than the declared appetite.

Keeping them separate matters for the same reason apportionment and targets are separate: one is the
declaration the system restates (Manifest P3), the other is arithmetic the system performs against it.
Collapsing them would let a computed number silently overwrite a user declaration.

## 2. The dependency, which the roadmap does not currently record

An SRI-like level is **volatility-derived** — the PRIIPs market-risk measure is built from a return
series. The roadmap places `risk/classification axes` at V1.2 but the `valuation/return series` and
`drawdown/vol/sharpe` at V1.3. **So a computed level of the regulatory kind cannot land at V1.2 as
sequenced.** Either the sequence moves or the V1.2 measure is not volatility-based.

Two shapes, and they are genuinely different features:

| | Weights-based proxy | Volatility-derived |
|---|---|---|
| Input | Asset-class weights × per-class risk coefficients | Portfolio return series |
| Earliest version | V1.2 as sequenced — the classification axes are the input | V1.3, after the return series exists |
| Honest claim | "risk posture implied by the declared classification" | "measured market risk over the observed window" |
| Failure mode | A coefficient table nobody has ratified becomes load-bearing | Needs price history the ingestion layer may not have for every instrument |

The weights-based proxy is the cheaper one and fits the existing sequence. It is also the one that
must **not** be labelled with the regulatory acronyms, because it is not that measure.

## 3. Open decisions, none of them owed yet

1. Which of the two shapes above, or both as separate features in separate versions.
2. Whether the computed level is reported per portfolio, per bucket, or both. Buckets are where
   apportionment already lives, so per-bucket is the cheaper join; per-portfolio is what a user asks for.
3. Whether a divergence between declared and computed level becomes a **finding kind** with a
   severity, or stays a displayed pair the user interprets. A finding kind would need a severity
   declaration in the ADR-L02 algebra and a threshold nobody has proposed.
4. If it becomes a finding: whether naming a *computed* risk level as evidence stays inside I-12's
   prohibition on prescription. Reporting "the holdings measure 6 against a declared 4" is a
   statement of arithmetic; recommending a change of instrument to close it is not.

## 4. What V1.0 must not do in the meantime

- Do not name any field, docstring, ADR line or UI string in a way that implies
  `RiskProfile.level` was derived per KIID/PRIIPs. It is owner-declared, on a borrowed scale.
- Do not add a computed risk column to any V1.0 view. There is no return series to compute it from,
  and a placeholder that later becomes real is how an unverified number acquires authority.
