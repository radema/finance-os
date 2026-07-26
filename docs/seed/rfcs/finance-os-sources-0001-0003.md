# Finance OS — Source Documents (RFC-0001 / 0002 / 0003)

> **Status:** Authoritative, frozen input.
> **Ownership:** Product/domain track (separate agent). Not owned by the technical RFC track (0004–0010).
> **Language:** Original Italian, preserved verbatim. The Ubiquitous Language is normative in this form.
> **Version:** 0.1 (all three documents)
> **Role:** Single reference for RFC-0004–0010. Technical RFCs build on this content and do not restate it.

**Split path (if separated into `docs/rfc/`):**

| Section | Target file |
|---|---|
| Part I — Product Vision | `RFC-0001-product-vision.md` |
| Part II — Manifest | `RFC-0002-manifest.md` |
| Part III — Domain Specification | `RFC-0003-domain-principles.md` |

---
---

# Part I — Product Vision

# Finance OS
## Product Vision

Version: 0.1

---

# Vision

Finance OS è un sistema operativo personale per la gestione della propria vita finanziaria.

Non nasce per tracciare spese.

Non nasce per monitorare investimenti.

Nasce per aiutare una persona a prendere decisioni finanziarie migliori.

L'applicazione rappresenta il punto unico di verità della situazione economica, patrimoniale e strategica dell'utente.

---

# Mission

Trasformare dati finanziari dispersi in conoscenza e decisioni.

---

# Problemi che vogliamo risolvere

Oggi le informazioni sono distribuite tra:

- Home Banking
- Excel / Google Sheets
- Portfolio Performance
- Broker
- Documentazione personale
- Conoscenze dell'utente

Nessuno di questi strumenti conosce la strategia finanziaria dell'utente.

Finance OS vuole diventare il layer che collega tutto.

---

# Cosa NON è

Finance OS non è:

- un software di trading
- un robo advisor
- un software fiscale
- un'app bancaria
- un sistema di market timing

---

# Cosa è

Finance OS è un Decision Support System.

L'obiettivo è rispondere a domande come:

- Come sta andando il mese?
- Sto rispettando la mia strategia?
- Quanto è cambiato il mio patrimonio?
- Cosa dovrei fare oggi?
- Cosa succederà nei prossimi mesi?
- Quali rischi sto assumendo?

---

# Pilastri

## Cash Flow

Gestione delle entrate e delle uscite.

## Net Worth

Gestione del patrimonio.

## Strategy

Definizione delle strategie finanziarie.

## Knowledge

Conoscenza finanziaria collegata alle strategie.

## Decision Engine

Generazione di suggerimenti.

---

# Principi

- Local First
- Privacy First
- Explainable
- Decision First
- Modular
- Extensible

---

# Utente ideale

Persona che investe in autonomia.

Non cerca consigli.

Vuole strumenti per prendere decisioni migliori.

---

# Roadmap

V1

- Cash Flow
- Portfolio
- Dashboard
- Strategy

V2

- Rule Engine
- Forecast
- Planning

V3

- Knowledge Base
- AI Assistant

---
---

# Part II — Manifest

# Finance OS Manifest

Version: 0.1

---

# Filosofia

Le applicazioni finanziarie mostrano ciò che è successo.

Finance OS vuole spiegare cosa significa.

---

# Principio 1

I dati non sono il prodotto.

Le decisioni sono il prodotto.

---

# Principio 2

La strategia è un oggetto di primo livello.

Non è una configurazione.

Non è una percentuale.

È una rappresentazione del modo in cui una persona investe.

---

# Principio 3

Ogni suggerimento deve essere spiegabile.

Il sistema non deve dire

"Compra ETF X"

ma

"Secondo la tua strategia, l'allocazione è fuori target del 6%."

---

# Principio 4

Le strategie sono indipendenti dagli strumenti finanziari.

ETF, BTP, fondi...

sono implementazioni.

La strategia è permanente.

Gli strumenti possono cambiare.

---

# Principio 5

Ogni dato deve poter produrre conoscenza.

Una transazione produce:

- statistiche
- forecasting
- alert

Una posizione produce:

- allocazione
- rischio
- drift

---

# Principio 6

L'applicazione non sostituisce il giudizio umano.

Supporta il processo decisionale.

---

# Principio 7

Ogni decisione deve poter essere ricostruita.

Il sistema deve essere trasparente.

---

# Principio 8

Il dominio è più importante della tecnologia.

Database e framework cambieranno.

Il dominio rimarrà.

---

# Visione futura

Finance OS dovrà poter diventare un assistente personale finanziario.

L'AI non prenderà decisioni.

Userà il dominio esistente.

---
---

# Part III — Domain Specification

# Finance OS
## Domain Specification

Version: 0.1

---

# Bounded Context

Il sistema è suddiviso in moduli indipendenti.

- Cash Flow
- Portfolio
- Strategy
- Market
- Reporting
- Forecast
- Tax
- Knowledge

---

# Entità

## Account

Rappresenta un contenitore di liquidità.

Esempi:

- Conto corrente
- Conto trading
- Carta
- PayPal

---

## Transaction

Movimento economico.

Attributi

- data
- importo
- categoria
- sottocategoria
- descrizione
- conto

---

## Category

Classificazione delle transazioni.

Supporta gerarchie.

---

## Portfolio

Insieme di asset.

---

## Asset

Strumento finanziario.

Esempi

- ETF
- BTP
- Conto deposito
- Liquidità

---

## Holding

Quantità posseduta di un Asset.

---

## Operation

Evento che modifica una Holding.

Tipologie

- Buy
- Sell
- Dividend
- Coupon
- Transfer

---

## Bucket

Contenitore logico.

Esempi

- Emergenza
- Figli
- Pensione
- Personale

Un Bucket contiene Holdings virtuali.

---

## Strategy

Entità principale.

Attributi

- nome
- descrizione
- obiettivo
- orizzonte
- rischio
- principi
- target allocation
- tolleranze

Relazioni

Una Strategy

- governa Bucket
- contiene Rule
- osserva Market Indicator

---

## Goal

Obiettivo.

Può essere economico o strategico.

---

## Rule

Una regola composta da

Condizione

↓

Valutazione

↓

Messaggio

↓

Priorità

↓

Suggerimento

---

## Market Indicator

Indicatore esterno.

Esempi

- Credit Spread
- Yield
- Inflation
- CAPE
- VIX

---

## Snapshot

Fotografia dello stato del sistema.

Utilizzata per:

- reporting
- serie storiche
- forecast

---

## Alert

Evento generato da una Rule.

---

## Recommendation

Suggerimento prodotto dal sistema.

Sempre motivato.

Mai prescrittivo.

---

# Domain Services

Portfolio Engine

Calcola

- allocazione
- performance
- patrimonio

---

Cash Flow Engine

Calcola

- run rate
- forecast
- spese

---

Rule Engine

Valuta le regole.

---

Market Engine

Aggiorna gli indicatori.

---

Reporting Engine

Produce dashboard e grafici.

---

Forecast Engine

Genera simulazioni.

---

Tax Engine

Stima impatto fiscale.

---

Knowledge Engine

Gestisce documentazione e conoscenza.

---

# Invarianti

Una Holding appartiene ad un solo Asset.

Un Asset può appartenere a più Bucket.

Un Bucket è governato da una Strategy.

Una Strategy contiene almeno una Rule.

Ogni Recommendation deriva da una Rule.

Ogni Alert è spiegabile.

Nessun motore modifica direttamente il database.

Tutte le modifiche passano attraverso il dominio.

---

# Linguaggio Ubiquo

Asset

Bucket

Holding

Strategy

Goal

Rule

Recommendation

Alert

Snapshot

Market Indicator

Operation

Decision

---
---

# Appendix — Open items flagged by the technical track

These are **not** edits to the sources. They are ambiguities the technical RFCs must resolve, recorded here for traceability.

1. **"Decision Engine" is not a Domain Service.** It appears in the Vision pillars but is absent from the eight named Domain Services (Portfolio, Cash Flow, Rule, Market, Reporting, Forecast, Tax, Knowledge). RFC-0008 must state whether it is a ninth engine or a composition over the Rule Engine.
2. **Bucket ↔ Holding apportionment is underspecified.** "Un Bucket contiene Holdings virtuali" plus the invariants "Una Holding appartiene ad un solo Asset" and "Un Asset può appartenere a più Bucket" do not define the split model (quantity-based, weight-based, or a distinct virtual-holding entity). RFC-0004 must pick one.
3. **`Decision` is in the Ubiquitous Language but has no entity definition.** Only `Alert` and `Recommendation` are defined. Principio 7 binds on "decisione", so RFC-0004/0009 must define what a `Decision` is as a persisted artifact.
4. **Roadmap conflict.** The Vision places Rule Engine in V2, but Manifest Principio 3 (explainability) and the Strategy pillar in V1 are not satisfiable without rule evaluation. RFC-0010 must reconcile this — likely by pulling a minimal Rule Engine into V1.
