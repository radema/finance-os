# Preserve trade history while introducing explicit Bucket Cash

Issue #167 introduces a separate cash ledger rather than treating a buy as a contribution or
creating a configurable cash product. Migration 005 marks pre-existing trades for derived legacy
funding, preserving original financial records while modern operations require explicit cash.
Accounting edits leave legacy compatibility; this avoids silently extending inferred funding to
new decisions. Cash rows carry persistent entry order because same-day transfer chains must
replay identically after export and restore.
