# EDOMS - Event-Driven Order Management System

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)

EDOMS is a microservices-based order management system built with Node.js and TypeScript. The system is designed to handle various aspects of order management operations including user authentication, product management, inventory tracking, order processing, and payment handling.

## Project Structure

The project consists of the following microservices:

- **Auth Service**: Handles user authentication and authorization
- **Product Service**: Manages product catalog and information
- **Inventory Service**: Manages product inventory and stock levels
- **Order Service**: Processes and manages customer orders
- **Payment Service**: Handles payment processing and transactions

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- PostgreSQL (for data storage)
- RabbitMQ (for message queuing and event-driven communication)
- Redis (for caching)

## Why PostgreSQL?

For EDOMS, I needed a database that supports strong consistency, transactional integrity, and can scale with microservices. After evaluating several options like MySQL, MongoDB, and PostgreSQL, I decided to go with **PostgreSQL** because of its:

- Excellent support for ACID transactions (crucial for order and payment consistency)
- Strong community and ecosystem
- Flexibility with JSON and relational data
- Great tooling support in the Node.js/TypeScript ecosystem

I also created a small project to help compare these databases based on real use-case factors like scalability, data model needs, and transaction guarantees.

👉 [See the comparison here](https://github.com/sup25/dbchooser)

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

- Auth Service: 5000
- Product Service: 5001
- Inventory Service: 5002
- Order Service: 5003
- Payment Service: 5004

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
- Uses Redis for caching
- Can be deployed independently
- Has its own business logic and domain

## Security

- JWT-based authentication
- Role-based access control
- Secure password hashing
- API rate limiting
- Input validation and _(sanitization coming soon)_

## Support

For support, please open an issue in the repository.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Contributors

- [Suparna Adhikari](https://github.com/sup25)

If you'd like to contribute, feel free to submit a pull request!
