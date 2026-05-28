const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PIXELS_TABLE = "pixels";

const handler = require("./handler");

test("placePixel validates payload", async () => {
  const res = await handler.placePixel({
    body: JSON.stringify({ x: -1, y: 0, color: "red", userId: "u1" }),
  });
  assert.equal(res.statusCode, 400);
});

test("placePixel stores valid payload", async () => {
  let called = false;
  handler._setClient({
    send: async () => {
      called = true;
    },
  });

  const res = await handler.placePixel({
    body: JSON.stringify({ x: 1, y: 2, color: "red", userId: "u1" }),
  });
  const body = JSON.parse(res.body);

  assert.equal(res.statusCode, 200);
  assert.equal(body.x, 1);
  assert.equal(body.y, 2);
  assert.equal(body.color, "red");
  assert.equal(body.userId, "u1");
  assert.equal(called, true);
});

test("getCanvas maps dynamodb items", async () => {
  handler._setClient({
    send: async () => ({
      Items: [
        {
          pixelId: { S: "3:4" },
          x: { N: "3" },
          y: { N: "4" },
          color: { S: "blue" },
          userId: { S: "u2" },
          updatedAt: { S: "2026-01-01T00:00:00.000Z" },
        },
      ],
    }),
  });

  const res = await handler.getCanvas();
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(body.pixels[0], {
    x: 3,
    y: 4,
    color: "blue",
    userId: "u2",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
});
