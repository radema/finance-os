/** One glossary entry: the Italian term, the English name shown in the UI and a plain explanation. */
export interface GlossaryTerm {
  it: string;
  en: string;
  explanation: string;
}

/**
 * The only source of jargon text: the Glossary screen and every popover read from here. The wording
 * starts from the prototype (`.scratch/gbi-v1/prototypes/11-ui/content.js`); the user rewrites it later.
 */
export const GLOSSARY = {
  prob: {
    en: "probability of success",
    it: "Probabilità di successo",
    explanation:
      "How often the goal reaches its target when the plan is run through 1,000 simulated markets, after tax and costs. 84% means 840 of the 1,000 runs got there.",
  },
  required: {
    en: "required probability",
    it: "Probabilità richiesta",
    explanation:
      "The bar you set for a goal. Need goals start at 90%, Want at 75%, Wish at 50%. You can change it per goal.",
  },
  simulated: {
    en: "simulated markets",
    it: "Mercati simulati (Monte Carlo)",
    explanation:
      "The same plan run 1,000 times with random but realistic market moves. The same seed gives the same result every time.",
  },
  badcase: {
    en: "bad case",
    it: "Scenario sfavorevole",
    explanation: "In 1 simulated market out of 10 the result is this low or lower.",
  },
  typical: {
    en: "typical case",
    it: "Scenario mediano (mediana)",
    explanation: "Half of the simulated markets end above this value and half below.",
  },
  goodcase: {
    en: "good case",
    it: "Scenario favorevole",
    explanation: "In 1 simulated market out of 10 the result is this high or higher.",
  },
  nominal: {
    en: "future euros",
    it: "Euro correnti (valori nominali)",
    explanation:
      "Amounts in the money of that year. The target is raised by 2% inflation a year, so €250,000 today becomes about €500,000 in 2061.",
  },
  real: {
    en: "today’s euros",
    it: "Euro di oggi (valori reali)",
    explanation: "Amounts adjusted for 2% yearly inflation, so €1 means what €1 buys today.",
  },
  twr: {
    en: "time-weighted return",
    it: "Rendimento ponderato per il tempo (TWR)",
    explanation:
      "The return of the investments alone. It ignores when you added or took out money. Use it to judge the products.",
  },
  xirr: {
    en: "money-weighted return",
    it: "Rendimento ponderato per il capitale (XIRR)",
    explanation:
      "Your own yearly return, counting when you put money in. Use it to judge your own results.",
  },
  drawdown: {
    en: "drawdown",
    it: "Drawdown (calo dal massimo)",
    explanation:
      "How far the value fell from its previous peak. It shows how deep a loss you sat through.",
  },
  pmc: {
    en: "average cost",
    it: "Prezzo medio di carico (PMC)",
    explanation:
      "The average price you paid per unit. One value per product, shared by all goals. Your broker computes it the same way.",
  },
  zainetto: {
    en: "tax-loss carry-forward",
    it: "Zainetto fiscale",
    explanation:
      "Past losses that can reduce the tax on later gains, for four years. They work on ETC, stock and bond gains, not on ETF gains.",
  },
  fire: {
    en: "financial independence (FIRE)",
    it: "Indipendenza finanziaria (FIRE)",
    explanation:
      "Having enough invested money that work no longer has to pay for your life. Here it has three levels, from a safety cushion to full independence.",
  },
  barista: {
    en: "Barista FIRE",
    it: "Barista FIRE",
    explanation:
      "Enough capital to cover essential expenses (300 × your monthly essentials), so work only has to pay for the extras.",
  },
  opening: {
    en: "opening position",
    it: "Posizione iniziale",
    explanation:
      "What you already hold on the day you start. It sets the starting value and cost. It does not count as money you contributed.",
  },
  need: {
    en: "Need · Want · Wish",
    it: "Necessità · Desiderio · Aspirazione",
    explanation:
      "How much the goal matters. It sets the default required probability: Need 90%, Want 75%, Wish 50%.",
  },
  isin: {
    en: "ISIN",
    it: "Codice ISIN",
    explanation:
      "The 12-character code that identifies a security. Import files are matched by ISIN, not by name.",
  },
  coupon: {
    en: "coupon",
    it: "Stacco cedola",
    explanation:
      "Interest paid by a bond. It is cash received, not a change in units held. It is recorded as a coupon, and it counts in your returns but not as money you put in.",
  },
  stale: {
    en: "old price",
    it: "Prezzo non aggiornato",
    explanation:
      "A price that is out of date. An online price is old after 7 days; a typed or CSV price is old when the previous month-end price is missing. The value it feeds is shown, but may be off.",
  },
  minticket: {
    en: "minimum efficient ticket",
    it: "Biglietto minimo efficiente",
    explanation:
      "The broker’s minimum fee divided by its rate. Below this amount, the fee is a bigger share of the trade.",
  },
  bollo: {
    en: "stamp duty (bollo)",
    it: "Imposta di bollo",
    explanation:
      "A yearly tax of 0.2% on the value of your securities and your deposit account. The plan takes it from the value each year. Pension funds do not pay it.",
  },
  exitTax: {
    en: "exit tax",
    it: "Imposta sulla prestazione pensionistica",
    explanation:
      "The tax taken when the pension pot is paid out. The plan applies a rate to your contributions. The rate is 15%, minus 0.3 points for each year of membership beyond 15, never below 9%.",
  },
  whitelist: {
    en: "white-list share",
    it: "Quota titoli di Stato white list",
    explanation:
      "The part of an ETF that holds bonds of white-list governments. That part is taxed at 12.5% instead of 26%, so the ETF rate is 26% minus 13.5 points times the share.",
  },
} as const satisfies Record<string, GlossaryTerm>;

export type TermId = keyof typeof GLOSSARY;
