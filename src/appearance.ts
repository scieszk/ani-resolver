import type { AppearanceMatch, CharacterAppearance } from "./types.js";

export type AppearanceField = keyof CharacterAppearance;

interface VocabularyEntry {
  value: string;
  patterns: RegExp[];
}

const VOCABULARY: Record<AppearanceField, VocabularyEntry[]> = {
  hairColors: [
    entry("white", /白(?:色)?(?:头|頭)?(?:发|髮)|白髪|white[- ]?hair(?:ed)?/iu),
    entry("silver", /(?:银|銀)(?:色)?(?:头|頭)?(?:发|髮)|銀髪|silver[- ]?hair(?:ed)?/iu),
    entry("black", /黑(?:色)?(?:头|頭)?(?:发|髮)|黒髪|black[- ]?hair(?:ed)?/iu),
    entry("blond", /金(?:色)?(?:头|頭)?(?:发|髮)|金髪|blond(?:e)?[- ]?hair(?:ed)?/iu),
    entry("brown", /(?:棕|褐)(?:色)?(?:头|頭)?(?:发|髮)|茶髪|brown[- ]?hair(?:ed)?/iu),
    entry("red", /(?:红|紅)(?:色)?(?:头|頭)?(?:发|髮)|赤髪|red[- ]?hair(?:ed)?/iu),
    entry("blue", /(?:蓝|藍)(?:色)?(?:头|頭)?(?:发|髮)|青髪|blue[- ]?hair(?:ed)?/iu),
    entry("green", /(?:绿|綠)(?:色)?(?:头|頭)?(?:发|髮)|緑髪|green[- ]?hair(?:ed)?/iu),
    entry("purple", /紫(?:色)?(?:头|頭)?(?:发|髮)|紫髪|purple[- ]?hair(?:ed)?/iu),
    entry("pink", /粉(?:色)?(?:头|頭)?(?:发|髮)|ピンク髪|pink[- ]?hair(?:ed)?/iu),
    entry("orange", /(?:橙|橘)(?:色)?(?:头|頭)?(?:发|髮)|orange[- ]?hair(?:ed)?/iu),
  ],
  eyeColors: [
    entry("white", /白(?:色)?(?:眼|瞳|眸)|white eyes?/iu),
    entry("silver", /银(?:色)?(?:眼|瞳|眸)|銀(?:色)?(?:眼|瞳)|silver eyes?/iu),
    entry("black", /黑(?:色)?(?:眼|瞳|眸)|黒(?:い)?(?:目|瞳)|black eyes?/iu),
    entry("brown", /棕(?:色)?(?:眼|瞳|眸)|褐(?:色)?(?:眼|瞳)|茶色(?:の)?目|brown eyes?/iu),
    entry("red", /红(?:色)?(?:眼|瞳|眸)|紅(?:色)?(?:眼|瞳)|赤(?:い)?(?:目|瞳)|red eyes?/iu),
    entry("blue", /蓝(?:色)?(?:眼|瞳|眸)|藍(?:色)?(?:眼|瞳)|青(?:い)?(?:目|瞳)|blue eyes?/iu),
    entry("green", /绿(?:色)?(?:眼|瞳|眸)|綠(?:色)?(?:眼|瞳)|緑(?:色)?(?:の)?(?:目|瞳)|green eyes?/iu),
    entry("purple", /紫(?:色)?(?:眼|瞳|眸)|紫(?:色)?(?:の)?(?:目|瞳)|purple eyes?/iu),
    entry("yellow", /黄(?:色)?(?:眼|瞳|眸)|金(?:色)?(?:眼|瞳|眸)|yellow eyes?|golden eyes?/iu),
    entry("pink", /粉(?:色)?(?:眼|瞳|眸)|ピンク(?:色)?(?:の)?(?:目|瞳)|pink eyes?/iu),
  ],
  hairStyles: [
    entry("twintails", /双马尾|雙馬尾|双ツインテール|ツインテール|twin[- ]?tails?|twin pigtails?/iu),
    entry("ponytail", /(?<!双|雙)马尾|ポニーテール|pony[- ]?tail/iu),
    entry("long_hair", /长发|長髮|長髪|long[- ]?hair(?:ed)?|waist[- ]length hair/iu),
    entry("short_hair", /短发|短髮|短髪|short[- ]?hair(?:ed)?/iu),
    entry("braids", /辫子|辮子|编发|編髮|三つ編み|braids?|braided hair/iu),
    entry("hair_bun", /丸子头|丸子頭|发髻|髮髻|お団子|hair buns?/iu),
  ],
  genders: [
    entry(
      "female",
      /女主|女性|女生|女孩|少女|女子|女の子|(?:^|[\s,，、])女(?:$|[\s,，、])|\bfemale\b|\bgirl\b|\bwoman\b/iu,
    ),
    entry(
      "male",
      /男主|男性|男生|男孩|少年|男子|男の子|(?:^|[\s,，、])男(?:$|[\s,，、])|\bmale\b|\bboy\b|\bman\b/iu,
    ),
    entry("nonbinary", /非二元|中性|无性别|無性別|non[- ]?binary|agender/iu),
  ],
  apparentAges: [
    entry("child", /幼女|幼童|儿童|兒童|小孩|子供|child|kid/iu),
    entry("teen", /青少年|少年|少女|十几岁|十幾歲|teen(?:ager)?/iu),
    entry("adult", /成年人|成人|大人|adult/iu),
    entry("senior", /老人|老年|高齢|senior|elderly/iu),
    entry("ageless", /不老|无年龄|無年齡|ageless/iu),
  ],
  clothing: [
    entry("school_uniform", /校服|制服|セーラー服|school uniform/iu),
    entry("maid", /女仆装|女僕裝|メイド服|maid (?:outfit|uniform|dress)/iu),
    entry("armor", /盔甲|铠甲|鎧|甲冑|armou?r/iu),
    entry("military_uniform", /军装|軍裝|军服|軍服|military uniform/iu),
    entry("kimono", /和服|着物|kimono/iu),
    entry("glasses", /眼镜|眼鏡|メガネ|glasses|spectacles/iu),
  ],
  traits: [
    entry(
      "expressionless",
      /面无表情|面無表情|无表情|無表情|没.{0,8}表情|沒有.{0,8}表情|表情.{0,4}(?:少|淡)|感情表达.{0,4}(?:少|弱)|無感情|無表情|expressionless|emotionless|deadpan|stoic/iu,
    ),
  ],
};

const FIELD_LABELS: Record<AppearanceField, string> = {
  hairColors: "hair_color",
  eyeColors: "eye_color",
  hairStyles: "hair_style",
  genders: "gender",
  apparentAges: "apparent_age",
  clothing: "clothing",
  traits: "trait",
};

const COMPATIBLE = new Map([
  ["hairColors:white", new Set(["white", "silver"])],
  ["hairColors:silver", new Set(["silver", "white"])],
]);

export function parseAppearanceText(text: string): CharacterAppearance {
  const normalized = text.normalize("NFKC");
  const result = emptyAppearance();
  for (const field of appearanceFields()) {
    for (const item of VOCABULARY[field]) {
      if (item.patterns.some((pattern) => pattern.test(normalized))) result[field].push(item.value);
    }
  }
  if (result.hairStyles.includes("twintails")) {
    result.hairStyles = result.hairStyles.filter((item) => item !== "ponytail");
  }
  return result;
}

export function scoreAppearanceMatch(
  query: CharacterAppearance,
  candidate: CharacterAppearance,
): AppearanceMatch {
  const matched: string[] = [];
  const missing: string[] = [];
  for (const field of appearanceFields()) {
    if (query[field].length === 0) continue;
    const label = `${FIELD_LABELS[field]}:${query[field][0]}`;
    const isMatch = query[field].some((requested) =>
      candidate[field].some((actual) => appearanceValuesMatch(field, requested, actual)),
    );
    (isMatch ? matched : missing).push(label);
  }
  const total = matched.length + missing.length;
  return {
    score: total ? Number((matched.length / total).toFixed(4)) : 0,
    matched,
    missing,
  };
}

export function hasAppearanceFacts(value: CharacterAppearance): boolean {
  return appearanceFields().some((field) => value[field].length > 0);
}

export function normalizeAppearance(
  value: Partial<CharacterAppearance> | undefined,
): CharacterAppearance {
  const normalized = emptyAppearance();
  if (!value) return normalized;
  for (const field of appearanceFields()) {
    const items = value[field];
    if (!Array.isArray(items)) continue;
    normalized[field] = [...new Set(
      items
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.normalize("NFKC").trim())
        .filter(Boolean),
    )];
  }
  return normalized;
}

export function parseAppearanceInput(
  value: unknown,
  label = "appearance",
): CharacterAppearance {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const fields = appearanceFields();
  const unknown = Object.keys(record).find(
    (field) => !fields.includes(field as AppearanceField),
  );
  if (unknown) throw new Error(`${label}.${unknown} is not a supported field`);
  for (const field of fields) {
    const items = record[field];
    if (items === undefined) continue;
    if (!Array.isArray(items) || items.some((item) => typeof item !== "string")) {
      throw new Error(`${label}.${field} must be an array of strings`);
    }
  }
  return normalizeAppearance(record as Partial<CharacterAppearance>);
}

export const CHARACTER_APPEARANCE_OPTIONS: Record<AppearanceField, readonly string[]> =
  Object.fromEntries(
    appearanceFields().map((field) => [field, VOCABULARY[field].map((item) => item.value)]),
  ) as unknown as Record<AppearanceField, readonly string[]>;

export function expandAppearanceValues(
  field: AppearanceField,
  values: string[],
): string[] {
  return [...new Set(values.flatMap((value) => [
    value,
    ...(COMPATIBLE.get(`${field}:${value}`) ?? []),
  ]))];
}

export function emptyAppearance(): CharacterAppearance {
  return {
    hairColors: [],
    eyeColors: [],
    hairStyles: [],
    genders: [],
    apparentAges: [],
    clothing: [],
    traits: [],
  };
}

function entry(value: string, ...patterns: RegExp[]): VocabularyEntry {
  return { value, patterns };
}

function appearanceFields(): AppearanceField[] {
  return [
    "hairColors",
    "eyeColors",
    "hairStyles",
    "genders",
    "apparentAges",
    "clothing",
    "traits",
  ];
}

function appearanceValuesMatch(field: AppearanceField, requested: string, actual: string): boolean {
  if (requested === actual) return true;
  return COMPATIBLE.get(`${field}:${requested}`)?.has(actual) ?? false;
}
