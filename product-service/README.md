# Product Service

A microservice for managing products in an e-commerce system. This service handles product CRUD operations and integrates with other services through message queues and caching.

## Features

- Product CRUD operations (Create, Read, Update, Delete)
- Redis caching for product stock information
- RabbitMQ integration for event-driven architecture
- Integration with Inventory Service for stock management
- JWT-based authentication for admin operations
- Pagination support for product listing
- Input validation using Zod schemas

## Prerequisites

- Node.js (v14 or higher)
- Redis
- RabbitMQ
- PostgreSQL
- Inventory Service (for stock management)

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
PORT=5001
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://localhost:5672
INVENTORY_SERVICE_URL=http://localhost:5002
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_NAME=inventory_service
JWT_SECRET=your_secret
```

## Installation

1. Clone the repository:

```bash
git clone https://github.com/sup25/edoms.git
cd product-service
```

2. Install dependencies:

```bash
npm install
```

3. Start the service:

```bash
npm start
```

## API Endpoints

### Products

- `GET /api/v1/products` - Get all products (with pagination)

  - Query Parameters:
    - `page` (default: 1)
    - `limit` (default: 10)

- `GET /api/v1/product/:id` - Get product by ID

- `GET /api/v1/product/:slug` - Get product by slug

- `POST /api/v1/createproduct` - Create a new product

  - Body:
    ```json
    {
      "name": "Product Name",
      "price": 99.99,
      "slug": "product-name"
    }
    ```

- `PUT /api/v1/updateproduct/:id` - Update a product

  - Body:
    ```json
    {
      "name": "Updated Name",
      "price": 149.99,
      "slug": "updated-name"
    }
    ```

- `DELETE /api/v1/deleteproduct/:id` - Delete a product

## Authentication

Admin operations (create, update, delete) require JWT authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Event System

The service publishes events to RabbitMQ for the following operations:

- Product Created
- Product Updated
- Product Deleted

## Testing

Run the test suite:

```bash
npm test
```

## Error Handling

The service implements comprehensive error handling for:

- Database operations
- Redis caching
- RabbitMQ communication
- Inventory service integration
- Input validation
- Authentication

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request
