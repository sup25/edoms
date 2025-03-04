import jwt from "jsonwebtoken";

export const getExpirationFromToken = (token: string): Date | null => {
  const decoded = jwt.decode(token) as { exp?: number } | null;

  if (!decoded || !decoded.exp) {
    return null;
  }

  return new Date(decoded.exp * 1000);
};
