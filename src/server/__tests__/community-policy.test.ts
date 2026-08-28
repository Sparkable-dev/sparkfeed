import { describe, expect, it } from "vitest"
import {
  COMMUNITY_USER_LIMIT,
  decideRegistration,
  decideWorkspaceCreation,
  readWorkspaceCreationPolicy,
} from "@/lib/community-policy"

describe("Community registration policy", () => {
  it("allows open registration", () => {
    expect(
      decideRegistration({
        openRegistration: true,
        userCount: 3,
        invited: false,
      })
    ).toEqual({ allowed: true, reason: "open" })
  })

  it("allows the first account when registration is closed", () => {
    expect(
      decideRegistration({
        openRegistration: false,
        userCount: 0,
        invited: false,
      })
    ).toEqual({ allowed: true, reason: "first-setup" })
  })

  it("allows an invited account when registration is closed", () => {
    expect(
      decideRegistration({
        openRegistration: false,
        userCount: 3,
        invited: true,
      })
    ).toEqual({ allowed: true, reason: "invited" })
  })

  it("rejects an uninvited account after setup", () => {
    expect(
      decideRegistration({
        openRegistration: false,
        userCount: 3,
        invited: false,
      })
    ).toEqual({ allowed: false, reason: "invite-only" })
  })

  it("rejects new accounts at the Community instance limit", () => {
    expect(
      decideRegistration({
        openRegistration: true,
        userCount: COMMUNITY_USER_LIMIT,
        invited: true,
      })
    ).toEqual({ allowed: false, reason: "instance-limit" })
  })
})

describe("Community workspace creation policy", () => {
  it("uses owner-only as the secure default", () => {
    expect(readWorkspaceCreationPolicy(undefined)).toBe("owner-only")
    expect(readWorkspaceCreationPolicy("unexpected")).toBe("owner-only")
  })

  it("recognizes the all-users setting", () => {
    expect(readWorkspaceCreationPolicy("all-users")).toBe("all-users")
  })

  it("allows only the instance owner under the default policy", () => {
    expect(
      decideWorkspaceCreation({ policy: "owner-only", isInstanceOwner: true })
    ).toBe(true)
    expect(
      decideWorkspaceCreation({ policy: "owner-only", isInstanceOwner: false })
    ).toBe(false)
  })

  it("allows every user under the open policy", () => {
    expect(
      decideWorkspaceCreation({ policy: "all-users", isInstanceOwner: false })
    ).toBe(true)
  })
})
