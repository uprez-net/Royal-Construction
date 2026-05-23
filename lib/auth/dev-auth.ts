export const DEV_AUTH = {
  email: process.env.DEV_AUTH_EMAIL ?? "dhrubjyoti.biswas@gmail.com",
  clerkUserId: process.env.DEV_AUTH_CLERK_USER_ID ?? "user_3E7ck3uIZrgnX5hvwMzbrigsvVx",
} as const

export function isDevAutoSignInEnabled(): boolean {
  if (process.env.NODE_ENV !== "development") return false
  if (process.env.DEV_AUTO_SIGN_IN === "false") return false
  return true
}
