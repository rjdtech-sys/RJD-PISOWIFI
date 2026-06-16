const fs = require('fs');
const path = require('node:path');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function safeText(v) {
  return String(v ?? '').trim();
}

function formatMoney(amount) {
  const n = Number(amount || 0);
  return `₱${n.toFixed(2)}`;
}

function formatNumber(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? String(n) : '0';
}

async function generatePPPoESaleReceiptPdf({ outputPath, receipt }) {
  ensureDir(path.dirname(outputPath));

  let PDFDocument;
  try {
    PDFDocument = require('pdfkit');
  } catch (e) {
    return null;
  }

  const r = receipt || {};

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const out = fs.createWriteStream(outputPath);
    out.on('finish', resolve);
    out.on('error', reject);
    doc.pipe(out);

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    let y = doc.page.margins.top;

    doc.fillColor('#0f172a').rect(left, y, pageW, 78).fill();
    doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text(safeText(r.company_name || 'RJD PISOWIFI'), left + 14, y + 14, { width: pageW - 28 });
    doc.fontSize(11).font('Helvetica-Bold').text('PPPoE Payment Acknowledgement', left + 14, y + 42, { width: pageW - 28 });
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#fef3c7').text('NOT AN OFFICIAL RECEIPT', left + 14, y + 60, { width: pageW - 28 });
    y += 92;

    const line = () => {
      doc.moveTo(left, y).lineTo(left + pageW, y).lineWidth(1).strokeColor('#e2e8f0').stroke();
      y += 10;
    };

    const label = (t) => {
      doc.fillColor('#64748b').fontSize(9).font('Helvetica-Bold').text(t, left, y, { width: 150 });
    };

    const value = (t) => {
      doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text(safeText(t) || '-', left + 160, y, { width: pageW - 160 });
      y += 18;
    };

    doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text('RECEIPT DETAILS', left, y, { width: pageW });
    y += 10;
    line();
    label('Receipt No'); value(r.receipt_no);
    label('Paid At'); value(r.paid_at);
    label('Payment Method'); value(r.payment_method);
    if (r.notes) { label('Notes'); value(r.notes); }

    y += 6;
    doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text('ACCOUNT / CUSTOMER', left, y, { width: pageW });
    y += 10;
    line();
    label('Account No'); value(r.account_number);
    label('Username'); value(r.username);
    label('Full Name'); value(r.full_name);
    label('Address'); value(r.address);
    label('Contact'); value(r.contact_number);
    label('Email'); value(r.email);

    y += 6;
    doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text('PLAN / BILLING', left, y, { width: pageW });
    y += 10;
    line();
    label('Billing Profile'); value(r.billing_profile_name || r.profile_name);
    label('Previous Expiration'); value(r.prev_expires_at);
    label('New Expiration'); value(r.new_expires_at);

    y += 6;
    doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text('PAYMENT BREAKDOWN', left, y, { width: pageW });
    y += 10;
    line();

    const gross = Number(r.gross_amount || r.amount || 0);
    const net = Number(r.net_amount || r.amount || 0);
    const discDays = Number(r.discount_days || 0);
    const discValue = Math.max(0, gross - net);

    label('Gross Amount'); value(formatMoney(gross));
    label('Discount Days'); value(formatNumber(discDays));
    label('Discount Value'); value(formatMoney(discValue));
    label('Total Paid'); value(formatMoney(net));

    y += 8;
    doc.strokeColor('#cbd5e1').lineWidth(1).roundedRect(left, y, pageW, 70, 12).stroke();
    doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text('Acknowledgement', left + 12, y + 10, { width: pageW - 24 });
    doc.fillColor('#475569').fontSize(9).font('Helvetica').text(
      'This document confirms that payment was received for the PPPoE account above. This is an acknowledgement receipt only and is not an official receipt.',
      left + 12, y + 28, { width: pageW - 24 }
    );
    y += 88;

    const boxW = (pageW - 20) / 2;
    const boxH = 62;
    doc.strokeColor('#cbd5e1').lineWidth(1).roundedRect(left, y, boxW, boxH, 10).stroke();
    doc.strokeColor('#cbd5e1').lineWidth(1).roundedRect(left + boxW + 20, y, boxW, boxH, 10).stroke();
    doc.fillColor('#64748b').fontSize(9).font('Helvetica-Bold').text('Received By (Admin)', left + 12, y + 12, { width: boxW - 24 });
    doc.fillColor('#64748b').fontSize(9).font('Helvetica-Bold').text('Paid By (Customer)', left + boxW + 32, y + 12, { width: boxW - 24 });
    doc.moveTo(left + 12, y + 44).lineTo(left + boxW - 12, y + 44).strokeColor('#94a3b8').stroke();
    doc.moveTo(left + boxW + 32, y + 44).lineTo(left + boxW + 20 + boxW - 12, y + 44).strokeColor('#94a3b8').stroke();
    doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('Signature over Printed Name', left + 12, y + 48, { width: boxW - 24 });
    doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('Signature over Printed Name', left + boxW + 32, y + 48, { width: boxW - 24 });

    doc.end();
  });

  return outputPath;
}

module.exports = {
  generatePPPoESaleReceiptPdf
};
