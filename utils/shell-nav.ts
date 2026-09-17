// Path-to-chrome rules for the app shell: which nav item is "you are here",
// what the header calls the screen, and the breadcrumb trail. Kept free of
// React and path aliases so the node test runner can import it.

export function getScreenTitle(slug: string): string {
  if (slug === "agent") {
    return "Operations Agent";
  }

  // A bare number is a lead id (/leads/123, /offers/123). The offer route used
  // to read "Creating Offer for Lead #123" even on an issued offer.
  if (/^\d+$/.test(slug)) {
    return `Lead #${slug}`;
  }
  if (slug.trim() === "") {
    return "Dashboard";
  }
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// The nav is one level deep, so the first segment names the section. Matching
// on the last segment lost the highlight on every nested route (/offers/123).
export function getShellSectionSlug(path: string): string {
  return path.split("/").filter(Boolean)[0] ?? "dashboard";
}

export function getShellTrail(path: string, title: string): string[] {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return ["Home", title];
  }
  const section = getScreenTitle(segments[0]);
  return section === title ? ["Home", title] : ["Home", section, title];
}
