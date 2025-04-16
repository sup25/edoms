# Authentication Service

A robust authentication service built with TypeScript, Express, and JWT tokens for secure user authentication and authorization.

## Features

- User authentication with email and password
- JWT-based authentication with access and refresh tokens
- Protected route middleware
- Role-based access control (Admin and User roles)
- Token refresh mechanism
- Secure password hashing using bcrypt

## Tech Stack

- Node.js
- TypeScript
- Express.js
- Sequelize (ORM)
- JWT (JSON Web Tokens)
- bcrypt
- Jest & Supertest (Testing)

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- A SQL database (PostgreSQL)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/sup25/edoms.git
cd auth-service
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables: Create a .env file in the root directory with the following variables:

```bash
PORT=5000 || your_desired_port
DB_HOST=your_host_name
DB_PORT=your_db_port
DB_USERNAME=your_db_user_name
DB_PASSWORD=your_password
DB_NAME=your_db_name
JWT_SECRET=your_jwt_secret
```

4. Create the PostgreSQL database:

```bash
CREATE DATABASE auth_service || <your_db_name>;
```

5. Sync database tables: The application uses Sequelize's sync method to automatically create database tables based on the defined models. No manual migration step is required. Ensure your database is running and the .env variables are correctly configured.

## Response Format

The API returns responses in the following format:

```bash
{
  "success": boolean,
  "message": string,
  "data": object | null
}
```

## API Endpoints

### Authentication Routes

**Register Admin**

- POST /api/v1/admins
- Body:

```bash
{
   "email": "admin@example.com",
   "password": "password123"
}
```

**Register User**

- POST /api/v1/users
- Body:

```bash
{
   "email": "user@example.com",
   "password": "password123"
}
```

**Login**

- POST /api/v1/auth/login
- Body:

```bash
{
   "email": "admin@example.com",
   "password": "password123"
}
```

**Refresh Token**

- GET /api/v1/auth/refresh
- Headers
  - x-refresh-token: <refresh-token>

## Protected Routes

**Access Protected Route**

- GET /api/v1/protected
- Headers
  - Authorization: Bearer <access-token>

## Authentication Flow

- User register with email and password
- User logs in with email and password
- Server returns access token and refresh token
- Use access token for protected API calls
- When access token expires, use refresh token to get new access token
- Access token must be included in Authorization header as Bearer token

## Testing

**Run the test suite:**

```bash
npm test
```

- specific test

```bash
npm test src/__tests__/<test_name>.test.ts
```

## Security Features

- Password hashing using bcrypt
- JWT token expiration
- Refresh token rotation
- Protected routes middleware
- Role-based access control

## Error Handling

The API returns consistent error responses in the following format:

```json
{
  "success": false,
  "message": "Error message description",
  "data": null
}
```
