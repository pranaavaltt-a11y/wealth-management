import PDFDocument from 'pdfkit';
import { join } from 'node:path';
import { findUserById } from '@/lib/db/users';
import { listAssets } from '@/lib/db/assets';
import { netWorthTrend } from '@/lib/db/networth';
import { netWorthSummary, loanPayoffProgress } from '@/lib/db/views';
import { creditScore, fyReport } from '@/lib/db/insights';
import { formatINR, formatDate, titleCase, financialYear } from '@/lib/format';

/**
 * Net worth statement as a PDF, generated server-side with pdfkit.
 *
 * Fonts are bundled (assets/fonts, DejaVu, freely redistributable) because the
 * fourteen standard PDF fonts have no glyph for ₹ (U+20B9) — without an
 * embedded font every amount would print as a missing-glyph box.
 */

const FONT_DIR = join(process.cwd(), 'assets', 'fonts');

// The light theme's palette, so the printout matches the app.
const C = {
  ink: '#3a3733', muted: '#6b655c', faint: '#948d82', line: '#e4ded2',
  accent: '#b0663a', positive: '#5f8449', negative: '#8e3c3c', paper: '#fbf9f5',
};

/** PAN is personal data: show only enough to recognise it. */
function maskPan(pan: string | null): string {
  return pan ? `${pan.slice(0, 3)}••••${pan.slice(7)}` : 'not provided';
}

interface Column { label: string; width: number; align?: 'left' | 'right'; mono?: boolean }

export async function buildStatementPdf(userId: number): Promise<Buffer> {
  const fy = financialYear();
  const fyStart = Number(fy.start.slice(0, 4));

  const [user, summary, assets, loans, trend, score, report] = await Promise.all([
    findUserById(userId),
    netWorthSummary(userId),
    listAssets(userId),
    loanPayoffProgress(userId),
    netWorthTrend(userId, 400),
    creditScore(userId),
    fyReport(userId, fyStart),
  ]);
  if (!user) throw new Error('User not found');

  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: {
    Title: `WealthWise net worth statement — ${user.name}`,
    Author: 'WealthWise',
    Subject: 'Personal net worth statement',
  } });
  doc.registerFont('sans', join(FONT_DIR, 'DejaVuSans.ttf'));
  doc.registerFont('bold', join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
  doc.registerFont('mono', join(FONT_DIR, 'DejaVuSansMono.ttf'));

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  const rule = (color = C.line) => {
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.6).strokeColor(color).stroke();
  };

  const heading = (text: string) => {
    if (doc.y > doc.page.height - 150) doc.addPage();
    doc.moveDown(1.1);
    doc.font('bold').fontSize(8.5).fillColor(C.faint).text(text.toUpperCase(), left, doc.y, { characterSpacing: 1.2 });
    doc.moveDown(0.35);
    rule();
    doc.moveDown(0.5);
  };

  /** A plain ruled table. Long tables break across pages and repeat the header. */
  const table = (cols: Column[], rows: string[][]) => {
    const drawHeader = () => {
      let x = left;
      doc.font('bold').fontSize(7.5).fillColor(C.faint);
      const y = doc.y;
      for (const c of cols) {
        doc.text(c.label.toUpperCase(), x, y, { width: c.width, align: c.align ?? 'left', characterSpacing: 0.6 });
        x += c.width;
      }
      doc.y = y + 13;
      rule(C.faint);
      doc.y += 4;
    };
    drawHeader();
    for (const r of rows) {
      if (doc.y > doc.page.height - 80) { doc.addPage(); drawHeader(); }
      let x = left;
      const y = doc.y;
      r.forEach((cell, i) => {
        const c = cols[i];
        doc.font(c.mono ? 'mono' : 'sans').fontSize(8.5).fillColor(C.ink)
           .text(cell, x, y, { width: c.width - 4, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
        x += c.width;
      });
      doc.y = y + 15;
      rule();
      doc.y += 4;
    }
  };

  // ------------------------------------------------------------ header
  doc.font('bold').fontSize(20).fillColor(C.accent).text('WealthWise', left, 48);
  doc.font('sans').fontSize(10).fillColor(C.muted).text('Net worth statement');
  doc.moveDown(0.8);
  doc.font('bold').fontSize(12).fillColor(C.ink).text(user.name);
  doc.font('sans').fontSize(8.5).fillColor(C.muted)
     .text(`${user.email}   ·   PAN ${maskPan(user.pan_number)}   ·   As of ${formatDate(new Date().toISOString())}`);

  // ----------------------------------------------------------- summary
  heading('Summary');
  const tiles: [string, number, string?][] = [
    ['Net worth', summary.netWorth, summary.netWorth >= 0 ? C.positive : C.negative],
    ['Total assets', summary.totalAssets],
    ['Outstanding debt', summary.totalLiabilities],
    ['Monthly EMIs', summary.monthlyEmiBurden],
  ];
  const tileW = width / tiles.length;
  const tileY = doc.y;
  tiles.forEach(([label, value, color], i) => {
    const x = left + i * tileW;
    doc.font('bold').fontSize(7).fillColor(C.faint).text(label.toUpperCase(), x, tileY, { width: tileW - 8, characterSpacing: 0.8 });
    doc.font('mono').fontSize(12.5).fillColor(color ?? C.ink)
       .text(formatINR(value, { compact: true }), x, tileY + 12, { width: tileW - 8 });
  });
  doc.y = tileY + 36;
  doc.font('sans').fontSize(8.5).fillColor(C.muted).text(
    `Liquid assets ${formatINR(summary.liquidAssets, { compact: true })}` +
    (summary.debtToAssetPct !== null ? `   ·   Debt is ${summary.debtToAssetPct.toFixed(1)}% of assets` : '') +
    (score ? `   ·   WealthWise score ${score.current.score} / 900` : ''),
    left, doc.y,
  );
  if (score) {
    doc.font('sans').fontSize(7).fillColor(C.faint)
       .text('The WealthWise score is derived from repayment records in this app. It is not a CIBIL, Experian or Equifax score.');
  }

  // ------------------------------------------------------------ assets
  heading(`Assets (${assets.length})`);
  table(
    [
      { label: 'Asset', width: width * 0.36 },
      { label: 'Class', width: width * 0.16 },
      { label: 'Invested', width: width * 0.16, align: 'right', mono: true },
      { label: 'Current', width: width * 0.16, align: 'right', mono: true },
      { label: 'Gain', width: width * 0.16, align: 'right', mono: true },
    ],
    assets.map((a) => [
      a.name, titleCase(a.assetType),
      formatINR(a.purchaseValue, { decimals: false }),
      formatINR(a.currentValue, { decimals: false }),
      `${a.gain >= 0 ? '+' : ''}${formatINR(a.gain, { decimals: false })}`,
    ]),
  );

  // ------------------------------------------------------- liabilities
  const active = loans.filter((l) => l.status === 'active');
  heading(`Liabilities (${active.length} active)`);
  if (active.length === 0) {
    doc.font('sans').fontSize(8.5).fillColor(C.muted).text('No active loans.');
  } else {
    table(
      [
        { label: 'Lender', width: width * 0.22 },
        { label: 'Type', width: width * 0.12 },
        { label: 'Rate', width: width * 0.1, align: 'right', mono: true },
        { label: 'Principal', width: width * 0.17, align: 'right', mono: true },
        { label: 'Outstanding', width: width * 0.17, align: 'right', mono: true },
        { label: 'Repaid', width: width * 0.1, align: 'right', mono: true },
        { label: 'Next due', width: width * 0.12, align: 'right' },
      ],
      active.map((l) => [
        l.lender, titleCase(l.loanType), `${l.interestRate.toFixed(2)}%`,
        formatINR(l.principal, { decimals: false }), formatINR(l.outstanding, { decimals: false }),
        `${l.principalProgressPct.toFixed(1)}%`, formatDate(l.nextDueDate),
      ]),
    );
  }

  // ------------------------------------------------------------- trend
  heading('Net worth — last 12 months');
  const monthly = trend.filter((p, i, all) =>
    i === all.length - 1 || p.snapshotDate.slice(0, 7) !== all[i + 1]?.snapshotDate.slice(0, 7)).slice(-12);
  table(
    [
      { label: 'Month', width: width * 0.25 },
      { label: 'Assets', width: width * 0.25, align: 'right', mono: true },
      { label: 'Liabilities', width: width * 0.25, align: 'right', mono: true },
      { label: 'Net worth', width: width * 0.25, align: 'right', mono: true },
    ],
    monthly.map((p) => [
      new Date(p.snapshotDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
      formatINR(p.totalAssets, { decimals: false }),
      formatINR(p.totalLiabilities, { decimals: false }),
      formatINR(p.netWorth, { decimals: false }),
    ]),
  );

  // ---------------------------------------------------------------- FY
  heading(`${report.label} to date (April – March)`);
  if (report.summary) {
    doc.font('sans').fontSize(9).fillColor(C.ink).text(
      `Income ${formatINR(report.summary.income)}   ·   Expenses ${formatINR(report.summary.expense)}` +
      (report.summary.savingsRatePct !== null ? `   ·   Savings rate ${report.summary.savingsRatePct}%` : ''),
    );
  }
  if (report.tax && (report.tax.sec24b || report.tax.sec80c || report.tax.sec80e)) {
    doc.moveDown(0.4);
    doc.font('sans').fontSize(8.5).fillColor(C.muted).text(
      `Indicative old-regime deductions from loan repayments — Sec 24(b) ${formatINR(report.tax.sec24b, { decimals: false })}, ` +
      `Sec 80C ${formatINR(report.tax.sec80c, { decimals: false })} (limit shared with EPF/PPF/ELSS), ` +
      `Sec 80E ${formatINR(report.tax.sec80e, { decimals: false })}. Not tax advice.`,
    );
  }

  // ------------------------------------------------------------ footer
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    // pdfkit starts a new page whenever text is written below the bottom
    // margin, and the footer deliberately sits inside that margin. Without
    // lifting it, every footer spawned an extra blank page (6 pages, not 2).
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 34;
    doc.font('sans').fontSize(7).fillColor(C.faint).text(
      `Generated by WealthWise on ${new Date().toLocaleString('en-IN')}. Values are as recorded by the user; ` +
      'no bank, bureau or market data was accessed.',
      left, y, { width: width - 60, lineBreak: false },
    );
    doc.text(`${i + 1} / ${pages.count}`, left + width - 50, y, { width: 50, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return done;
}
