"""Synthetic fixtures only; never read the personal source or live database."""
from decimal import Decimal as D
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

from portfolio_performance import (BASELINE, BOND_NOMINAL, Converter, SourceError, XML,
                                   convert, moving_trade, security_identity)


def child(parent, tag, text=None, **attrs):
    node = ET.SubElement(parent, tag, attrs)
    if text is not None:
        node.text = str(text)
    return node


class Fixture:
    def __init__(self, isin='TEST', regime='etf', ticker='TEST.MI'):
        self.root = ET.Element('client')
        securities = child(self.root, 'securities')
        self.security = child(securities, 'security')
        for tag, value in [('uuid', 'security-1'), ('name', 'Test product'), ('isin', isin), ('tickerSymbol', ticker)]:
            child(self.security, tag, value)
        self.portfolios = child(self.root, 'portfolios')
        self.accounts = child(self.root, 'accounts')
        self.export = {'tables': {'product': [dict(id='product-1', name='Test product', isin=isin, regime=regime)],
                                 'goal': [dict(id=n, name=n) for n in ['Children', 'Emergency fund', 'Long-Term', 'MIP', 'Support for parents', 'Retirement']]}}
        self.portfolio = self.entity(self.portfolios, 'portfolio', 'Degiro/Fineco', 'portfolio-1')
        self.account = self.entity(self.accounts, 'account', 'Degiro/Fineco Cash', 'account-1')
        self.sequence = 0

    def entity(self, parent, tag, name, uid):
        entity = child(parent, tag)
        child(entity, 'uuid', uid)
        child(entity, 'name', name)
        child(entity, 'transactions')
        return entity

    def tx(self, entity, date, kind, amount, qty=0, fee=0, tax=0):
        self.sequence += 1
        tx = child(entity.find('transactions'), 'portfolio-transaction' if entity.tag == 'portfolio' else 'account-transaction')
        for tag, value in [('uuid', f'tx-{self.sequence}'), ('date', date + ('T00:00' if len(date) == 10 else '')), ('type', kind), ('currencyCode', 'EUR'), ('amount', int(D(str(amount)) * 100)), ('shares', int(D(str(qty)) * 100000000))]:
            child(tx, tag, value)
        if qty:
            child(tx, 'security', reference='/client/securities/security')
        if fee or tax:
            units = child(tx, 'units')
            for kind, value in [('FEE', fee), ('TAX', tax)]:
                if value:
                    child(child(units, 'unit', type=kind), 'amount', currency='EUR', amount=str(int(D(str(value)) * 100)))
        return tx

    def run(self, as_of='2026-11-08'):
        converter = Converter(self.root, self.export, as_of)
        converter.run()
        return converter


class ResolverTests(unittest.TestCase):
    def test_relative_indexed_reference_and_uuid_dedup(self):
        root = ET.fromstring('<client><securities><security><uuid>one</uuid></security><security><uuid>two</uuid></security></securities><portfolios><portfolio><uuid>p</uuid><transactions><t><uuid>t1</uuid></t><t reference="../t"/></transactions></portfolio><portfolio reference="../portfolio"/></portfolios><ref reference="../securities/security[2]"/></client>')
        xml = XML(root)
        self.assertEqual(xml.text(xml.resolve(root.find('ref')), 'uuid'), 'two')
        self.assertEqual(len(list(xml.entities('portfolios'))), 1)
        self.assertEqual(len(list(xml.transactions(root.find('portfolios/portfolio')))), 1)

    def test_cycle_and_invalid_reference_fail(self):
        for text in ['<r><a reference="."/></r>', '<r><a reference="../missing[2]"/></r>']:
            root = ET.fromstring(text)
            with self.assertRaises(SourceError):
                XML(root).resolve(root[0])

    def test_security_aliases(self):
        for fragment, expected in [('<tickerSymbol>30IA.MI</tickerSymbol>', 'IE000Y2BJVK9'), ('<name>BTP-23GN31 IT SI CUM</name>', 'IT0005713539'), ('<isin>IT0005672016</isin>', 'IT0005672024')]:
            self.assertEqual(security_identity(ET.fromstring('<security>' + fragment + '</security>')), expected)


class ConversionTests(unittest.TestCase):
    def test_baseline_moving_cost_and_net_settlement(self):
        f = Fixture()
        f.tx(f.account, '2025-01-01', 'DEPOSIT', 1000)
        f.tx(f.portfolio, '2025-01-02', 'BUY', 202, 2, fee=2)
        f.tx(f.portfolio, '2025-03-02', 'BUY', 404, 2, fee=4)
        f.tx(f.portfolio, '2025-04-02', 'SELL', 199, 1, fee=1)
        f.tx(f.portfolio, '2026-01-02', 'SELL', 196, 1, fee=2, tax=2)
        c = f.run()
        opening = c.rows['openings'][0]
        self.assertEqual(opening['qty'], D(3))
        self.assertEqual(opening['pmc'], D('151.5'))
        self.assertEqual(c.open_cash['Long-Term'], D(593))
        self.assertEqual(c.cash['Long-Term'], D(789))
        self.assertEqual(c.rows['transactions'][0]['price'], D(200))
        self.assertEqual(c.rows['transactions'][0]['commission'], D(2))
        self.assertEqual(c.rows['cash-movements'][0]['type'], 'tax')
        self.assertEqual(c.rows['cash-movements'][0]['amount'], D(2))

    def test_opening_earmarks_share_weighted_account_pmc_preserving_total_cost(self):
        for regime, isin, scale in [('etf', 'TEST', 1), ('govt', 'IT0005672024', 100)]:
            with self.subTest(regime=regime):
                f = Fixture(isin, regime)
                p2 = f.entity(f.portfolios, 'portfolio', 'Pietro', 'p2')
                f.tx(f.portfolio, '2025-01-01', 'BUY', 200, 2)
                f.tx(p2, '2025-02-01', 'BUY', 200, 1)
                c = f.run()
                rows = c.rows['openings']
                self.assertEqual(len({r['pmc'] for r in rows}), 1)
                quote_divisor = D(100) if regime == 'govt' else D(1)
                imported_cost = sum(r['qty'] * r['pmc'] / quote_divisor for r in rows)
                self.assertEqual(imported_cost.quantize(D('.01')), D('400.00'))
                self.assertEqual(c.open_positions[('Long-Term', 'product-1')], (D(2 * scale), D(200)))
                self.assertEqual(c.open_positions[('Children', 'product-1')], (D(scale), D(200)))
                self.assertEqual(c.audit['openingCostNormalization'][0]['sourceBookCost'], '400')

    def test_linked_account_legs_and_duplicate_security_do_not_double_count(self):
        f = Fixture()
        f.tx(f.account, '2025-01-01', 'DEPOSIT', 100)
        buy = f.tx(f.portfolio, '2025-01-02', 'BUY', 22, 2, fee=2)
        # XStream can put the definition on either side of a crossEntry.
        account_buy = f.tx(f.account, '2025-01-02', 'BUY', 22)
        child(child(account_buy, 'crossEntry'), 'portfolioTransaction', reference='/client/portfolios/portfolio/transactions/portfolio-transaction')
        child(child(buy, 'crossEntry'), 'accountTransaction', reference='/client/accounts/account/transactions/account-transaction[2]')
        duplicate = child(f.root.find('securities'), 'security')
        child(duplicate, 'uuid', 'duplicate-security')
        child(duplicate, 'isin', 'TEST')
        child(duplicate, 'name', 'Retired duplicate')
        second = f.tx(f.portfolio, '2025-01-03', 'BUY', 10, 1)
        second.find('security').set('reference', '/client/securities/security[2]')
        # Duplicate reference and duplicate UUID are both deduplicated.
        child(f.portfolio.find('transactions'), 'portfolio-transaction', reference='../portfolio-transaction')
        c = f.run()
        self.assertEqual(c.positions[('Long-Term', 'product-1')], (D(3), D(32)))
        self.assertEqual(c.cash['Long-Term'], D(68))
        self.assertEqual(len(c.rows['openings']), 1)

    def test_all_four_bond_lot_scales_and_price_units(self):
        for isin, scale in BOND_NOMINAL.items():
            with self.subTest(isin=isin):
                f = Fixture(isin, 'govt')
                price = D(scale) * D('0.985')
                child(child(f.security, 'prices'), 'price', t='2026-10-01', v=str(int(price * 100000000)))
                f.tx(f.account, '2025-01-01', 'DEPOSIT', 10000)
                f.tx(f.portfolio, '2025-01-02', 'BUY', price * 2, 2)
                c = f.run()
                self.assertEqual(c.rows['openings'][0]['qty'], D(scale * 2))
                self.assertEqual(c.rows['openings'][0]['pmc'], D('98.5'))
                self.assertEqual(c.rows['prices'][0]['price'], D('98.5'))

    def test_children_aggregation_and_internal_cash_security_transfers(self):
        f = Fixture()
        f.portfolio.find('name').text = 'Pietro'
        f.account.find('name').text = 'Fondo Pietro'
        target_p = f.entity(f.portfolios, 'portfolio', 'Figli', 'p2')
        target_a = f.entity(f.accounts, 'account', 'Fondo Figli', 'a2')
        # Cash remains fungible after aggregation, even when the individual source has a deficit.
        f.tx(target_a, '2025-01-01', 'DEPOSIT', 100)
        f.tx(f.portfolio, '2025-01-02', 'BUY', 80, 1)
        t = f.tx(f.portfolio, '2026-01-02', 'TRANSFER_OUT', 80, 1)
        child(child(t, 'crossEntry'), 'portfolioTo', reference='/client/portfolios/portfolio[2]')
        t = f.tx(target_p, '2026-01-02', 'TRANSFER_IN', 80, 1)
        child(child(t, 'crossEntry'), 'portfolioFrom', reference='/client/portfolios/portfolio')
        t = f.tx(f.account, '2026-01-03', 'TRANSFER_OUT', 10)
        child(child(t, 'crossEntry'), 'accountTo', reference='/client/accounts/account[2]')
        t = f.tx(target_a, '2026-01-03', 'TRANSFER_IN', 10)
        child(child(t, 'crossEntry'), 'accountFrom', reference='/client/accounts/account')
        c = f.run()
        self.assertEqual(c.positions[('Children', 'product-1')], (D(1), D(80)))
        self.assertEqual(c.cash['Children'], D(20))
        self.assertEqual(c.rows['transactions'], [])
        self.assertEqual(c.rows['cash-movements'], [])

    def test_cross_goal_transfer_preserves_cost(self):
        f = Fixture()
        p2 = f.entity(f.portfolios, 'portfolio', 'Pietro', 'p2')
        f.tx(f.portfolio, '2024-01-01', 'BUY', 102, 2, fee=2)
        t = f.tx(f.portfolio, '2025-01-01', 'TRANSFER_OUT', 60, 1)
        child(child(t, 'crossEntry'), 'portfolioTo', reference='/client/portfolios/portfolio[2]')
        t = f.tx(p2, '2025-01-01', 'TRANSFER_IN', 60, 1)
        child(child(t, 'crossEntry'), 'portfolioFrom', reference='/client/portfolios/portfolio')
        c = f.run()
        self.assertEqual(c.positions[('Children', 'product-1')], (D(1), D(51)))
        self.assertEqual(c.positions[('Long-Term', 'product-1')], (D(1), D(51)))

    def test_mip_funding_is_exact_and_total_cash_neutral(self):
        f = Fixture('IE0008UEVOE0', ticker='IVOA.MI')
        f.tx(f.account, '2025-01-01', 'DEPOSIT', 200)
        # Intentionally put a same-date deposit after the buy in the XML.
        f.tx(f.portfolio, '2026-01-02', 'BUY', 102, 2, fee=2)
        f.tx(f.account, '2026-01-02', 'DEPOSIT', 100)
        c = f.run()
        funding = [r for r in c.rows['cash-movements'] if r['type'] == 'transfer'][0]
        self.assertEqual((funding['bucket'], funding['toBucket'], funding['amount']), ('Long-Term', 'MIP', D(102)))
        self.assertEqual(c.cash['MIP'], D(0))
        self.assertEqual(sum(c.cash.values()) - D('6.42'), D(198))

    def test_baseline_correction_never_becomes_contribution(self):
        f = Fixture()
        f.account.find('name').text = 'Fondo Emergenza (cash)'
        f.tx(f.account, BASELINE, 'DEPOSIT', '.98')
        c = f.run()
        self.assertEqual(c.open_cash['Emergency fund'], D('7.40'))
        self.assertEqual(c.rows['cash-movements'], [])

    def test_same_day_time_order_and_unknown_types(self):
        f = Fixture()
        f.tx(f.portfolio, '2025-01-01T19:01', 'BUY', 100, 1)
        f.tx(f.portfolio, '2025-01-01T19:28', 'SELL', 101, 1)
        self.assertEqual(f.run().positions[('Long-Term', 'product-1')][0], 0)
        f.tx(f.account, '2026-01-01', 'UNKNOWN', 1)
        with self.assertRaisesRegex(SourceError, 'Unknown account transaction type'):
            f.run()

    def test_default_date_uses_source_price_and_retirement_is_excluded(self):
        f = Fixture()
        child(child(f.security, 'prices'), 'price', t='2026-11-06', v='100000000')
        f.tx(f.portfolio, '2026-01-01', 'BUY', 10, 1)
        retirement = f.entity(f.accounts, 'account', 'FPA Allianz Insieme', 'retired')
        f.tx(retirement, '2026-11-08', 'UNKNOWN', 999)
        c = Converter(f.root, f.export)
        c.run()
        self.assertEqual(c.as_of, '2026-11-06')
        self.assertNotIn('Retirement', c.cash)
        self.assertEqual(c.audit['coverage'], {'lastTransaction': '2026-01-01', 'lastPrice': '2026-11-06'})

    def test_files_deterministic_and_no_live_db(self):
        f = Fixture()
        f.tx(f.account, BASELINE, 'DEPOSIT', 100)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ET.ElementTree(f.root).write(root / 'source.xml')
            (root / 'export.json').write_text(json.dumps(f.export))
            first = convert(root / 'source.xml', root / 'export.json', root / 'out')
            second = convert(root / 'source.xml', root / 'export.json', root / 'out')
            self.assertEqual(first, second)
            self.assertEqual(len(first['files']), 6)
            self.assertTrue((root / 'out' / 'reconciliation.json').exists())
            self.assertEqual(first['preserveGoals'], ['Retirement'])


if __name__ == '__main__':
    unittest.main()
