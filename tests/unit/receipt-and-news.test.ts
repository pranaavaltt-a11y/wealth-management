import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractReceiptFields } from '../../src/lib/services/ocr-service';
import { classify, detectRateChange, parseRss } from '../../src/lib/services/news-service';

describe('receipt field extraction', () => {
  const pharmacy = [
    'APOLLO PHARMACY', 'Jayanagar 4th Block, Bengaluru', 'GSTIN: 29AABCA1234F1Z5', 'TAX INVOICE',
    'Date: 14/09/2026 Time: 18:42', 'Paracetamol 650 x2 64.00', 'Sub Total 429.50',
    'CGST 6% 12.89', 'Grand Total 455.28',
  ].join('\n');

  it('finds the merchant, skipping header noise', () => {
    assert.equal(extractReceiptFields(pharmacy).merchant, 'APOLLO PHARMACY');
  });
  it('takes Grand Total over Sub Total', () => {
    const f = extractReceiptFields(pharmacy);
    assert.equal(f.amount, 455.28);
    assert.equal(f.amountSource, 'total-line');
  });
  it('reads the date and the GSTIN', () => {
    const f = extractReceiptFields(pharmacy);
    assert.equal(f.date, '2026-09-14');
    assert.equal(f.gstin, '29AABCA1234F1Z5');
  });
  it('reads month-name dates', () => {
    assert.equal(extractReceiptFields('CAFE\n12 Aug 2026\nTotal 300').date, '2026-08-12');
  });
  it('does not mistake "Total items" for the amount', () => {
    const f = extractReceiptFields('SHOP\nTotal items 3\nNet Amount 1,250.00');
    assert.equal(f.amount, 1250);
  });
  it('falls back to the largest amount when there is no total line', () => {
    const f = extractReceiptFields('KIOSK\nTea 20.00\nSamosa 35.00');
    assert.equal(f.amount, 35);
    assert.equal(f.amountSource, 'largest-number');
  });
});

describe('news classification', () => {
  it('detects a repo hike with direction and size', () => {
    assert.deepEqual(detectRateChange('MPC raises repo rate by 25 basis points'), { type: 'repo', bps: 25 });
  });
  it('detects a cut as negative', () => {
    assert.deepEqual(detectRateChange('Repo rate cut by 50 bps'), { type: 'repo', bps: -50 });
  });
  it('returns null when no change is stated', () => {
    assert.equal(detectRateChange('Repo rate kept unchanged'), null);
  });
  it('categorises monetary policy as rates', () => {
    assert.equal(classify('Monetary Policy Statement').category, 'rates');
  });
  it('parses RSS items, unescaping entities and CDATA', () => {
    const items = parseRss('<rss><channel><item><title><![CDATA[A &amp; B]]></title><link>https://x.test/1</link>'
      + '<pubDate>Mon, 06 Oct 2026 10:00:00 GMT</pubDate><description>d</description></item></channel></rss>');
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'A & B');
  });
});
