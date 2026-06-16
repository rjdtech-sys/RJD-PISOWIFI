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

async function generatePPPoEUserFormPdf({ outputPath, user }) {
  ensureDir(path.dirname(outputPath));

  let PDFDocument;
  try {
    PDFDocument = require('pdfkit');
  } catch (e) {
    return null;
  }

  const u = user || {};

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const out = fs.createWriteStream(outputPath);
    out.on('finish', resolve);
    out.on('error', reject);
    doc.pipe(out);

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    let y = doc.page.margins.top;

    doc.fillColor('#0f172a').rect(left, y, pageW, 70).fill();
    const companyName = safeText(u.company_name || u.companyName || 'RJD PISOWIFI');
    doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text(companyName, left + 14, y + 14, { width: pageW - 28 });
    doc.fontSize(11).font('Helvetica-Bold').text('PPPoE Customer Account Form', left + 14, y + 40, { width: pageW - 28 });
    y += 86;

    const drawSection = (title) => {
      doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text(title, left, y, { width: pageW });
      y += 10;
      doc.moveTo(left, y).lineTo(left + pageW, y).lineWidth(1).strokeColor('#e2e8f0').stroke();
      y += 10;
    };

    const row = (k, v) => {
      doc.fillColor('#64748b').fontSize(9).font('Helvetica-Bold').text(k, left, y, { width: 150 });
      doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text(safeText(v) || '-', left + 160, y, { width: pageW - 160 });
      y += 18;
    };

    drawSection('ACCOUNT DETAILS');
    row('Account No', u.account_number);
    row('Username', u.username);
    row('Password', u.password);
    row('Plan', u.billing_profile_name || u.profile_name || '');
    row('Amount', u.amount != null ? formatMoney(u.amount) : '');
    row('Expiration', u.expires_at);

    y += 6;
    drawSection('CUSTOMER INFORMATION');
    row('Full Name', u.full_name);
    row('Address', u.address);
    row('Contact Number', u.contact_number);
    row('Email', u.email);

    y += 12;
    drawSection('SIGNATURES');

    const signRow = (labelLeft, labelRight) => {
      const boxW = (pageW - 20) / 2;
      const boxH = 60;
      const x1 = left;
      const x2 = left + boxW + 20;
      doc.strokeColor('#cbd5e1').lineWidth(1).roundedRect(x1, y, boxW, boxH, 10).stroke();
      doc.strokeColor('#cbd5e1').lineWidth(1).roundedRect(x2, y, boxW, boxH, 10).stroke();
      doc.fillColor('#64748b').fontSize(9).font('Helvetica-Bold').text(labelLeft, x1 + 12, y + 12, { width: boxW - 24 });
      doc.fillColor('#64748b').fontSize(9).font('Helvetica-Bold').text(labelRight, x2 + 12, y + 12, { width: boxW - 24 });
      doc.moveTo(x1 + 12, y + 42).lineTo(x1 + boxW - 12, y + 42).strokeColor('#94a3b8').stroke();
      doc.moveTo(x2 + 12, y + 42).lineTo(x2 + boxW - 12, y + 42).strokeColor('#94a3b8').stroke();
      doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('Signature over Printed Name', x1 + 12, y + 46, { width: boxW - 24 });
      doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('Signature over Printed Name', x2 + 12, y + 46, { width: boxW - 24 });
      y += boxH + 16;
    };

    signRow('Customer', 'Admin');

    doc.fillColor('#64748b').fontSize(8).font('Helvetica').text(`Generated: ${safeText(u.generated_at || '')}`, left, doc.page.height - 70, { width: pageW });
    doc.fillColor('#64748b').fontSize(8).font('Helvetica').text('Keep this form for your records.', left, doc.page.height - 56, { width: pageW });

    doc.end();
  });

  return outputPath;
}

module.exports = {
  generatePPPoEUserFormPdf
};
