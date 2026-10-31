import { useState } from "react";
import { ASSET_CLASSES } from "../../engine/assetClasses.ts";
import type { Product, ProductInput } from "../../engine/schemas.ts";
import { PRICE_SOURCES, REGIMES } from "../../engine/schemas.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { fractionToPercent, percentToFraction } from "../forms.ts";
import { hashParams } from "../hashQuery.ts";
import { formatPercent } from "../money.ts";
import {
  Alert,
  Card,
  CheckField,
  ConfirmButton,
  NumberField,
  ProductTag,
  Resource,
  SelectField,
  TextField,
} from "./ui.tsx";

const REGIME_LABEL: Record<string, string> = {
  etf: "ETF (26%, white-list share)",
  direct: "Direct (26%)",
  govt: "Government bond (12.5%)",
  cash: "Cash (interest taxed yearly)",
  pension: "Pension fund",
};

interface Form {
  name: string;
  isin: string;
  assetClass: string;
  regime: string;
  whiteListShare: string;
  expReturn: string;
  volatility: string;
  ter: string;
  maturity: string;
  couponRate: string;
  zeroCommission: boolean;
  priceSource: string;
  ticker: string;
}

const EMPTY: Form = {
  name: "",
  isin: "",
  assetClass: ASSET_CLASSES[0],
  regime: "etf",
  whiteListShare: "0",
  expReturn: "",
  volatility: "",
  ter: "",
  maturity: "",
  couponRate: "0",
  zeroCommission: false,
  priceSource: "manual",
  ticker: "",
};

const toForm = (p: Product): Form => ({
  name: p.name,
  isin: p.isin,
  assetClass: p.assetClass,
  regime: p.regime,
  whiteListShare: fractionToPercent(p.whiteListShare),
  expReturn: fractionToPercent(p.expReturn),
  volatility: fractionToPercent(p.volatility),
  ter: fractionToPercent(p.ter),
  maturity: p.maturity ?? "",
  couponRate: fractionToPercent(p.couponRate),
  zeroCommission: p.zeroCommission,
  priceSource: p.priceSource,
  ticker: p.ticker,
});

// Bad numbers go to the server as null and come back as an error that names the field.
const toInput = (f: Form): ProductInput => ({
  name: f.name,
  isin: f.isin,
  assetClass: f.assetClass as ProductInput["assetClass"],
  regime: f.regime as ProductInput["regime"],
  whiteListShare: percentToFraction(f.whiteListShare),
  expReturn: percentToFraction(f.expReturn),
  volatility: percentToFraction(f.volatility),
  ter: percentToFraction(f.ter),
  maturity: f.maturity.trim() === "" ? null : f.maturity.trim(),
  couponRate: percentToFraction(f.couponRate),
  zeroCommission: f.zeroCommission,
  priceSource: f.priceSource as ProductInput["priceSource"],
  ticker: f.ticker,
});

const options = (values: readonly string[], labels: Record<string, string> = {}) =>
  values.map((value) => ({ value, label: labels[value] ?? value }));

export function ProductsTab() {
  const products = useLoad<Product[]>("/api/products");
  // The Import screen links here with the name and identifier of a product it did not find.
  const [form, setForm] = useState<Form>(() => {
    const params = hashParams();
    return {
      ...EMPTY,
      name: params.get("name") ?? "",
      isin: params.get("isin") ?? "",
      ticker: params.get("ticker") ?? "",
    };
  });
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState<string>();
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });

  const reset = () => {
    setForm(EMPTY);
    setEditing(undefined);
  };
  const save = async () => {
    try {
      const body = toInput(form);
      if (editing) await api("PUT", "/api/products", { body: { id: editing, ...body } });
      else await api("POST", "/api/products", { body });
      setError(undefined);
      reset();
      products.reload();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };
  const remove = async (id: string) => {
    try {
      await api("DELETE", "/api/products", { query: { id } });
      setError(undefined);
      if (editing === id) reset();
      products.reload();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  return (
    <>
      <Card title={editing ? "Edit product" : "Add product"}>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <TextField label="Name" value={form.name} onChange={(v) => set("name", v)} />
          <TextField label="ISIN" value={form.isin} onChange={(v) => set("isin", v)} />
          <TextField label="Ticker" value={form.ticker} onChange={(v) => set("ticker", v)} />
          <SelectField
            label="Asset class"
            value={form.assetClass}
            onChange={(v) => set("assetClass", v)}
            options={options(ASSET_CLASSES)}
          />
          <SelectField
            label="Tax regime"
            value={form.regime}
            onChange={(v) => set("regime", v)}
            options={options(REGIMES, REGIME_LABEL)}
          />
          <SelectField
            label="Price source"
            value={form.priceSource}
            onChange={(v) => set("priceSource", v)}
            options={options(PRICE_SOURCES)}
          />
          <NumberField
            label="Expected return (% a year)"
            value={form.expReturn}
            onChange={(v) => set("expReturn", v)}
          />
          <NumberField
            label="Volatility (% a year)"
            value={form.volatility}
            onChange={(v) => set("volatility", v)}
          />
          <NumberField label="TER (% a year)" value={form.ter} onChange={(v) => set("ter", v)} />
          <NumberField
            label="White-list share (%)"
            value={form.whiteListShare}
            onChange={(v) => set("whiteListShare", v)}
            hint="ETFs only: the part in government bonds taxed at 12.5%."
          />
          <NumberField
            label="Coupon rate (% a year)"
            value={form.couponRate}
            onChange={(v) => set("couponRate", v)}
            hint="Government bonds only."
          />
          <TextField
            label="Maturity"
            value={form.maturity}
            onChange={(v) => set("maturity", v)}
            hint="YYYY-MM, or empty."
          />
          <CheckField
            label="Zero commission"
            checked={form.zeroCommission}
            onChange={(v) => set("zeroCommission", v)}
          />
          <div className="actions">
            <button className="btn btn-primary" type="submit">
              {editing ? "Save product" : "Add product"}
            </button>
            {editing ? (
              <button className="btn btn-quiet" type="button" onClick={reset}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
        <Alert message={error} />
      </Card>

      <Card title="Products">
        <Resource loaded={products}>
          {(list) =>
            list.length === 0 ? (
              <p className="note">No products yet. Add the first one above.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Regime</th>
                    <th>Asset class</th>
                    <th className="num">Return</th>
                    <th className="num">Volatility</th>
                    <th className="num">TER</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.name}
                        {p.isin ? <span className="sub"> {p.isin}</span> : null}
                      </td>
                      <td>
                        <ProductTag regime={p.regime} />
                      </td>
                      <td>{p.assetClass}</td>
                      <td className="num">{formatPercent(p.expReturn)}</td>
                      <td className="num">{formatPercent(p.volatility)}</td>
                      <td className="num">{formatPercent(p.ter)}</td>
                      <td className="row-actions">
                        <button
                          className="btn btn-quiet"
                          type="button"
                          onClick={() => {
                            setEditing(p.id);
                            setForm(toForm(p));
                            setError(undefined);
                          }}
                        >
                          Edit
                        </button>
                        <ConfirmButton
                          label="Delete"
                          confirmLabel="Delete product"
                          onConfirm={() => void remove(p.id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Resource>
      </Card>
    </>
  );
}
