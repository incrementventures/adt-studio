import { describe, it, expect } from "vitest";
import {
  config,
  getTextTypes,
  getTextGroupTypes,
  textTypeKeys,
  groupTypeKeys,
} from "../config.js";

describe("config", () => {
  it("loads successfully", () => {
    expect(config).toBeDefined();
    expect(config.text_types).toBeDefined();
    expect(config.text_group_types).toBeDefined();
  });

  it("has all 20 text types with descriptions", () => {
    const types = getTextTypes();
    expect(Object.keys(types)).toHaveLength(20);
    for (const [key, description] of Object.entries(types)) {
      expect(key).toBeTruthy();
      expect(typeof key).toBe("string");
      expect(description).toBeTruthy();
      expect(typeof description).toBe("string");
    }
  });

  it("has all 5 group types with descriptions", () => {
    const types = getTextGroupTypes();
    expect(Object.keys(types)).toHaveLength(5);
    for (const [key, description] of Object.entries(types)) {
      expect(key).toBeTruthy();
      expect(typeof key).toBe("string");
      expect(description).toBeTruthy();
      expect(typeof description).toBe("string");
    }
  });

  it("exports textTypeKeys as a string array", () => {
    expect(textTypeKeys).toHaveLength(20);
    expect(textTypeKeys).toContain("book_title");
    expect(textTypeKeys).toContain("other");
  });

  it("exports groupTypeKeys as a string array", () => {
    expect(groupTypeKeys).toHaveLength(5);
    expect(groupTypeKeys).toContain("heading");
    expect(groupTypeKeys).toContain("other");
  });
});
