import React, { useState, useEffect } from 'react';

interface SalesReportPageProps {
  routerId: string;
}

const SalesReportPage: React.FC<SalesReportPageProps> = ({ routerId }) => {
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [totalSales, setTotalSales] = useState(0);

  useEffect(() => {
    fetchSales();
  }, [routerId]);

  const fetchSales = async () => {
    try {
      setLoading(true);
      console.log('[SalesReport] Fetching sales for router:', routerId);
      
      let url = `/api/mikrotik/routers/${routerId}/sales`;
      const params = new URLSearchParams();
      
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      
      if (params.toString()) url += `?${params.toString()}`;

      console.log('[SalesReport] Request URL:', url);

      const response = await fetch(url, { credentials: 'include' });
      console.log('[SalesReport] Response status:', response.status);
      
      if (!response.ok) throw new Error('Failed to fetch sales');
      
      const data = await response.json();
      console.log('[SalesReport] Received data:', data);
      console.log('[SalesReport] Number of sales:', data.length);
      
      setSales(data);
      
      // Calculate total
      const total = data.reduce((sum: number, sale: any) => sum + sale.amount, 0);
      setTotalSales(total);
    } catch (err) {
      console.error('[SalesReport] Error fetching sales:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = () => {
    fetchSales();
  };

  const handleClearFilter = () => {
    setStartDate('');
    setEndDate('');
    fetchSales();
  };

  const formatCurrency = (amount: number, currency: string = 'PHP') => {
    return `${currency} ${amount.toFixed(2)}`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading sales report...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Sales Report</h2>
        
        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={handleFilter}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Filter
            </button>
            <button
              onClick={handleClearFilter}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Summary */}
        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-green-600 dark:text-green-400">Total Sales</p>
              <p className="text-3xl font-bold text-green-800 dark:text-green-300">
                {formatCurrency(totalSales)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-green-600 dark:text-green-400">Total Transactions</p>
              <p className="text-3xl font-bold text-green-800 dark:text-green-300">
                {sales.length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Sales Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {sales.length === 0 ? (
          <div className="p-12 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No sales recorded</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Payment transactions will appear here once processed.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Username
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Plan
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Original
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Discount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Final Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Payment Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Next Due Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {sales.map((sale) => (
                  <tr key={sale.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                      {sale.username}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                      {sale.plan_name || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                      {formatCurrency(sale.original_amount || sale.amount, sale.currency)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 dark:text-red-400">
                      {sale.discount_days > 0 ? (
                        <span>
                          {sale.discount_days} days<br />
                          <span className="font-semibold">- {formatCurrency(sale.discount_amount, sale.currency)}</span>
                        </span>
                      ) : (
                        <span className="text-gray-400">None</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-600 dark:text-green-400">
                      {formatCurrency(sale.amount, sale.currency)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                      {formatDate(sale.payment_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                      {formatDate(sale.next_duedate)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300 max-w-xs truncate">
                      {sale.notes || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default SalesReportPage;
