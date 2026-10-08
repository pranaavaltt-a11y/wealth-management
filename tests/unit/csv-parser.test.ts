import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseDate, parseAmount, findHeader, importHash, normaliseStatement } from '../../src/lib/services/csv-parser';

describe('CSV reader (RFC 4180)', () => {
  it('keeps commas inside quoted fields', () => {
    assert.deepEqual(parseCsv('a,"b, c",d\n'), [['a', 'b, c', 'd']]);
  });
  it('unescapes doubled quotes', () => {
    assert.deepEqual(parseCsv('"say ""hi""",x'), [['say "hi"', 'x']]);
  });
  it('handles CRLF line endings and drops blank lines', () => {
    assert.deepEqual(parseCsv('a,b\r\n\r\nc,d\r\n'), [['a', 'b'], ['c', 'd']]);
  });
});

describe('date parsing', () => {
  it('reads day-first Indian dates', () => assert.equal(parseDate('05/03/2026'), '2026-03-05'));
  it('expands two-digit years', () => assert.equal(parseDate('01/08/26'), '2026-08-01'));
  it('accepts ISO dates', () => assert.equal(parseDate('2026-08-02'), '2026-08-02'));
  it('rejects 31 February instead of rolling into March', () => assert.equal(parseDate('31/02/26'), null));
  it('rejects garbage', () => assert.equal(parseDate('not a date'), null));
});

describe('amount parsing', () => {
  it('strips Indian digit grouping', () => assert.equal(parseAmount('"1,65,000.00"'.replace(/"/g, '')), 165000));
  it('strips the rupee sign and CR/DR suffixes', () => assert.equal(parseAmount('₹ 2,500.50 Dr'), 2500.5));
  it('treats a dash as empty', () => assert.equal(parseAmount('-'), null));
});

describe('header detection', () => {
  it('skips bank preamble lines and maps columns by alias', () => {
    const rows = parseCsv('HDFC BANK\nStatement\n\nDate,Narration,Withdrawal Amt.,Deposit Amt.\n01/08/26,X,10,\n');
    const h = findHeader(rows);
    assert.equal(h?.index, 2);
    assert.equal(h?.map.debit, 2);
    assert.equal(h?.map.credit, 3);
  });
});

describe('statement normalisation', () => {
  const csv = [
    'Transaction Date,Transaction Remarks,Debit,Credit',
    '2026-08-02,NETFLIX,649.00,',
    '2026-08-10,INTEREST CREDIT,,412.00',
    '2026-08-02,NETFLIX,649.00,',
    '31/02/2026,BAD DATE,10,',
  ].join('\n');
  const r = normaliseStatement(csv);

  it('classifies debits as expense and credits as income', () => {
    assert.equal(r.rows[0].txnType, 'expense');
    assert.equal(r.rows[1].txnType, 'income');
  });
  it('drops a duplicate row within the same file', () => {
    assert.equal(r.rows.length, 2);
    assert.ok(r.skipped.some((s) => s.reason.includes('Duplicate')));
  });
  it('skips an invalid date with a reason', () => {
    assert.ok(r.skipped.some((s) => s.reason.includes('date')));
  });
  it('produces a stable dedupe hash that ignores whitespace and case', () => {
    assert.equal(importHash('2026-08-02', 649, 'netflix  '), importHash('2026-08-02', 649, 'NETFLIX'));
    assert.notEqual(importHash('2026-08-02', 649, 'NETFLIX'), importHash('2026-08-03', 649, 'NETFLIX'));
  });
  it('refuses a file with no recognisable header', () => {
    assert.throws(() => normaliseStatement('foo,bar\n1,2\n'), /header row/);
  });
});
