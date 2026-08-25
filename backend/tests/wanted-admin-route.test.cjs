const assert = require('node:assert/strict');
const test = require('node:test');

const { staffRouter } = require('../dist/src/modules/staff/staff.routes.js');

// Deleting a Wanted Board post is staff work, not admin-only work: whoever
// approves posts also clears them out. What must never change is that it is
// guarded at all — the route is destructive and the server guard is the only
// thing standing between it and the open internet.
test('wanted-post deletion is guarded by staff authorization', () => {
  const layer = staffRouter.stack.find(
    (candidate) =>
      candidate.route?.path === '/wanted/:id' && candidate.route.methods?.delete === true,
  );

  assert.ok(layer, 'DELETE /staff/wanted/:id must exist');
  assert.equal(layer.route.stack[0]?.handle?.name, 'requireStaff');
});
