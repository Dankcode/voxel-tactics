// Runtime lookup over the compiled environment design (ActiveEnvironmentData.js).
// Environments reshape the terrain noise outside settlements; resources are exclusive to one
// state (or one province variant of it); caves are anchored to world coordinates.

import { ACTIVE_ENVIRONMENTS } from './ActiveEnvironmentData.js';
import { resolveEnvironmentIdFromProfiles } from './EnvironmentRules.js';

export const ENVIRONMENT_DESIGN_HASH = ACTIVE_ENVIRONMENTS.designHash;
export const ENVIRONMENT_IDS = Object.freeze([...ACTIVE_ENVIRONMENTS.environmentOrder]);

const ENVIRONMENTS = ACTIVE_ENVIRONMENTS.environments;
const STATES = ACTIVE_ENVIRONMENTS.states;
const RESOURCES = ACTIVE_ENVIRONMENTS.resources;
const NEUTRAL_FLAVOR = Object.freeze({ maskRotation: 0, mirror: false, classNudge: Object.freeze({}) });

export function resolveEnvironmentId(field, biomeNames = []) {
    return resolveEnvironmentIdFromProfiles(field, ENVIRONMENTS, ENVIRONMENT_IDS, biomeNames);
}

export function getEnvironmentProfile(environmentId) {
    return ENVIRONMENTS[environmentId] || null;
}

export function getStateEnvironmentFlavor(stateId) {
    return STATES[Number(stateId)]?.flavor || NEUTRAL_FLAVOR;
}

export function getStateEnvironmentRecord(stateId) {
    return STATES[Number(stateId)] || null;
}

export function getResourceDefinition(resourceId) {
    return RESOURCES[resourceId] || null;
}

export function listResourceDefinitions() {
    return Object.values(RESOURCES);
}

/**
 * The resource a wilderness cell can yield: the province variant when the cell's province has
 * one and the environment suits it, otherwise the state's signature resource. Null when the
 * state has nothing for this environment — which is what makes resources regional.
 */
export function resolveRegionalResource({ stateId, provinceId, environmentId } = {}) {
    const state = STATES[Number(stateId)];
    if (!state || !environmentId) return null;
    const variantId = state.provinces?.[Number(provinceId)]?.resourceId;
    const variant = variantId ? RESOURCES[variantId] : null;
    if (variant?.environments.includes(environmentId)) return variant;
    const signature = state.resourceId ? RESOURCES[state.resourceId] : null;
    return signature?.environments.includes(environmentId) ? signature : null;
}

export function getCaveDefinitions() {
    return ACTIVE_ENVIRONMENTS.caves;
}

export function getCaveDefinition(caveId) {
    return ACTIVE_ENVIRONMENTS.caves.find((cave) => cave.id === caveId) || null;
}

export function getCaveProfile(profileId) {
    return ACTIVE_ENVIRONMENTS.caveProfiles[profileId] || null;
}

/** Cave profile a host environment suggests, for caves placed procedurally later. */
export function getCaveProfileForEnvironment(environmentId) {
    for (const [id, profile] of Object.entries(ACTIVE_ENVIRONMENTS.caveProfiles)) {
        if (profile.environments.includes(environmentId)) return id;
    }
    return null;
}
