import { describe, expect, it } from "vitest"
import { organizationClient } from "better-auth/client/plugins"
import { organization } from "better-auth/plugins/organization"
import { getTestInstance } from "better-auth/test"

describe("Better Auth 1.7 credential and organization flows", () => {
  it("signs in a credential user and creates an organization", async () => {
    const { client, signInWithTestUser } = await getTestInstance(
      {
        plugins: [organization()],
      },
      {
        clientOptions: {
          plugins: [organizationClient()],
        },
      },
    )

    const signedIn = await signInWithTestUser()
    expect(signedIn.user.email).toBe("test@test.com")

    await signedIn.runWithUser(async () => {
      const created = await client.organization.create({
        name: "Sparkfeed Test Workspace",
        slug: "sparkfeed-test-workspace",
      })

      expect(created.data?.slug).toBe("sparkfeed-test-workspace")

      const organizations = await client.organization.list()
      expect(organizations.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: created.data?.id }),
      ]))
    })
  })
})
