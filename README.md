# r-place-clone

AWS Serverless migration for the original Node.js + Redis r/place clone backend.

## Architecture

- **AWS Lambda** (Node.js) for API handlers
- **Amazon API Gateway** for HTTP endpoints
- **Amazon DynamoDB** to store pixel state (Redis replacement)

## API

- `GET /canvas` - returns all placed pixels
- `PUT /pixel` - upserts a pixel (`x`, `y`, `color`, `userId`)

## Deploy (AWS SAM)

```bash
sam build
sam deploy --guided
```

## Local tests

```bash
npm test
```