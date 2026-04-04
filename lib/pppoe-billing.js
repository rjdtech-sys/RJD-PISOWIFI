const fs = require('fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function formatMoney(amount) {
  const n = Number(amount || 0);
  return `₱${n.toFixed(2)}`;
}

function safeText(v) {
  return String(v ?? '').trim();
}

async function generatePPPoEInvoicePdf({ outputPath, invoice }) {
  ensureDir(path.dirname(outputPath));

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const out = fs.createWriteStream(outputPath);
    out.on('finish', resolve);
    out.on('error', reject);
    doc.pipe(out);

    doc.fontSize(18).text('AJC PisoWiFi', { align: 'left' });
    doc.moveDown(0.2);
    doc.fontSize(12).text('PPPoE Billing Invoice', { align: 'left' });

    doc.moveDown(1);
    doc.fontSize(10);
    doc.text(`Invoice No: ${safeText(invoice.invoice_no)}`);
    doc.text(`Generated: ${safeText(invoice.generated_at)}`);
    doc.moveDown(0.6);

    doc.text(`Account No: ${safeText(invoice.account_number)}`);
    doc.text(`Username: ${safeText(invoice.username)}`);
    if (invoice.profile_name) doc.text(`Plan: ${safeText(invoice.profile_name)}`);
    if (invoice.billing_profile_name) doc.text(`Billing: ${safeText(invoice.billing_profile_name)}`);
    doc.moveDown(0.6);

    doc.text(`Period Start: ${safeText(invoice.period_start)}`);
    doc.text(`Period End: ${safeText(invoice.period_end)}`);
    doc.text(`Expiration: ${safeText(invoice.expires_at)}`);
    doc.moveDown(0.8);

    doc.fontSize(12).text(`Amount Due: ${formatMoney(invoice.amount)}`, { align: 'left' });

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#666666').text('This invoice is generated automatically upon account expiration.', { align: 'left' });

    doc.end();
  });

  return outputPath;
}

module.exports = {
  generatePPPoEInvoicePdf
};
