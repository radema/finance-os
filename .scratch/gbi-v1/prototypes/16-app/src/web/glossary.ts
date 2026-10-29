/* Plain-language explanations, copied from prototype 11 (content.js). The user writes the final wording later (ticket 11). */
export const GLOSSARY: Record<string, [string, string, string]> = {
  "prob": [
    "probability of success",
    "Probabilità di successo",
    "How often the goal reaches its target when the plan is run through 1,000 simulated markets, after tax and costs. 84% means 840 of the 1,000 runs got there."
  ],
  "required": [
    "required probability",
    "Probabilità richiesta",
    "The bar you set for a goal. Need goals start at 90%, Want at 75%, Wish at 50%. You can change it per goal."
  ],
  "simulated": [
    "simulated markets",
    "Mercati simulati (Monte Carlo)",
    "The same plan run 1,000 times with random but realistic market moves. The same seed gives the same result every time."
  ],
  "badcase": [
    "bad case",
    "Scenario sfavorevole (10° percentile, P10)",
    "In 1 simulated market out of 10 the result is this low or lower."
  ],
  "typical": [
    "typical case",
    "Scenario mediano (mediana, P50)",
    "Half of the simulated markets end above this value and half below."
  ],
  "goodcase": [
    "good case",
    "Scenario favorevole (90° percentile, P90)",
    "In 1 simulated market out of 10 the result is this high or higher."
  ],
  "nominal": [
    "future euros",
    "Euro correnti (valori nominali)",
    "Amounts in the money of that year. The target is raised by 2% inflation a year, so €250,000 today becomes about €500,000 in 2061."
  ],
  "real": [
    "today’s euros",
    "Euro di oggi (valori reali)",
    "Amounts adjusted for 2% yearly inflation, so €1 means what €1 buys today."
  ],
  "twr": [
    "time-weighted return",
    "Rendimento ponderato per il tempo (TWR)",
    "The return of the investments alone. It ignores when you added or took out money. Use it to judge the products."
  ],
  "xirr": [
    "money-weighted return",
    "Rendimento ponderato per il capitale (XIRR)",
    "Your own yearly return, counting when you put money in. Use it to judge your own results."
  ],
  "drawdown": [
    "drawdown",
    "Drawdown (calo dal massimo)",
    "How far the value fell from its previous peak. It shows how deep a loss you sat through."
  ],
  "pmc": [
    "average cost",
    "Prezzo medio di carico (PMC)",
    "The average price you paid per unit. One value per product, shared by all goals. Your broker computes it the same way."
  ],
  "zainetto": [
    "tax-loss carry-forward",
    "Zainetto fiscale",
    "Past losses that can reduce the tax on later gains, for four years. They work on ETC, stock and bond gains, not on ETF gains."
  ],
  "fire": [
    "financial independence (FIRE)",
    "Indipendenza finanziaria (FIRE)",
    "Having enough invested money that work no longer has to pay for your life. Here it has three levels, from a safety cushion to full independence."
  ],
  "barista": [
    "Barista FIRE",
    "Barista FIRE",
    "Enough capital to cover essential expenses (300 × your monthly essentials), so work only has to pay for the extras."
  ],
  "opening": [
    "opening position",
    "Posizione iniziale",
    "What you already hold on the day you start. It sets the starting value and cost. It does not count as money you contributed."
  ],
  "need": [
    "Need · Want · Wish",
    "Necessità · Desiderio · Aspirazione",
    "How much the goal matters. It sets the default required probability: Need 90%, Want 75%, Wish 50%."
  ],
  "isin": [
    "ISIN",
    "Codice ISIN",
    "The 12-character code that identifies a security. Import files are matched by ISIN, not by name."
  ],
  "coupon": [
    "coupon",
    "Stacco cedola",
    "Interest paid by a bond. It is cash received, not a change in units held. It is recorded as a coupon, and it counts in your returns but not as money you put in."
  ],
  "stale": [
    "old price",
    "Prezzo non aggiornato",
    "A price older than 7 days. The value it feeds is shown, but may be off."
  ],
  "minticket": [
    "minimum efficient ticket",
    "Biglietto minimo efficiente",
    "The broker’s minimum fee divided by its rate (about €1,553 here). Below it, the fee is a bigger share of the trade."
  ]
};
