# Order Service

A microservice responsible for managing orders in an e-commerce system. This service handles order creation, status tracking, and integrates with other microservices like product and stock services.

## Features

- Create new orders with multiple items
- Get order details by ID
- Get order status by ID
- Redis caching for product information
- RabbitMQ event publishing for order events
- Integration with Product and Stock services
- Input validation and error handling

## Prerequisites

- Node.js (v14 or higher)
- Redis
- RabbitMQ
- PostgreSQL (or your preferred database)

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Server Configuration
PORT=5003
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=order_db
DB_USER=your_username
DB_PASSWORD=your_password

# Redis Configuration
REDIS_URL=redis://localhost:6379 || or your-custom-redis-url.com

# RabbitMQ Configuration
RABBITMQ_URL=amqp://localhost:5672

# Service URLs
PRODUCT_SERVICE_URL=http://localhost:3001 || or https://your-custom-product-service.com
STOCK_SERVICE_URL=http://localhost:3002 || or https://your-custom-stock-service.com
```

## Installation

1. Clone the repository:

```bash
git clone https://github.com/sup25/edoms.git
cd order-service
```

2. Install dependencies:

```bash
npm install
```

## Running the Service

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

## API Endpoints

### Create Order

```
POST /api/v1/createorder
```

Request Body:

```json
{
  "userId": 1,
  "items": [
    {
      "productId": 1,
      "quantity": 2
    }
  ]
}
```

Response (Success - 201):

```json
{
  "success": true,
  "message": "Order created successfully",
  "data": {
    "id": 1,
    "userId": 1,
    "items": [
      {
        "productId": 1,
        "name": "Product Name",
        "price": "10.00",
        "quantity": 2,
        "total": 20.0
      }
    ],
    "status": "pending",
    "createdAt": "2024-03-20T10:00:00.000Z",
    "totalAmount": "20.00"
  }
}
```

Response (Error - 400):

```json
{
  "success": false,
  "message": "Invalid user ID",
  "data": null
}
```

### Get Order Details

```
GET /api/v1/order/:id
```

Response (Success - 200):

```json
{
  "success": true,
  "message": "Order fetched successfully",
  "data": {
    "items": [
      {
        "productId": 1,
        "name": "Product Name",
        "price": "10.00",
        "quantity": 2,
        "total": 20.0
      }
    ],
    "status": "pending"
  }
}
```

Response (Error - 404):

```json
{
  "success": false,
  "message": "Order not found"
}
```

### Get Order Status

```
GET /api/v1/orderStatus/:id
```

Response (Success - 200):

```json
{
  "success": true,
  "message": "Order status fetched successfully",
  "data": "pending"
}
```

Response (Error - 404):

```json
{
  "success": false,
  "message": "Order not found"
}
```

## Testing

Run the test suite:

```bash
npm test
```

## Run specific test file

npm test -- src/**tests**/createOrder.test.ts

## Dependencies

- Express.js: Web framework
- Sequelize: ORM for database operations
- Redis: Caching
- RabbitMQ: Message broker
- Jest: Testing framework
- TypeScript: Programming language

## Contributing

For contributing, please refer to the [main repository contribution guide](../README.md#contributing).
