// What each stored kind is called on screen. "product" stays the stored id
// (job records and asset.json use it); people call it a prop.
export const KIND_LABEL: Record<string, string> = { character: "Character", location: "Location", product: "Prop", style: "Style" };
export const KIND_PLURAL: Record<string, string> = { character: "Characters", location: "Locations", product: "Props", style: "Styles" };
/** Tab and switch order. */
export const KIND_ORDER = ["character", "location", "product", "style"];
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k;
