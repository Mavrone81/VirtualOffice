// Deliberately NOT a "use client" module. This constant is imported by
// Server Components (app/portal/team/performance/page.tsx via
// server/team/performance.ts) and used to read a URL search
// param server-side. A "use client" module's exports are replaced with
// opaque client-reference objects when imported from server code (the RSC
// module-splitting boundary) -- a plain string constant crossing that
// boundary this way silently stops being the string "teamSearch" and
// becomes an object, so `searchParams[TEAM_SEARCH_KEY]` is always
// `undefined` and the search filter no-ops with no error anywhere (found
// live, UIUX slide-vs-screen check: the dropdown showed a selection but the
// tiles never changed). Keeping any constant a Server Component reads from
// `searchParams` in a plain module, never a "use client" one, is the fix
// AND the way to never reintroduce it -- see
// team-search-params.test.ts for the structural check.
export const TEAM_SEARCH_KEY = "teamSearch";
