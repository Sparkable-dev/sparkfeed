import { z } from "zod"

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128
export const authFields = {
  name: z
    .string()
    .trim()
    .min(1, "Enter your full name.")
    .max(200, "Use 200 characters or fewer."),
  email: z.string().trim().pipe(z.email("Enter a valid email address.")),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, "Use at least 8 characters.")
    .max(PASSWORD_MAX_LENGTH, "Use 128 characters or fewer."),
  signInPassword: z.string().min(1, "Enter your password."),
}
export function fieldError(field: keyof typeof authFields, value: string) {
  const result = authFields[field].safeParse(value)
  return result.success ? "" : result.error.issues[0].message
}
