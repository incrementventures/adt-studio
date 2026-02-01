import { describe, it, expect } from "vitest";
import {
  loadConfig,
  getTextTypes,
  getTextGroupTypes,
} from "../config.js";

describe("config", () => {
  it("loads successfully", () => {
    const config = loadConfig();
    expect(config).toBeDefined();
    expect(config.text_types).toBeDefined();
    expect(config.text_group_types).toBeDefined();
  });

  it("has all 20 text types with descriptions", () => {
    const config = loadConfig();
    const types = getTextTypes(config);
    expect(Object.keys(types)).toHaveLength(20);
    for (const [key, description] of Object.entries(types)) {
      expect(key).toBeTruthy();
      expect(typeof key).toBe("string");
      expect(description).toBeTruthy();
      expect(typeof description).toBe("string");
    }
  });

  it("has all 5 group types with descriptions", () => {
    const config = loadConfig();
    const types = getTextGroupTypes(config);
    expect(Object.keys(types)).toHaveLength(5);
    for (const [key, description] of Object.entries(types)) {
      expect(key).toBeTruthy();
      expect(typeof key).toBe("string");
      expect(description).toBeTruthy();
      expect(typeof description).toBe("string");
    }
  });

  it("textTypeKeys derived from config", () => {
    const config = loadConfig();
    const textTypeKeys = Object.keys(config.text_types);
    expect(textTypeKeys).toHaveLength(20);
    expect(textTypeKeys).toContain("book_title");
    expect(textTypeKeys).toContain("other");
  });

  it("groupTypeKeys derived from config", () => {
    const config = loadConfig();
    const groupTypeKeys = Object.keys(config.text_group_types);
    expect(groupTypeKeys).toHaveLength(5);
    expect(groupTypeKeys).toContain("heading");
    expect(groupTypeKeys).toContain("other");
  });
});
