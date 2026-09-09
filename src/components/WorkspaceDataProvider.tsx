import { createContext, useContext } from "react"
import { useQuery } from "@tanstack/react-query"
import type { WorkspaceScope } from "@/lib/workspace-scope"
import { workspaceQuery } from "@/lib/workspace-query"

const WorkspaceContext = createContext<WorkspaceScope | null>(null)
export const WorkspaceDataProvider = WorkspaceContext.Provider
export function useWorkspaceScope() {
  return useContext(WorkspaceContext)
}
export function useWorkspaceNavigation() {
  const scope = useWorkspaceScope()
  return useQuery({
    ...workspaceQuery(scope ?? { userId: "guest", workspaceId: "guest" }),
    enabled: !!scope,
  })
}
