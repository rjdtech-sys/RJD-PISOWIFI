import React from 'react';

interface ReceiptProps {
  sale: {
    id: string;
    username: string;
    plan_name?: string;
    amount: number;
    original_amount?: number;
    num_months?: number;
    discount_days?: number;
    discount_amount?: number;
    payment_date: string;
    next_duedate: string;
    payment_method?: string;
    notes?: string;
    currency?: string;
  };
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  printMode?: 'regular' | 'thermal'; // regular = A4, thermal = 58mm/80mm
  onClose: () => void;
}

const AcknowledgementReceipt: React.FC<ReceiptProps> = ({
  sale,
  companyName = 'RJD PisoWiFi',
  companyAddress = '',
  companyPhone = '',
  printMode = 'regular',
  onClose
}) => {
  
  const formatCurrency = (amount: number, currency: string = 'PHP') => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handlePrint = () => {
    window.print();
  };

  const subtotal = sale.original_amount || sale.amount;
  const discount = sale.discount_amount || 0;
  const numMonths = sale.num_months || 1;
  const monthlyRate = sale.original_amount ? sale.original_amount / numMonths : sale.amount;

  // Thermal printer styles (58mm/80mm width)
  if (printMode === 'thermal') {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full">
          {/* Modal Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="text-lg font-bold text-slate-800">Thermal Receipt</h2>
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-700 text-2xl font-bold"
            >
              ×
            </button>
          </div>

          {/* Thermal Receipt Preview */}
          <div className="p-4 bg-slate-50">
            <div id="thermal-receipt" className="bg-white p-3 font-mono text-xs leading-tight mx-auto" style={{ width: '280px', fontFamily: 'monospace' }}>
              {/* Header */}
              <div className="text-center border-b border-dashed border-slate-400 pb-2 mb-2">
                <div className="font-bold text-sm">{companyName}</div>
                {companyAddress && <div className="text-[10px]">{companyAddress}</div>}
                {companyPhone && <div className="text-[10px]">{companyPhone}</div>}
              </div>

              {/* Receipt Title */}
              <div className="text-center font-bold mb-2">
                --- ACKNOWLEDGEMENT RECEIPT ---
              </div>

              {/* Transaction Details */}
              <div className="border-b border-dashed border-slate-400 pb-2 mb-2">
                <div className="flex justify-between">
                  <span>Date:</span>
                  <span>{new Date(sale.payment_date).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Time:</span>
                  <span>{new Date(sale.payment_date).toLocaleTimeString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Receipt #:</span>
                  <span>{sale.id.slice(0, 8).toUpperCase()}</span>
                </div>
              </div>

              {/* Customer Info */}
              <div className="border-b border-dashed border-slate-400 pb-2 mb-2">
                <div className="font-bold">Customer: {sale.username}</div>
                {sale.plan_name && <div>Plan: {sale.plan_name}</div>}
              </div>

              {/* Payment Details */}
              <div className="border-b border-dashed border-slate-400 pb-2 mb-2">
                {numMonths > 1 && (
                  <>
                    <div className="flex justify-between">
                      <span>Monthly Rate:</span>
                      <span>{formatCurrency(monthlyRate, sale.currency)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Months:</span>
                      <span>× {numMonths}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{formatCurrency(subtotal, sale.currency)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>Discount ({sale.discount_days} days):</span>
                    <span>-{formatCurrency(discount, sale.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-sm border-t border-slate-300 pt-1 mt-1">
                  <span>TOTAL PAID:</span>
                  <span>{formatCurrency(sale.amount, sale.currency)}</span>
                </div>
              </div>

              {/* Next Due Date */}
              <div className="border-b border-dashed border-slate-400 pb-2 mb-2">
                <div className="flex justify-between font-bold">
                  <span>Next Due Date:</span>
                  <span>{new Date(sale.next_duedate).toLocaleDateString()}</span>
                </div>
              </div>

              {/* Footer */}
              <div className="text-center text-[10px] pt-2">
                <div>================================</div>
                <div className="font-bold">NOT AN OFFICIAL RECEIPT</div>
                <div>This is an acknowledgement receipt only.</div>
                <div>Thank you for your payment!</div>
                <div>================================</div>
              </div>
            </div>
          </div>

          {/* Print Button */}
          <div className="p-4 border-t flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-300"
            >
              Cancel
            </button>
            <button
              onClick={handlePrint}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
            >
              Print
            </button>
          </div>
        </div>

        {/* Print Styles */}
        <style>{`
          @media print {
            body * {
              visibility: hidden;
            }
            #thermal-receipt, #thermal-receipt * {
              visibility: visible;
            }
            #thermal-receipt {
              position: absolute;
              left: 0;
              top: 0;
              width: 80mm !important;
              padding: 2mm !important;
              margin: 0 !important;
              font-size: 12px !important;
            }
          }
        `}</style>
      </div>
    );
  }

  // Regular printer styles (A4/Letter)
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white z-10">
          <h2 className="text-xl font-bold text-slate-800">Acknowledgement Receipt</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 text-2xl font-bold"
          >
            ×
          </button>
        </div>

        {/* Regular Receipt Preview */}
        <div className="p-6 bg-slate-50">
          <div id="regular-receipt" className="bg-white p-8 shadow-lg mx-auto max-w-lg">
            {/* Header */}
            <div className="text-center border-b-2 border-slate-200 pb-4 mb-4">
              <h1 className="text-2xl font-bold text-slate-800">{companyName}</h1>
              {companyAddress && <p className="text-sm text-slate-600">{companyAddress}</p>}
              {companyPhone && <p className="text-sm text-slate-600">{companyPhone}</p>}
            </div>

            {/* Receipt Title */}
            <div className="text-center mb-6">
              <h2 className="text-lg font-bold text-slate-700 border-2 border-slate-300 inline-block px-6 py-1">
                ACKNOWLEDGEMENT RECEIPT
              </h2>
              <p className="text-xs text-red-600 font-bold mt-2">(NOT AN OFFICIAL RECEIPT)</p>
            </div>

            {/* Receipt Info */}
            <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
              <div>
                <span className="text-slate-500">Receipt No:</span>
                <p className="font-bold">{sale.id.slice(0, 8).toUpperCase()}</p>
              </div>
              <div>
                <span className="text-slate-500">Date & Time:</span>
                <p className="font-bold">{formatDate(sale.payment_date)}</p>
              </div>
            </div>

            {/* Customer Details */}
            <div className="bg-slate-50 p-4 rounded-lg mb-6">
              <h3 className="font-bold text-slate-700 mb-2">Customer Information</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-slate-500">Username:</span>
                  <p className="font-semibold">{sale.username}</p>
                </div>
                {sale.plan_name && (
                  <div>
                    <span className="text-slate-500">Plan:</span>
                    <p className="font-semibold">{sale.plan_name}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Payment Details */}
            <div className="mb-6">
              <h3 className="font-bold text-slate-700 mb-2">Payment Details</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 text-slate-600">Description</th>
                    <th className="text-right py-2 text-slate-600">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {numMonths > 1 && (
                    <>
                      <tr className="border-b border-slate-100">
                        <td className="py-2">Monthly Rate</td>
                        <td className="text-right py-2">{formatCurrency(monthlyRate, sale.currency)}</td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2">Number of Months</td>
                        <td className="text-right py-2">× {numMonths}</td>
                      </tr>
                    </>
                  )}
                  <tr className="border-b border-slate-100">
                    <td className="py-2">Subtotal</td>
                    <td className="text-right py-2">{formatCurrency(subtotal, sale.currency)}</td>
                  </tr>
                  {discount > 0 && (
                    <tr className="border-b border-slate-100 text-red-600">
                      <td className="py-2">Discount ({sale.discount_days} days offline)</td>
                      <td className="text-right py-2">-{formatCurrency(discount, sale.currency)}</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300">
                    <td className="py-3 font-bold text-lg">TOTAL PAID</td>
                    <td className="text-right py-3 font-bold text-lg text-green-600">
                      {formatCurrency(sale.amount, sale.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Next Due Date */}
            <div className="bg-blue-50 p-4 rounded-lg mb-6 text-center">
              <span className="text-slate-600">Next Due Date:</span>
              <p className="font-bold text-lg text-blue-700">{formatDate(sale.next_duedate)}</p>
            </div>

            {/* Payment Method */}
            <div className="text-sm text-slate-600 mb-4">
              Payment Method: <span className="font-semibold">{sale.payment_method || 'Cash'}</span>
            </div>

            {/* Notes */}
            {sale.notes && (
              <div className="text-sm text-slate-600 mb-4">
                Notes: {sale.notes}
              </div>
            )}

            {/* Footer */}
            <div className="border-t-2 border-slate-200 pt-4 text-center text-sm text-slate-500">
              <p className="font-medium">Thank you for your payment!</p>
              <p className="text-xs mt-2">This is an acknowledgement receipt only and is not valid as an official receipt.</p>
            </div>
          </div>
        </div>

        {/* Print Button */}
        <div className="p-4 border-t sticky bottom-0 bg-white flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-300"
          >
            Cancel
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
          >
            Print Receipt
          </button>
        </div>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #regular-receipt, #regular-receipt * {
            visibility: visible;
          }
          #regular-receipt {
            position: absolute;
            left: 50%;
            top: 0;
            transform: translateX(-50%);
            width: 100% !important;
            max-width: 210mm !important;
            padding: 10mm !important;
            margin: 0 !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </div>
  );
};

export default AcknowledgementReceipt;
