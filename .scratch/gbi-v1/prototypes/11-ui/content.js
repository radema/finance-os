/* PROTOTYPE content: glossary, price dates, import sample. All amounts and ISIN rows are fabricated sample data. */
(function () {
  const G = window.GBI;

  /* Price freshness is NOT in the mock (its prices all end at the valuation month). Added here so the screens can show it:
     ETFs come from the online provider and are one trading day old; BTPs and pension unit values are typed by hand and were last updated on 30 Sep. */
  G.priceAsOf = { p1: '2026-10-30', p2: '2026-10-30', p3: '2026-10-30', p4: '2026-10-30', p5: '2026-10-30', p6: '2026-10-30', p7: '2026-10-30',
    p8: '2026-09-30', p9: '2026-10-27', p10: '2026-09-30', p11: '2026-09-30', p12: '2026-09-30', p13: '2026-09-30' };
  G.staleDays = 7;

  /* Second dump from the mock engine (same sampleState, node run of reference/mock-app.html): savings capacity per year with the planned
     contribution per goal (cashflow(st, 10)), and goal probability at each quarter end (the mock's retroSnapshots, but with 1,000 paths so
     the points are comparable). The last point of every trend is the live value in G.goals, as in the mock. */
  G.capacity = [{"y":2026,"capacity":20218,"planned":18020,"per":{"g1":2400,"g2":6000,"g3":2400,"g4":0,"g5":3000,"g6":4220}},{"y":2027,"capacity":23015,"planned":18274,"per":{"g1":2448,"g2":6120,"g3":2448,"g4":0,"g5":3060,"g6":4198}},{"y":2028,"capacity":23420,"planned":16037,"per":{"g1":0,"g2":6242,"g3":2497,"g4":0,"g5":3121,"g6":4176}},{"y":2029,"capacity":23834,"planned":16252,"per":{"g1":0,"g2":6367,"g3":2547,"g4":0,"g5":3184,"g6":4154}},{"y":2030,"capacity":24255,"planned":16471,"per":{"g1":0,"g2":6495,"g3":2598,"g4":0,"g5":3247,"g6":4131}},{"y":2031,"capacity":24686,"planned":16694,"per":{"g1":0,"g2":6624,"g3":2650,"g4":0,"g5":3312,"g6":4108}},{"y":2032,"capacity":25124,"planned":16922,"per":{"g1":0,"g2":6757,"g3":2703,"g4":0,"g5":3378,"g6":4084}},{"y":2033,"capacity":25572,"planned":10262,"per":{"g1":0,"g2":0,"g3":2757,"g4":0,"g5":3446,"g6":4059}},{"y":2034,"capacity":26028,"planned":10362,"per":{"g1":0,"g2":0,"g3":2812,"g4":0,"g5":3515,"g6":4035}},{"y":2035,"capacity":25494,"planned":10463,"per":{"g1":0,"g2":0,"g3":2868,"g4":0,"g5":3585,"g6":4009}}];
  G.snaps = {"dates":["2024-03-31","2024-06-30","2024-09-30","2024-12-31","2025-03-31","2025-06-30","2025-09-30","2025-12-31","2026-03-31","2026-06-30","2026-09-30"],"prob":{"g1":[0.149,1,1,1,1,1,1,1,1,1,1],"g2":[0.996,0.999,1,1,0.999,1,1,1,1,1,1],"g3":[0.949,0.953,0.956,0.958,0.946,0.956,0.955,0.958,0.948,0.958,0.958],"g4":[1,1,1,1,1,1,1,1,1,1,1],"g5":[0.803,0.806,0.819,0.828,0.813,0.826,0.828,0.83,0.831,0.846,0.852],"g6":[0.815,0.815,0.826,0.847,0.821,0.826,0.827,0.844,0.836,0.845,0.852]}};
  G.sourceLabel = { yahoo: 'Online (Yahoo)', manual: 'Typed by hand' };

  /* term key -> English name, Italian term, plain explanation, optional "why it matters" */
  G.glossary = {
    prob: ['probability of success', 'Probabilità di successo', 'How often the goal reaches its target when the plan is run through 1,000 simulated markets, after tax and costs. 84% means 840 of the 1,000 runs got there.'],
    required: ['required probability', 'Probabilità richiesta', 'The bar you set for a goal. Need goals start at 90%, Want at 75%, Wish at 50%. You can change it per goal.'],
    simulated: ['simulated markets', 'Mercati simulati (Monte Carlo)', 'The same plan run 1,000 times with random but realistic market moves. The same seed gives the same result every time.'],
    badcase: ['bad case', 'Scenario sfavorevole (10° percentile, P10)', 'In 1 simulated market out of 10 the result is this low or lower.'],
    typical: ['typical case', 'Scenario mediano (mediana, P50)', 'Half of the simulated markets end above this value and half below.'],
    goodcase: ['good case', 'Scenario favorevole (90° percentile, P90)', 'In 1 simulated market out of 10 the result is this high or higher.'],
    nominal: ['future euros', 'Euro correnti (valori nominali)', 'Amounts in the money of that year. The target is raised by 2% inflation a year, so €250,000 today becomes about €500,000 in 2061.'],
    real: ['today’s euros', 'Euro di oggi (valori reali)', 'Amounts adjusted for 2% yearly inflation, so €1 means what €1 buys today.'],
    twr: ['time-weighted return', 'Rendimento ponderato per il tempo (TWR)', 'The return of the investments alone. It ignores when you added or took out money. Use it to judge the products.'],
    xirr: ['money-weighted return', 'Rendimento ponderato per il capitale (XIRR)', 'Your own yearly return, counting when you put money in. Use it to judge your own results.'],
    drawdown: ['drawdown', 'Drawdown (calo dal massimo)', 'How far the value fell from its previous peak. It shows how deep a loss you sat through.'],
    pmc: ['average cost', 'Prezzo medio di carico (PMC)', 'The average price you paid per unit. One value per product, shared by all goals. Your broker computes it the same way.'],
    zainetto: ['tax-loss carry-forward', 'Zainetto fiscale', 'Past losses that can reduce the tax on later gains, for four years. They work on ETC, stock and bond gains, not on ETF gains.'],
    fire: ['financial independence (FIRE)', 'Indipendenza finanziaria (FIRE)', 'Having enough invested money that work no longer has to pay for your life. Here it has three levels, from a safety cushion to full independence.'],
    barista: ['Barista FIRE', 'Barista FIRE', 'Enough capital to cover essential expenses (300 × your monthly essentials), so work only has to pay for the extras.'],
    opening: ['opening position', 'Posizione iniziale', 'What you already hold on the day you start. It sets the starting value and cost. It does not count as money you contributed.'],
    need: ['Need · Want · Wish', 'Necessità · Desiderio · Aspirazione', 'How much the goal matters. It sets the default required probability: Need 90%, Want 75%, Wish 50%.'],
    isin: ['ISIN', 'Codice ISIN', 'The 12-character code that identifies a security. Import files are matched by ISIN, not by name.'],
    coupon: ['coupon', 'Stacco cedola', 'Interest paid by a bond. It is cash received, not a change in units held. It is recorded as a coupon, and it counts in your returns but not as money you put in.'],
    stale: ['old price', 'Prezzo non aggiornato', 'A price older than ' + G.staleDays + ' days. The value it feeds is shown, but may be off.'],
    minticket: ['minimum efficient ticket', 'Biglietto minimo efficiente', 'The broker’s minimum fee divided by its rate (about €1,553 here). Below it, the fee is a bigger share of the trade.']
  };

  /* Fineco-shaped sample (ticket 09 column names, dates as text DD/MM/YYYY, Segno A/V). Fabricated rows, nothing from real/. */
  G.importMeta = [
    ['Dossier n.: 0000000'],
    ['Intestazione Dossier: SAMPLE'],
    [''],
    ['RISULTATO RICERCA MOVIMENTI TITOLI dal 01/10/2026 al 31/10/2026'],
    ['']
  ];
  G.importHeader = ['Operazione', 'Data valuta', 'Descrizione', 'Titolo', 'Isin', 'Segno', 'Quantita', 'Divisa', 'Prezzo', 'Cambio', 'Controvalore', 'Commissioni amministrato'];
  G.importRows = [
    ['27/10/2026', '29/10/2026', 'Compravendita titoli', 'BTP VALORE IN 27OT31', 'IT0005735227', 'A', '10000', 'EUR', '100.00000', '1', '10000.00', '0.00'],
    ['27/10/2026', '29/10/2026', 'Compravendita titoli', 'ISH IBONDS DEC28', 'IE0008UEVOE0', 'V', '560', 'EUR', '5.35530', '1', '2999.57', '2.95'],
    ['15/10/2026', '19/10/2026', 'Compravendita titoli', 'XTR FTSE ALL-WORLD', 'IE000L6ZMMC4', 'A', '62', 'EUR', '12.58000', '1', '779.96', '0.00'],
    ['15/10/2026', '19/10/2026', 'Compravendita titoli', 'XTR MSCI WORLD VALUE', 'IE00BL25JM42', 'A', '25', 'EUR', '48.18000', '1', '1204.50', '2.95'],
    ['09/10/2026', '13/10/2026', 'Compravendita titoli', 'ISH CORE MSCI WORLD', 'IE00B4L5Y983', 'A', '12', 'EUR', '112.30000', '1', '1347.60', '2.95'],
    ['02/10/2026', '06/10/2026', 'Compravendita titoli', 'AMUNDI PHYSICAL GOLD', 'FR0013416716', 'A', '1', 'EUR', '237.90000', '1', '237.90', '2.95'],
    ['01/10/2026', '05/10/2026', 'Compravendita titoli', 'XTR EUR OVERNIGHT', 'LU0290358497', 'A', '13', 'EUR', '148.06000', '1', '1924.78', '0.00'],
    ['23/06/2026', '23/06/2026', 'Stacco Cedole', 'BTP ITALIA 23GN31', 'IT0005713539', '', '10000', 'EUR', '', '1', '187.50', '0.00']
  ];
  /* what the row check decides, in the same order as importRows */
  G.importVerdict = [
    { kind: 'dup', note: 'Same product, date and amount as a transaction you already have (27 Oct).' },
    { kind: 'dup', note: 'Same product, date and amount as a transaction you already have (27 Oct).' },
    { kind: 'bucket', note: 'This product is in 2 goals: Children bucket and Long-term investment.', options: ['g3', 'g5'] },
    { kind: 'ready', goalId: 'g2', note: 'Only one goal holds this product: Support for parents.' },
    { kind: 'unknown', note: 'No product with this ISIN yet. Add it first, then import the row.' },
    { kind: 'ready', goalId: 'g2', note: 'Only one goal holds this product: Support for parents.', warn: 'Fee €2.95 is 1.2% of €237.90, above your usual 0.19%.' },
    { kind: 'ready', goalId: 'g1', note: 'Only one goal holds this product: Emergency fund.' },
    { kind: 'coupon', note: 'Interest, not a purchase. Recorded as a coupon: cash received (net of tax), no change in units, shared by the goals that hold the bond.' }
  ];

  /* known securities for the onboarding ISIN lookup (mock products + one extra) */
  G.catalogue = G.products.filter(p => p.isin).map(p => ({ isin: p.isin, name: p.name, cls: p.cls, ticker: p.ticker }))
    .concat([{ isin: 'IE00B4L5Y983', name: 'IWDA (iShares Core MSCI World)', cls: 'Equity', ticker: 'IWDA.MI' }]);
})();
