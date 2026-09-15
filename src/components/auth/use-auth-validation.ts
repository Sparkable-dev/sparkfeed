import { useState } from "react"
import type { authFields } from "@/lib/auth-validation"
import { fieldError } from "@/lib/auth-validation"

export function useAuthValidation() {
  const [errors, setErrors] = useState<Record<string, string>>({})
  function check(id: string, field: keyof typeof authFields, value: string) {
    const message = fieldError(field, value)
    setErrors((previous) => ({ ...previous, [id]: message }))
    return message
  }
  function clearWhenValid(
    id: string,
    field: keyof typeof authFields,
    value: string
  ) {
    if (errors[id] && !fieldError(field, value))
      setErrors((previous) => ({ ...previous, [id]: "" }))
  }
  function validate(fields: Array<[string, keyof typeof authFields, string]>) {
    const next = Object.fromEntries(
      fields.map(([id, field, value]) => [id, fieldError(field, value)])
    )
    setErrors(next)
    const invalid = fields.find(([id]) => next[id])
    if (invalid) document.getElementById(invalid[0])?.focus()
    return !invalid
  }
  return { errors, check, clearWhenValid, validate }
}
