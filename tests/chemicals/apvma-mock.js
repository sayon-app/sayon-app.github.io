// Stands in for the APVMA's list of registered products on data.gov.au
// (datastore_search on product.csv), so the tests make no real network
// calls. Every number asked about is registered unless it's in
// state.dropped; state.total is the size of the whole list; state.status
// other than 200 is a failed request. state.calls counts the requests.
// state.listId is the list's file id: another id gets data.gov.au's
// redirect to an HTML page, and the dataset (package_show) names the file.
// require('./apvma-mock.js')(ctx, state)
const NAMES = { '54624': 'TERMIDOR RESIDUAL TERMITICIDE AND INSECTICIDE', '86731': 'Trelona Termite Bait', '60654': 'TERMIDOR DRY TERMITICIDE' };
module.exports = (ctx, state = {}) => {
  Object.assign(state, { dropped: [], total: 19030, status: 200, calls: 0, asked: [], listId: 'b4bb5394-b60b-4602-8bde-2e206ffc498f', datasetCalls: 0, ...state });
  const head = { 'access-control-allow-origin': '*' };
  ctx.route(/data\.gov\.au\/data\/api\/3\/action\/package_show/, r => {
    state.datasetCalls++;
    if (state.status !== 200) return r.fulfill({ status: state.status, body: 'error' });
    return r.fulfill({ headers: head, json: { success: true, result: { resources: [
      { id: 'a83d500d-b47a-4f03-9d77-4c0524217855', name: 'labelreg.csv', datastore_active: true },
      { id: state.listId, name: 'product.csv', datastore_active: true },
    ] } } });
  });
  return ctx.route(/data\.gov\.au\/data\/api\/3\/action\/datastore_search/, r => {
    state.calls++;
    if (state.status !== 200) return r.fulfill({ status: state.status, body: 'error' });
    const q = new URL(r.request().url()).searchParams;
    if (q.get('resource_id') !== state.listId) return r.fulfill({ headers: head, contentType: 'text/html', body: '<!DOCTYPE html><html></html>' });
    if (!q.get('filters')) return r.fulfill({ headers: head, json: { success: true, result: { total: state.total, records: [] } } });
    const asked = JSON.parse(q.get('filters')).pcode;
    state.asked = asked;
    const records = asked.filter(n => !state.dropped.includes(n)).map(n => ({
      pcode: n, fpname: NAMES[n] || `TEST PRODUCT ${n}`, sname: 'TEST HOLDER PTY LTD', expdate: '30/06/2027 12:00:00 AM',
    }));
    return r.fulfill({ headers: head, json: { success: true, result: { total: records.length, records } } });
  });
};
