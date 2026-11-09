#!/usr/bin/env python3
"""Local, deterministic Portfolio Performance XML migration; no database or network access."""
import argparse
import csv
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
import re
import uuid
import xml.etree.ElementTree as ET

D = Decimal
BASELINE = '2025-12-31'
LIMIT = '2026-11-08'
HISTORICAL = {
    'IE000GUOATN7': ('iBonds 2025', 'Corp bonds', 'etf'),
    'IT0005466351': ('BTP Futura', 'Govt bonds', 'govt'),
    'LU1645380442': ('UBS inflation', 'Govt bonds', 'etf'),
    'IE00BMVB5M21': ('LifeStrategy 40', 'Multi-asset', 'etf'),
}
ALIASES = {'IT0005672016': 'IT0005672024'}
# PP stores different bond lot sizes in this source; prices use the same lot.
BOND_NOMINAL = {'IT0005672024': 100, 'IT0005466351': 100, 'IT0005713539': 1000, 'IT0005735227': 1000}
COLUMNS = {
    'openings': ['asOf', 'product', 'bucket', 'qty', 'pmc'],
    'opening-cash': ['asOf', 'bucket', 'amount'],
    'transactions': ['sourceId', 'date', 'bucket', 'product', 'type', 'qty', 'price', 'commission', 'amount', 'note'],
    'cash-movements': ['sourceId', 'date', 'bucket', 'type', 'amount', 'toBucket', 'note'],
    'prices': ['date', 'product', 'price'],
    'products': ['id', 'name', 'isin', 'assetClass', 'regime', 'whiteListShare', 'expReturn', 'volatility', 'ter', 'maturity', 'couponRate', 'zeroCommission', 'priceSource', 'ticker'],
}


def plain(value):
    return format(value, 'f') if isinstance(value, D) else value


def rounded(value, places=6):
    return value.quantize(D(1).scaleb(-places), rounding=ROUND_HALF_UP)


class SourceError(ValueError):
    pass


class XML:
    """Resolve indexed XStream paths relative to the referring element itself."""
    def __init__(self, root):
        self.root = root
        self.parents = {child: parent for parent in root.iter() for child in parent}

    def resolve(self, node):
        seen = set()
        while node is not None and 'reference' in node.attrib:
            if node in seen:
                raise SourceError('Cyclic XStream reference')
            seen.add(node)
            path = node.attrib['reference']
            current = self.root if path.startswith('/') else node
            parts = path.strip('/').split('/')
            if path.startswith('/') and parts[0] == self.root.tag:
                parts = parts[1:]
            for part in parts:
                if part == '..':
                    current = self.parents.get(current)
                elif part != '.':
                    match = re.fullmatch(r'([^\[]+)(?:\[(\d+)\])?', part)
                    if current is None or not match:
                        raise SourceError(f'Invalid reference {path}')
                    children = [x for x in current if x.tag == match[1]]
                    index = int(match[2] or 1) - 1
                    if index < 0 or index >= len(children):
                        raise SourceError(f'Unresolved reference {path}')
                    current = children[index]
                if current is None:
                    raise SourceError(f'Unresolved reference {path}')
            node = current
        return node

    def text(self, node, tag, default=''):
        node = self.resolve(node)
        return node.findtext(tag, default) if node is not None else default

    def entities(self, container):
        seen = set()
        for ref in self.root.findall(container + '/*'):
            node = self.resolve(ref)
            key = self.text(node, 'uuid') or id(node)
            if key not in seen:
                seen.add(key)
                yield node

    def transactions(self, entity):
        seen = set()
        for ref in entity.findall('transactions/*'):
            node = self.resolve(ref)
            key = self.text(node, 'uuid')
            if not key:
                raise SourceError('Transaction lacks UUID')
            if key not in seen:
                seen.add(key)
                yield node


def source_bucket(name):
    name = name.strip().casefold()
    if any(x in name for x in ('allianz', 'fon.te', 'moneyfarm', 'cnp')) or name == 'bank':
        return None
    if name in ('figli', 'pietro', 'fondo figli', 'fondo pietro', 'fondo agnese'):
        return 'Children'
    if name in ('mamma', 'portafoglio mamma'):
        return 'Support for parents'
    if name in ('fondo emergenza', 'fondo emergenza (cash)'):
        return 'Emergency fund'
    if 'degiro' in name or 'fineco' in name:
        return 'Long-Term'
    raise SourceError(f'Unknown active account/portfolio: {name!r}')


def money(node, tag='amount'):
    return D(node.findtext(tag, '0')) / 100


def charges(node, kind):
    total = D(0)
    for unit in node.findall('units/unit'):
        if unit.get('type') == kind:
            amount = unit.find('amount')
            if amount is not None:
                if amount.get('currency', 'EUR') != 'EUR':
                    raise SourceError('Non-EUR fee/tax requires explicit FX handling')
                total += D(amount.get('amount', '0')) / 100
    return total


def security_identity(sec):
    isin = sec.findtext('isin', '')
    ticker = sec.findtext('tickerSymbol', '')
    if not isin and ticker == '30IA.MI':
        isin = 'IE000Y2BJVK9'
    if not isin and (ticker == 'BTP23GN31' or 'BTP23GN31' in sec.findtext('name', '').replace('-', '').replace(' ', '')):
        isin = 'IT0005713539'
    return ALIASES.get(isin, isin)


def product_id(isin):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'gbi:historical:' + isin))


def moving_trade(state, key, kind, qty, amount):
    """Acquisitions include fees; disposals release weighted average cost."""
    units, cost = state[key]
    if kind in ('BUY', 'DELIVERY_INBOUND'):
        state[key] = (units + qty, cost + amount)
    else:
        if qty > units + D('0.0000005'):
            raise SourceError(f'Negative holding for {key}: dispose {qty}, own {units}')
        remaining = units - qty
        state[key] = (remaining, cost * remaining / units if units else D(0))


class Converter:
    def __init__(self, root, export, as_of=None):
        self.xml = XML(root)
        self.export = export
        tables = export['tables']
        self.products = {p['isin']: p for p in tables['product'] if p.get('isin')}
        self.product_by_id = {p['id']: p for p in tables['product']}
        self.goals = {g['name']: g['id'] for g in tables['goal']}
        for short, full in {'Children': 'Children bucket', 'MIP': 'MIP OpenEconomics', 'Long-Term': 'Long-Term Investment'}.items():
            if full in self.goals:
                self.goals[short] = self.goals[full]
        self.rows = {key: [] for key in COLUMNS}
        self.warnings = []
        self.audit = {'aliases': [], 'excluded': [], 'internalTransfers': [], 'baselineCorrections': [], 'missingPrices': [], 'cashFundingTransfers': [], 'tradeSettlements': []}
        self.securities = {self.xml.text(s, 'uuid'): s for s in self.xml.entities('securities')}
        self.events = self.collect()
        dates = [e['date'] for e in self.events if e['date'] <= LIMIT]
        dates.extend(p.get('t', '') for s in self.securities.values() for p in list(s.findall('prices/price')) + list(s.findall('latest')) if BASELINE <= p.get('t', '') <= LIMIT)
        self.as_of = as_of or max(dates, default=BASELINE)
        if self.as_of < BASELINE or self.as_of > LIMIT:
            raise SourceError(f'as-of must be between {BASELINE} and {LIMIT}')
        self.positions = defaultdict(lambda: (D(0), D(0)))
        self.cash = defaultdict(D)
        self.open_positions = {}
        self.open_cash = {}
        self.used_products = set()
        self.transient_products = set()
        self._prepare_products()

    def collect(self):
        result, seen = [], set()
        for container in ('portfolios', 'accounts'):
            for entity in self.xml.entities(container):
                name = self.xml.text(entity, 'name')
                bucket = source_bucket(name)
                if bucket is None:
                    self.audit['excluded'].append(name)
                    continue
                if bucket not in self.goals:
                    raise SourceError(f'Missing app goal {bucket}')
                for tx in self.xml.transactions(entity):
                    uid = self.xml.text(tx, 'uuid')
                    if uid in seen:
                        continue
                    seen.add(uid)
                    date = self.xml.text(tx, 'date')[:10]
                    kind = self.xml.text(tx, 'type')
                    if not kind:
                        raise SourceError(f'Empty active transaction type {uid}')
                    if self.xml.text(tx, 'currencyCode', 'EUR') != 'EUR':
                        raise SourceError(f'Non-EUR transaction {uid}')
                    sec = self.xml.resolve(tx.find('security'))
                    result.append(dict(node=tx, uid=uid, date=date, kind=kind, bucket=bucket, name=name,
                                       portfolio=container == 'portfolios', sec=sec, timestamp=self.xml.text(tx, 'date'), order=len(result)))
        priority = {'DEPOSIT': 0, 'TRANSFER_IN': 1}
        return sorted(result, key=lambda e: (e['date'], priority.get(e['kind'], 2), e['timestamp'], e['order']))

    def _prepare_products(self):
        for isin, (name, asset, regime) in HISTORICAL.items():
            if isin not in self.products:
                p = dict(id=product_id(isin), name=name, isin=isin, asset_class=asset, regime=regime)
                self.products[isin] = p
                self.product_by_id[p['id']] = p
                self.rows['products'].append(dict(id=p['id'], name=name, isin=isin, assetClass=asset, regime=regime,
                    whiteListShare=100 if regime == 'govt' else 0, expReturn=0, volatility=0, ter=0,
                    maturity='', couponRate=0, zeroCommission='no', priceSource='csv', ticker=''))

    def product(self, sec):
        if sec is None:
            raise SourceError('Security transaction has no security')
        isin = security_identity(sec)
        if isin not in self.products:
            key = 'source:' + sec.findtext('uuid', '')
            p = dict(id=key, isin=isin, name=sec.findtext('name', ''), regime='etf')
            self.product_by_id[key] = p
            self.transient_products.add(key)
        else:
            p = self.products[isin]
        if sec.findtext('isin') in ALIASES:
            entry = {'sourceIsin': sec.findtext('isin'), 'appIsin': isin}
            if entry not in self.audit['aliases']:
                self.audit['aliases'].append(entry)
        self.used_products.add(p['id'])
        return p

    def bucket(self, event, p=None):
        bucket = event['bucket']
        if bucket == 'Long-Term' and p:
            isin = p['isin']
            ticker = event['sec'].findtext('tickerSymbol', '').upper()
            name = event['sec'].findtext('name', '').upper()
            if isin in ('IE000Y2BJVK9', 'IE0008UEVOE0') or 'IBONDS' in name and '2030' in name or ticker.startswith('IVOA'):
                bucket = 'MIP'
            if ticker.startswith('ALLW') and event['date'] == '2026-10-29' and event['kind'] == 'BUY' and event['node'].findtext('shares') == '5200000000':
                bucket = 'MIP'
        if bucket not in self.goals:
            raise SourceError(f'Missing app goal {bucket}')
        return self.goals[bucket]

    def cash_row(self, event, kind, amount, goal=None, target='', suffix='', note=''):
        if event['date'] > BASELINE and amount:
            self.rows['cash-movements'].append(dict(sourceId=event['uid'] + suffix, date=event['date'], bucket=goal or self.bucket(event),
                type=kind, amount=amount, toBucket=target, note=note or 'Portfolio Performance'))

    def transfer_target(self, event, destination):
        cross = self.xml.resolve(event['node'].find('crossEntry'))
        if cross is None:
            raise SourceError(f'Transfer lacks crossEntry: {event["uid"]}')
        target = self.xml.resolve(cross.find(destination))
        if target is None:
            raise SourceError(f'Transfer lacks {destination}: {event["uid"]}')
        bucket = source_bucket(self.xml.text(target, 'name'))
        return self.goals[bucket] if bucket else None

    def process_portfolio(self, e):
        kind = e['kind']
        if kind not in ('BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT', 'DELIVERY_INBOUND', 'DELIVERY_OUTBOUND'):
            raise SourceError(f'Unknown portfolio transaction type {kind}')
        p = self.product(e['sec'])
        goal = self.bucket(e, p)
        if e['date'] > BASELINE and p['id'] in self.transient_products:
            raise SourceError(f'Unmapped active security {p["name"]} / {p["isin"]}')
        qty = D(e['node'].findtext('shares', '0')) / D(100000000)
        bond = p['regime'] == 'govt'
        if bond and p['isin'] not in BOND_NOMINAL:
            raise SourceError(f'Unknown bond nominal lot scale {p["isin"]}')
        qty = rounded(qty * (BOND_NOMINAL[p['isin']] if bond else 1))
        key = (goal, p['id'])
        amount = money(e['node'])
        fee, tax = charges(e['node'], 'FEE'), charges(e['node'], 'TAX')
        if kind.startswith('TRANSFER_'):
            if kind == 'TRANSFER_IN':
                return
            target = self.transfer_target(e, 'portfolioTo')
            if target == goal:
                self.audit['internalTransfers'].append(e['uid'])
                return
            if not target:
                raise SourceError('Security transfer into excluded portfolio needs manual decision')
            units, cost = self.positions[key]
            moved_cost = cost * qty / units if units else D(0)
            moving_trade(self.positions, key, 'SELL', qty, D(0))
            moving_trade(self.positions, (target, p['id']), 'BUY', qty, moved_cost)
            if e['date'] > BASELINE:
                raise SourceError('Cross-goal security transfer after baseline unsupported; no synthetic buy/sell emitted')
            return
        moving_trade(self.positions, key, kind, qty, amount if kind in ('BUY', 'DELIVERY_INBOUND') else D(0))
        if kind.startswith('DELIVERY_'):
            if e['date'] > BASELINE:
                raise SourceError('Post-baseline delivery requires separate holdings adjustment contract')
            return
        gross = amount - fee - tax if kind == 'BUY' else amount + fee + tax
        if qty <= 0 or gross < 0:
            raise SourceError(f'Invalid settlement {e["uid"]}')
        price = gross / qty * (100 if bond else 1)
        account_goal = self.bucket(e)
        settlement = -(gross + fee + tax) if kind == 'BUY' else gross - fee - tax
        if goal != account_goal and settlement < 0:
            deficit = max(D(0), -settlement - self.cash[goal])
            if deficit:
                self.cash[account_goal] -= deficit
                self.cash[goal] += deficit
                self.cash_row(e, 'transfer', deficit, account_goal, goal, ':fund', 'Fund MIP purchase from shared DeGiro cash')
                self.audit['cashFundingTransfers'].append({'sourceId': e['uid'], 'date': e['date'], 'amount': plain(deficit)})
        self.cash[goal] += settlement
        if e['date'] > BASELINE:
            self.audit['tradeSettlements'].append(dict(sourceId=e['uid'], grossCents=int(gross * 100), feeCents=int(fee * 100), taxCents=int(tax * 100), settlementCents=int(settlement * 100)))
            self.rows['transactions'].append(dict(sourceId=e['uid'], date=e['date'], bucket=goal, product=p['id'],
                type=kind.lower(), qty=qty if kind == 'BUY' else -qty, price=rounded(price, 12), commission=fee, amount=gross, note='Portfolio Performance'))
            self.cash_row(e, 'tax', tax, goal, suffix=':tax')

    def process_account(self, e):
        kind, amount = e['kind'], money(e['node'])
        goal = self.bucket(e)
        if kind in ('BUY', 'SELL'):
            if self.xml.resolve(e['node'].find('crossEntry')) is None:
                raise SourceError(f'Unlinked account {kind}: {e["uid"]}')
            return
        if kind in ('TRANSFER_IN', 'TRANSFER_OUT'):
            if kind == 'TRANSFER_IN':
                source = self.transfer_target(e, 'accountFrom')
                if source is not None:
                    return
                self.cash[goal] += amount
                self.cash_row(e, 'contribution', amount, note='Transfer from excluded account')
                return
            target = self.transfer_target(e, 'accountTo')
            if target == goal:
                self.audit['internalTransfers'].append(e['uid'])
                return
            self.cash[goal] -= amount
            if target:
                self.cash[target] += amount
                self.cash_row(e, 'transfer', amount, goal, target)
            else:
                self.cash_row(e, 'withdrawal', amount, goal, note='Transfer to excluded account')
            return
        types = {'DEPOSIT': ('contribution', 1), 'REMOVAL': ('withdrawal', -1), 'FEES': ('fee', -1),
                 'TAXES': ('tax', -1), 'DIVIDENDS': ('income', 1), 'INTEREST': ('income', 1),
                 'FEES_REFUND': ('income', 1), 'TAX_REFUND': ('income', 1), 'INTEREST_CHARGE': ('fee', -1)}
        if kind not in types:
            raise SourceError(f'Unknown account transaction type {kind}')
        target_type, sign = types[kind]
        self.cash[goal] += sign * amount
        self.cash_row(e, target_type, amount, goal, note=f'Portfolio Performance {kind.lower()}')

    def snapshot(self):
        self.open_positions = dict(self.positions)
        self.open_cash = dict(self.cash)
        emergency = self.goals.get('Emergency fund')
        if emergency:
            correction = D('6.42')
            self.open_cash[emergency] = self.open_cash.get(emergency, D(0)) + correction
            self.cash[emergency] += correction
            self.audit['baselineCorrections'].append({'bucket': emergency, 'amount': '6.42', 'reason': 'Authorized baseline correction; not a contribution'})
        # The app has one fiscal account per product, shared across goal earmarks.
        # Preserve source per-goal costs in open_positions/audit while importing its
        # weighted account PMC in every earmark row.
        totals = defaultdict(lambda: (D(0), D(0)))
        source_pmcs = defaultdict(set)
        for (_, pid), (qty, cost) in self.open_positions.items():
            if qty:
                units, book_cost = totals[pid]
                totals[pid] = (units + qty, book_cost + cost)
                source_pmcs[pid].add(cost / qty)
        self.audit['openingCostNormalization'] = []
        for pid, (qty, cost) in sorted(totals.items()):
            if len(source_pmcs[pid]) > 1:
                divisor = D(100) if self.product_by_id[pid]['regime'] == 'govt' else D(1)
                self.audit['openingCostNormalization'].append(dict(product=pid, qty=plain(qty),
                    sourceBookCost=plain(cost), accountPmc=plain(rounded(cost / qty * divisor, 12)),
                    reason='One fiscal account PMC shared by all goal earmarks; source bucket costs retained in openingHoldings'))
        for (goal, pid), (qty, _) in sorted(self.open_positions.items()):
            if qty:
                if pid in self.transient_products:
                    raise SourceError(f'Unmapped opening security {self.product_by_id[pid]["name"]}')
                divisor = D(100) if self.product_by_id[pid]['regime'] == 'govt' else D(1)
                units, cost = totals[pid]
                self.rows['openings'].append(dict(asOf=BASELINE, product=pid, bucket=goal, qty=qty, pmc=rounded(cost / units * divisor, 12)))
        for goal, amount in sorted(self.open_cash.items()):
            self.rows['opening-cash'].append(dict(asOf=BASELINE, bucket=goal, amount=amount))

    def run(self):
        snapped = False
        for event in self.events:
            if event['date'] > self.as_of:
                break
            if event['date'] > BASELINE and not snapped:
                self.snapshot()
                snapped = True
            if event['portfolio']:
                self.process_portfolio(event)
            else:
                self.process_account(event)
        if not snapped:
            self.snapshot()
        self.extract_prices()
        negative = [{'bucket': goal, 'amount': plain(amt)} for goal, amt in self.cash.items() if amt < 0]
        if negative:
            self.warnings.append('Negative final goal cash requires reconciliation')
        self.audit['negativeCash'] = negative
        self.audit['openingHoldings'] = self.describe(self.open_positions)
        self.audit['finalHoldings'] = self.describe(self.positions)
        self.audit['openingCash'] = {g: plain(v) for g, v in sorted(self.open_cash.items())}
        self.audit['finalCash'] = {g: plain(v) for g, v in sorted(self.cash.items())}
        self.audit['warnings'] = self.warnings
        self.audit['coverage'] = {'lastTransaction': max((e['date'] for e in self.events if e['date'] <= self.as_of), default=None), 'lastPrice': max((p['date'] for p in self.rows['prices']), default=None)}
        return self.rows

    def describe(self, positions):
        return [dict(bucket=g, product=p, isin=self.product_by_id[p]['isin'], qty=plain(q), bookCost=plain(c))
                for (g, p), (q, c) in sorted(positions.items()) if q]

    def bond_units(self):
        result = []
        for sec in self.securities.values():
            isin = security_identity(sec)
            if isin not in BOND_NOMINAL:
                continue
            evidence = []
            for event in self.events:
                if event['portfolio'] and event['sec'] is sec and event['kind'] == 'BUY':
                    evidence.append(dict(sourceId=event['uid'], sourceShares=plain(D(event['node'].findtext('shares', '0')) / 100000000), settlementEur=plain(money(event['node']))))
            result.append(dict(sourceUuid=sec.findtext('uuid'), name=sec.findtext('name'), sourceIsin=sec.findtext('isin', ''), appIsin=isin, nominalPerSourceShare=BOND_NOMINAL[isin], quoteToPer100=plain(D(100) / BOND_NOMINAL[isin]), evidence=evidence))
        return result

    def extract_prices(self):
        points = {}
        for sec in self.securities.values():
            isin = security_identity(sec)
            if isin not in self.products:
                continue
            p = self.products[isin]
            if p['id'] not in self.used_products:
                continue
            candidates = list(sec.findall('prices/price'))
            latest = sec.find('latest')
            if latest is not None:
                candidates.append(latest)
            for price in candidates:
                date = price.get('t') or price.findtext('date', '')[:10]
                raw = price.get('v') or price.findtext('value')
                if not raw or not date or date > self.as_of:
                    continue
                value = D(raw) / D(100000000)
                if p['regime'] == 'govt':
                    if p['isin'] not in BOND_NOMINAL:
                        raise SourceError(f'Unknown bond nominal lot scale {p["isin"]}')
                    value *= D(100) / BOND_NOMINAL[p['isin']]
                if value <= 0:
                    continue
                key = (p['id'], date[:7])
                existing = points.get(key)
                if existing is None or date > existing['date']:
                    points[key] = dict(date=date, product=p['id'], price=value)
        self.rows['prices'] = sorted(points.values(), key=lambda p: (p['date'], p['product']))
        covered = {p['product'] for p in points.values()}
        self.audit['missingPrices'] = sorted(self.used_products - covered - self.transient_products)
        if self.audit['missingPrices']:
            self.warnings.append('Some source securities have no usable historical prices; preserve app prices')


def convert(source, app_export, output, as_of=None):
    source, app_export, output = Path(source), Path(app_export), Path(output)
    repository = Path(__file__).resolve().parents[1]
    if output.resolve().is_relative_to(repository):
        relative = output.resolve().relative_to(repository)
        ignored = repository.joinpath('.gitignore').read_text().splitlines()
        if not relative.parts or relative.parts[0] != 'personal-import' or not any(line.strip() in ('personal-import/', '/personal-import/') for line in ignored):
            raise SourceError('Personal outputs must be outside the repository or in ignored personal-import/')
    converter = Converter(ET.parse(source).getroot(), json.loads(app_export.read_text()), as_of)
    rows = converter.run()
    output.mkdir(parents=True, exist_ok=True)
    files = {}
    for name, columns in COLUMNS.items():
        path = output / (name + '.csv')
        with path.open('w', newline='', encoding='utf-8') as handle:
            writer = csv.DictWriter(handle, columns)
            writer.writeheader()
            writer.writerows({k: plain(v) for k, v in row.items()} for row in rows[name])
        files[path.name] = {'rows': len(rows[name]), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    manifest = dict(formatVersion=1, baseline=BASELINE, asOf=converter.as_of,
                    sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                    appExportSha256=hashlib.sha256(app_export.read_bytes()).hexdigest(),
                    files=files, bondNominalPerPpShare=BOND_NOMINAL, bondUnits=converter.bond_units(), tradeSettlements=converter.audit['tradeSettlements'], coverage=converter.audit['coverage'], productIds={p['isin']: p['id'] for p in converter.products.values()},
                    preserveGoals=[g['id'] for g in converter.export['tables']['goal'] if g['name'] == 'Retirement'], warnings=converter.warnings)
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (output / 'reconciliation.json').write_text(json.dumps(converter.audit, indent=2) + '\n')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--app-export', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--as-of', help=f'Default latest source transaction date, at most {LIMIT}')
    args = parser.parse_args()
    try:
        manifest = convert(args.source, args.app_export, args.output, args.as_of)
    except (SourceError, ValueError, KeyError, ET.ParseError) as error:
        parser.exit(1, f'Conversion blocked: {error}\n')
    print(json.dumps({'asOf': manifest['asOf'], 'files': manifest['files'], 'warnings': manifest['warnings']}, indent=2))


if __name__ == '__main__':
    main()
