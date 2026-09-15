/** Keep generated verification links intact, including Better Auth's callback. */
export function emailVerificationOptions(
  send: (email: string, url: string) => Promise<void>
) {
  return {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({
      user,
      url,
    }: {
      user: { email: string }
      url: string
    }) => {
      await send(user.email, url)
    },
  }
}
