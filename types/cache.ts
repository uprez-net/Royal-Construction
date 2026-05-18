export const CACHE_PROFILES = {
  SHORT: {
    stale: 120,
    revalidate: 120,
    expire: 300,
  },

  MEDIUM: {
    stale: 300,
    revalidate: 300,
    expire: 600,
  },

  LONG: "max" as const,
};