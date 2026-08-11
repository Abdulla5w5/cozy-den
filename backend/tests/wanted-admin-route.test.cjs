const assert = require('node:assert/strict');
const test = require('node:test');

const { staffRouter } = require('../dist/src/modules/staff/staff.routes.js');

test('wanted-post deletion is guarded by admin authorization', () => {
  const layer = staffRouter.stack.find(
    (candidate) =>
      candidate.route?.path === '/wanted/:id' && candidate.route.methods?.delete === true,
  );

  assert.ok(layer, 'DELETE /staff/wanted/:id must exist');
  assert.equal(layer.route.stack[0]?.handle?.name, 'requireAdmin');
});
