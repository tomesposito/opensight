export function definition() {
  return { version: 1, id: 'synthetic', title: 'Synthetic report', date: '2026-10-08',
    pageSetup: { size: 'A4', orientation: 'portrait', margins: { top: 15, right: 15, bottom: 15, left: 15 } },
    header: { runs: [{ field: 'reportTitle' }] },
    footer: { runs: [{ text: 'Page ' }, { field: 'pageNumber' }, { text: ' of ' }, { field: 'totalPages' }, { text: ' | ' }, { field: 'date' }] },
    body: [{ kind: 'table', id: 'sales', datasetId: 'synthetic-sales', columns: [
      { field: { dataSetIdentifier: 'synthetic-sales', columnName: 'region' }, type: 'STRING', label: 'Region' },
      { field: { dataSetIdentifier: 'synthetic-sales', columnName: 'amount' }, type: 'INTEGER', label: 'Amount' },
    ] }],
  };
}
export const rows = n => ({ sales: Array.from({ length: n }, (_, i) => ({ region: `Synthetic ${i + 1}`, amount: i + 1 })) });
