// The public static build has no co-op backend. Local development and container
// builds keep all server features enabled.
export const SOLO_ONLY = typeof __SOLO_ONLY__ !== 'undefined' && __SOLO_ONLY__;
