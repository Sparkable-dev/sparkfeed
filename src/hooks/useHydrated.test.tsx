// @vitest-environment jsdom
import { act } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { hydrateRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { useHydrated } from "./useHydrated"

function Identity() {
  return <span>{useHydrated() ? "Cached workspace identity" : "Loading identity"}</span>
}

it("keeps the server snapshot through hydration before showing client auth state", async () => {
  const container = document.createElement("div")
  container.innerHTML = renderToString(<Identity />)
  document.body.append(container)
  expect(container.textContent).toBe("Loading identity")
  const onRecoverableError = vi.fn()
  const root = hydrateRoot(container, <Identity />, { onRecoverableError })
  await act(() => Promise.resolve())
  expect(container.textContent).toBe("Cached workspace identity")
  expect(onRecoverableError).not.toHaveBeenCalled()
  await act(() => root.unmount())
  container.remove()
})
