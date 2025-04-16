# EDOMS - Event-Driven Order Management System

EDOMS is a microservices-based order management system built with Node.js and TypeScript. The system is designed to handle various aspects of order management operations including user authentication, product management, inventory tracking, order processing, and payment handling.

## Project Structure

The project consists of the following microservices:

- **Auth Service**: Handles user authentication and authorization
- **Inventory Service**: Manages product inventory and stock levels
- **Order Service**: Processes and manages customer orders
- **Payment Service**: Handles payment processing and transactions
- **Product Service**: Manages product catalog and information

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- MongoDB (for data storage)
- RabbitMQ (for message queuing and event-driven communication)
- Redis (for caching and session management)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/sup25/edoms.git
cd edoms
```

2. Install dependencies for each service:

```bash
cd auth-service && npm install
cd ../inventory-service && npm install
cd ../order-service && npm install
cd ../payment-service && npm install
cd ../product-service && npm install
```

3. Set up environment variables:

   - Copy the `.env.example` file to `.env` in each service directory
   - Update the environment variables as needed

4. Start each service manually:
   - Navigate to each service directory
   - Run the service using the appropriate command for that service
   - Each service needs to be started individually

## Service Ports

- Auth Service: 3001
- Inventory Service: 3002
- Order Service: 3003
- Payment Service: 3004
- Product Service: 3005

## API Documentation

Each service exposes its own REST API endpoints. Detailed API documentation can be found in the respective service's README file.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Architecture

The system follows a microservices architecture where each service:

- Has its own database
- Communicates through REST APIs and RabbitMQ for event-driven operations
- Uses Redis for caching and session management
- Can be deployed independently
- Has its own business logic and domain

## Security

- JWT-based authentication
- Role-based access control
- Secure password hashing
- API rate limiting
- Input validation and sanitization

## Support

For support, please open an issue in the repository.

## Contributors

- [Suparna Adhikari](https://github.com/sup25)

If you'd like to contribute, feel free to submit a pull request!
