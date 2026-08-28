import type { ModelRouteSettings } from "@xiling/contracts";

export type ModelRouteSource = "turn" | "role" | "primary" | "missing";

export function selectModelRoute(
  routes: { primary?: ModelRouteSettings; roleRoutes: Record<string, ModelRouteSettings> },
  request: { roleId?: string; turnOverride?: ModelRouteSettings },
): { route?: ModelRouteSettings; source: ModelRouteSource } {
  if (request.roleId) {
    const roleRoute = routes.roleRoutes[request.roleId];
    if (roleRoute) return { route: roleRoute, source: "role" };
    return routes.primary ? { route: routes.primary, source: "primary" } : { source: "missing" };
  }
  if (request.turnOverride) return { route: request.turnOverride, source: "turn" };
  return routes.primary ? { route: routes.primary, source: "primary" } : { source: "missing" };
}
