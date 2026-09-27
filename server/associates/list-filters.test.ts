import { describe, it, expect } from "vitest";
import { Designation } from "@prisma/client";
import { associateWhere, parseAssociateSearch } from "./list-filters";

describe("associateWhere — B-4 query builder", () => {
  it("no filters → no where clause", () => {
    expect(associateWhere({})).toEqual({});
  });

  it("designation narrows to the associate's own designation", () => {
    expect(associateWhere({ designation: Designation.SalesAssociate })).toEqual({
      AND: [{ designation: Designation.SalesAssociate }],
    });
  });

  it("team narrows to id in the resolved team scope", () => {
    expect(associateWhere({ teamMemberIds: ["a1", "a2"] })).toEqual({
      AND: [{ id: { in: ["a1", "a2"] } }],
    });
  });

  it("designation + team AND together", () => {
    expect(associateWhere({ designation: Designation.SalesManager, teamMemberIds: ["a1"] })).toEqual({
      AND: [{ designation: Designation.SalesManager }, { id: { in: ["a1"] } }],
    });
  });
});

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("parseAssociateSearch — validates URL query params before they reach Prisma", () => {
  it("empty input → everything undefined, no throw", () => {
    expect(parseAssociateSearch({})).toEqual({ designation: undefined, team: undefined });
  });

  it("a valid designation + UUID team pass through", () => {
    expect(parseAssociateSearch({ designation: Designation.SalesDirector, team: VALID_UUID })).toEqual({
      designation: Designation.SalesDirector,
      team: VALID_UUID,
    });
  });

  it("garbage designation (incl. inherited Object keys) and a non-UUID team are dropped, not thrown", () => {
    expect(parseAssociateSearch({ designation: "constructor", team: "'; DROP TABLE associates;--" })).toEqual({
      designation: undefined,
      team: undefined,
    });
  });
});
