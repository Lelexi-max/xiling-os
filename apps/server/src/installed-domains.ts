import { OCEAN_CLIMATE_DOMAIN } from "@xiling/domain-ocean";
import { TABULAR_EXPERIMENT_DOMAIN } from "@xiling/domain-tabular";
import { ScienceDomainRegistry } from "@xiling/science-domains";

/**
 * Application composition point for bundled science domains.
 *
 * The Agent kernel and core contracts never import discipline packages. A new
 * domain is installed here (or, later, by an external package loader) without
 * adding domain-specific branches to the harness, context broker, or graph.
 */
export function createInstalledScienceDomainRegistry(): ScienceDomainRegistry {
  const registry = new ScienceDomainRegistry();
  registry.register(OCEAN_CLIMATE_DOMAIN);
  registry.register(TABULAR_EXPERIMENT_DOMAIN);
  return registry;
}
