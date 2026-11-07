import { useRef, useState } from "react";
import { ASSET_CLASSES } from "../../engine/assetClasses.ts";
import type { Product, ProductInput } from "../../engine/schemas.ts";
import { PRICE_SOURCES, REGIMES } from "../../engine/schemas.ts";
import { api, useLoad } from "../api.ts";
import { copyOfProduct } from "../duplicate.ts";
import { checkFields, type Rule } from "../formErrors.ts";
import { fractionToPercent, percentToFraction } from "../forms.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { hashParams } from "../hashQuery.ts";
import { formatPercent } from "../money.ts";
import { RowActions, useRowEditor } from "../rowEditor.tsx";
import { useFormErrors } from "../useFormErrors.ts";
import { regimeFields, regimeHint, resetHiddenFields } from "./regime.ts";
import {
  Alert,
  Card,
  CheckField,
  NumberField,
  ProductTag,
  RequiredLegend,
  Resource,
  SelectField,
  TextField,
} from "./ui.tsx";

const REGIME_LABEL: Record<string, string> = {
  etf: "ETF",
  direct: "Direct",
  govt: "Government bond",
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

const LABELS = {
  name: "Name",
  expReturn: "Expected return",
  volatility: "Volatility",
  ter: "TER",
  whiteListShare: "White-list share",
  couponRate: "Coupon rate",
  maturity: "Maturity",
};

const RULES: Record<
  "name" | "expReturn" | "volatility" | "ter" | "whiteListShare" | "couponRate",
  Rule
> = {
  name: "text",
  expReturn: "number",
  volatility: "number",
  ter: "number",
  whiteListShare: "number",
  couponRate: "number",
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
  const { errors, alert, reject, fail, clear } = useFormErrors<keyof typeof LABELS>(LABELS);
  const editor = useRowEditor<Product>({
    load: (p, isCopy) => setForm(toForm(isCopy ? copyOfProduct(p) : p)),
    clear,
  });
  const { editing, copying } = editor;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm({ ...form, [key]: value });
    clear(key as keyof typeof LABELS);
  };
  const setRegime = (regime: string) => setForm(resetHiddenFields({ ...form, regime }));
  const shown = regimeFields(form.regime);
  const suggested = regimeHint(form.assetClass, form.regime);
  const regimeSelect = useRef<HTMLSelectElement>(null);

  const reset = () => {
    setForm(EMPTY);
    editor.stop();
  };
  const save = async () => {
    const problems = checkFields(form, RULES, LABELS);
    if (Object.keys(problems).length > 0) return reject(problems);
    try {
      const body = toInput(form);
      if (editing) await api("PUT", "/api/products", { body: { id: editing.id, ...body } });
      else await api("POST", "/api/products", { body });
      clear();
      reset();
      products.reload();
    } catch (failure) {
      fail(failure);
    }
  };
  const remove = async (id: string) => {
    try {
      await api("DELETE", "/api/products", { query: { id } });
      clear();
      if (editing?.id === id) reset();
      products.reload();
    } catch (failure) {
      fail(failure);
    }
  };

  return (
    <>
      <Card title={editing ? "Edit product" : "Add product"}>
        <RequiredLegend />
        <form
          ref={editor.formRef}
          className="product-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h3 className="form-section">Identity</h3>
          <div className="form-grid">
            <TextField
              label="Name"
              value={form.name}
              onChange={(v) => set("name", v)}
              error={errors.name}
              required
            />
            <TextField
              label={<TermPopover term="isin">ISIN</TermPopover>}
              value={form.isin}
              onChange={(v) => set("isin", v)}
            />
            <TextField label="Ticker" value={form.ticker} onChange={(v) => set("ticker", v)} />
            <SelectField
              label="Asset class"
              value={form.assetClass}
              onChange={(v) => set("assetClass", v)}
              options={options(ASSET_CLASSES)}
            />
          </div>
          <h3 className="form-section">Tax and price</h3>
          <div className="form-grid">
            <SelectField
              label="Tax regime"
              value={form.regime}
              onChange={setRegime}
              options={options(REGIMES, REGIME_LABEL)}
              wrap="div"
              selectRef={regimeSelect}
              hint={
                suggested ? (
                  <>
                    Usually {REGIME_LABEL[suggested]} for this class.{" "}
                    <button
                      className="link-button"
                      type="button"
                      onClick={() => {
                        setRegime(suggested);
                        regimeSelect.current?.focus();
                      }}
                    >
                      Use it
                    </button>
                  </>
                ) : undefined
              }
            />
            <SelectField
              label="Price source"
              value={form.priceSource}
              onChange={(v) => set("priceSource", v)}
              options={options(PRICE_SOURCES)}
            />
            {shown.whiteListShare ? (
              <NumberField
                label={
                  <>
                    <TermPopover term="whitelist">White-list share</TermPopover> (%)
                  </>
                }
                value={form.whiteListShare}
                onChange={(v) => set("whiteListShare", v)}
                error={errors.whiteListShare}
                hint="The part in government bonds, taxed at the lower rate."
              />
            ) : null}
            {shown.couponRate ? (
              <NumberField
                label={
                  <>
                    <TermPopover term="coupon">Coupon</TermPopover> rate (% a year)
                  </>
                }
                value={form.couponRate}
                onChange={(v) => set("couponRate", v)}
                error={errors.couponRate}
              />
            ) : null}
            {shown.maturity ? (
              <TextField
                label="Maturity"
                value={form.maturity}
                onChange={(v) => set("maturity", v)}
                error={errors.maturity}
                hint="YYYY-MM, or empty."
              />
            ) : null}
          </div>
          <h3 className="form-section">Expected numbers</h3>
          <div className="form-grid">
            <NumberField
              label="Expected return (% a year)"
              value={form.expReturn}
              onChange={(v) => set("expReturn", v)}
              error={errors.expReturn}
              required
            />
            <NumberField
              label="Volatility (% a year)"
              value={form.volatility}
              onChange={(v) => set("volatility", v)}
              error={errors.volatility}
              required
            />
            <NumberField
              label="TER (% a year)"
              value={form.ter}
              onChange={(v) => set("ter", v)}
              error={errors.ter}
              required
            />
            <CheckField
              label="Zero commission"
              checked={form.zeroCommission}
              onChange={(v) => set("zeroCommission", v)}
            />
          </div>
          <div className="actions">
            <button className="btn btn-primary" type="submit">
              {editing ? "Save product" : "Add product"}
            </button>
            {editing || copying ? (
              <button className="btn btn-quiet" type="button" onClick={reset}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
        <Alert message={alert} />
      </Card>

      <Card title="Products">
        <Resource loaded={products}>
          {(list) =>
            list.length === 0 ? (
              <p className="note">No products yet. Add the first one above.</p>
            ) : (
              <div className="table-scroll table-scroll-sticky">
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
                        <RowActions
                          row={p}
                          editor={editor}
                          noun="product"
                          onDelete={() => void remove(p.id)}
                        />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Resource>
      </Card>
    </>
  );
}
