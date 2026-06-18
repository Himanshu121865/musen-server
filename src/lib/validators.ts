const USERNAME_REGEX = /^[a-zA-Z0-9_-]{2,32}$/;
const DISALLOWED_USERNAMES = new Set([
  "admin", "root", "system", "mod", "moderator",
  "server", "api", "null", "undefined", "bot",
]);

export function validateUsername(username: string): string | null {
  if (!username || username.length < 2) return "Username must be at least 2 characters";
  if (username.length > 32) return "Username must be at most 32 characters";
  if (!USERNAME_REGEX.test(username)) return "Username can only contain letters, numbers, underscores, and hyphens";
  if (DISALLOWED_USERNAMES.has(username.toLowerCase())) return "That username is reserved";
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password || password.length < 4) return "Password must be at least 4 characters";
  if (password.length > 128) return "Password must be at most 128 characters";
  return null;
}
