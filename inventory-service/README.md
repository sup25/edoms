# Inventory Service

## Overview

The Inventory Service is a microservice designed to manage product stock levels and order reservations. It provides RESTful APIs for stock management and integrates with RabbitMQ for event-driven communication with other services.

## Features

- Product stock management
- Order reservation tracking
- Real-time stock updates via RabbitMQ events
- Admin-protected endpoints
- Concurrent stock updates with race condition prevention
- Request validation middleware

## Tech Stack

- Node.js
- TypeScript
- Express.js
- PostgreSQL
- RabbitMQ
- Jest (for testing)

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL
- RabbitMQ Server
- npm or yarn

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
PORT=your_desired_port
DB_HOST=your_host_name
DB_PORT=your_db_port
DB_USERNAME=your_db_user_name
DB_PASSWORD=your_password
DB_NAME=your_db_name
JWT_SECRET=your_jwt_secret
```

## Installation

```bash
1. Clone the repository
git clone https://github.com/sup25/edoms.git
cd inventory-service
```

2. Install dependencies:

```bash
npm install
```

3. Set up the database:
   - Create a PostgreSQL database named `inventory_service`
   - The tables will be automatically created when the service starts

## Running the Service

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

## API Documentation

### Stock Management

#### 1. Get Stock Level for a Product

```http
GET /api/v1/stock/:id

# Response 200 (application/json)
{
    "success": true,
    "message": "product Stock fetched successfully",
    "data": 100
}

# Response 400 (application/json)
{
    "success": false,
    "message": "Stock not found for productId: 123",
    "data": null
}

# Response 500 (application/json)
{
    "success": false,
    "message": "Internal server error",
    "data": null
}
```

#### 2. Get All Product Stock Levels

```http
GET /api/v1/stocks

# Response 200 (application/json)

{
    "success": true,
    "message": "product Stock fetched successfully",
    "data": [
        {
            "productId": 1,
            "stock": 100
        },
        {
            "productId": 2,
            "stock": 50
        }
    ]
}


# Response 500 (application/json)
{
    "success": false,
    "message": "Error fetching product Stock",
    "error": "error_details"
}
```

#### 3. Update Product Stock Level (Admin Only)

```http
POST /api/v1/updatestock
Content-Type: application/json
Authorization: Bearer <jwt_token>

# Request Body
{
    "id": 1,
    "stock": 100
}

# Response 200 (application/json)
{
    "success": true,
    "message": "product Stock updated successfully",
    "data": {
        "productId": 1,
        "stock": 100,
        "low_stock_threshold": 5
    }
}

# Response 400 (application/json)
{
    "success": false,
    "message": "Stock cannot be negative",
    "data": null
}

# Response 401 (application/json)
{
    "success": false,
    "message": "Unauthorized - Admin access required",
    "data": null
}
```

### Order Reservations

#### 1. Get All Order Reservations

```http
GET /api/v1/reservedstocks

# Response 200 (application/json)
{
    "success": true,
    "message": "reserved order fetched successfully",
    "data": [
        {
            "orderId": 1,
            "productId": 1,
            "quantity": 5,
            "status": "RESERVED"
        }
    ]
}

# Response 500 (application/json)
{
    "success": false,
    "message": "Error fetching reserved order",
    "error": "error_details"
}
```

#### 2. Get Reservations by Order ID

```http
GET /api/v1/reservedstock/:id

# Response 200 (application/json)
{
    "success": true,
    "message": "reserved stock fetched successfully",
    "data": [
        {
            "orderId": 1,
            "productId": 1,
            "quantity": 5,
            "status": "RESERVED"
        }
    ]
}

# Response 404 (application/json)
{
    "success": false,
    "message": "No reserved stock found for order ID 123"
}

# Response 500 (application/json)
{
    "success": false,
    "message": "Internal server error",
    "data": null
}
```

## Event Publishing

The service publishes events to RabbitMQ when stock levels are updated:

- Exchange: `inventory_service`
- Event Type: `stock_updated`
- Routing Key: `stock_updated`

Example Event Payload:

```json
{
  "event": "Stock Updated",
  "data": {
    "productId": 1,
    "stock": 100
  }
}
```

## Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- src/__tests__/updateProductStock.test.ts
```

## Error Handling

The service includes comprehensive error handling for:

- Invalid stock levels
- Non-existent products
- Concurrent update conflicts
- Database connection issues
- Authentication/Authorization failures

## Security

- Admin-only routes are protected with middleware
- JWT authentication
- Input validation using schemas
- Database transaction locks for concurrent operations

## Contributing

For contributing, please refer to the [main repository contribution guide](../README.md#contributing).
