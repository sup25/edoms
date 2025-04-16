# Payment Service

A microservice for handling payment processing and order management in an e-commerce system. This service integrates with Stripe for payment processing and uses RabbitMQ for event-driven communication.

## Features

- Payment processing using Stripe
- Order validation and verification
- Reserved stock checking
- Event-driven architecture using RabbitMQ
- RESTful API endpoints
- Database integration for payment storage
- Error handling and retry mechanisms

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL
- RabbitMQ
- Stripe account and API key

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_NAME=payment_service
JWT_SECRET=your_jwt_secret
PORT=5004
# stripe
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_TEST_PAYMENT_METHOD=pm_card_visa
```

## Installation

1. Clone the repository:

```bash
git clone https://github.com/sup25/edoms.git
cd payment-service
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start the service:

```bash
npm start
```

## API Endpoints

### POST /api/v1/create-payment

Process payment for an order.

**Request Body:**

```json
{
  "orderId": "string",
  "userId": "string",
  "items": [
    {
      "productId": "string",
      "quantity": number,
      "price": "string"
    }
  ]
}
```

**Response:**

```json
{
  "status": "success" | "failed"
}
```

### GET /api/v1/test

Health check endpoint.

**Response:**

```json
{
  "message": "Server is running!"
}
```

## Error Handling

The service implements comprehensive error handling for various scenarios:

- Invalid order details
- Payment processing failures
- Database errors
- Network issues
- RabbitMQ connection problems

## Testing

Run tests using:

```bash
npm test
```

The test suite includes:

- Unit tests for controllers and services
- Integration tests for API endpoints
- Mock implementations for external services

## Dependencies

- express: Web framework
- axios: HTTP client
- amqplib: RabbitMQ client
- stripe: Payment processing
- sequelize: Database ORM
- express-async-handler: Async error handling

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request
