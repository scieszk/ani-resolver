import { describe, expect, it } from "vitest";

import { parseAppearanceText, scoreAppearanceMatch } from "../src/appearance.js";

describe("parseAppearanceText", () => {
  it("normalizes Chinese character clues into source-neutral appearance facts", () => {
    expect(parseAppearanceText("女主是白发双马尾，前期没啥特殊表情")).toEqual({
      hairColors: ["white"],
      eyeColors: [],
      hairStyles: ["twintails"],
      genders: ["female"],
      apparentAges: [],
      clothing: [],
      traits: ["expressionless"],
    });
  });

  it("normalizes English colors, hairstyles, age, and clothing", () => {
    expect(parseAppearanceText("a teen girl with silver hair, blue eyes, a ponytail and school uniform")).toEqual({
      hairColors: ["silver"],
      eyeColors: ["blue"],
      hairStyles: ["ponytail"],
      genders: ["female"],
      apparentAges: ["teen"],
      clothing: ["school_uniform"],
      traits: [],
    });
  });

  it("normalizes traditional Chinese Wikidata labels", () => {
    expect(parseAppearanceText("白頭髮、雙馬尾、綠色眼睛")).toMatchObject({
      hairColors: ["white"],
      eyeColors: ["green"],
      hairStyles: ["twintails"],
    });
  });

  it("does not invent traits from unrelated prose", () => {
    expect(parseAppearanceText("a talented mage who likes collecting spells")).toEqual({
      hairColors: [],
      eyeColors: [],
      hairStyles: [],
      genders: [],
      apparentAges: [],
      clothing: [],
      traits: [],
    });
  });
});

describe("scoreAppearanceMatch", () => {
  it("scores coverage by requested facts and treats white and silver hair as compatible", () => {
    const query = parseAppearanceText("白发 双马尾 女 无表情");
    const candidate = parseAppearanceText("silver-haired girl with twintails and an expressionless face");

    expect(scoreAppearanceMatch(query, candidate)).toEqual({
      score: 1,
      matched: ["hair_color:white", "hair_style:twintails", "gender:female", "trait:expressionless"],
      missing: [],
    });
  });

  it("reports missing requested facts instead of treating a partial match as certain", () => {
    const query = parseAppearanceText("红眼 长发 女");
    const candidate = parseAppearanceText("a woman with red eyes");

    expect(scoreAppearanceMatch(query, candidate)).toEqual({
      score: 0.6667,
      matched: ["eye_color:red", "gender:female"],
      missing: ["hair_style:long_hair"],
    });
  });
});
