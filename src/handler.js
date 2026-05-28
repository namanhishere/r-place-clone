"use strict";

const {
  DynamoDBClient,
  PutItemCommand,
  ScanCommand,
} = require("@aws-sdk/client-dynamodb");

let client = new DynamoDBClient({});
const tableName = process.env.PIXELS_TABLE;

const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const parseBody = (event) => {
  if (!event || !event.body) return {};
  try {
    return typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  } catch {
    return null;
  }
};

const isValidInteger = (v) => Number.isInteger(v) && v >= 0;
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

exports.getCanvas = async () => {
  const result = await client.send(new ScanCommand({ TableName: tableName }));
  const pixels = (result.Items || []).map((item) => ({
    x: Number(item.x.N),
    y: Number(item.y.N),
    color: item.color.S,
    userId: item.userId.S,
    updatedAt: item.updatedAt.S,
  }));

  return json(200, { pixels });
};

exports.placePixel = async (event) => {
  const body = parseBody(event);
  if (body === null) {
    return json(400, { message: "Invalid JSON body" });
  }

  const { x, y, color, userId } = body;
  if (
    !isValidInteger(x) ||
    !isValidInteger(y) ||
    !isNonEmptyString(color) ||
    !isNonEmptyString(userId)
  ) {
    return json(400, {
      message: "x, y, color and userId are required",
    });
  }

  const updatedAt = new Date().toISOString();
  await client.send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        pixelId: { S: `${x}:${y}` },
        x: { N: String(x) },
        y: { N: String(y) },
        color: { S: color },
        userId: { S: userId },
        updatedAt: { S: updatedAt },
      },
    })
  );

  return json(200, { x, y, color, userId, updatedAt });
};

exports._setClient = (mockClient) => {
  client = mockClient;
};
