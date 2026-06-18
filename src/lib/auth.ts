import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config } from "../config";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: { userId: number; username: string }) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "7d" });
}

export function verifyToken(token: string): {
  userId: number;
  username: string;
} {
  return jwt.verify(token, config.jwtSecret) as {
    userId: number;
    username: string;
  };
}
