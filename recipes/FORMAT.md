# Recipes app: file format

The Recipes app opens a recipe from plain JSON. Anything that follows this format can be pasted into the app (Add, then Paste a recipe), opened as a `.json` file, or added to `library.json`.

## One recipe

```json
{
  "format": "goobs-recipe",
  "version": 1,
  "id": "chocolate-chip-cookies",
  "title": "Chocolate Chip Cookies",
  "description": "One sentence.",
  "category": "Baking",
  "tags": ["cookies", "kid-friendly"],
  "servings": 24,
  "servingsLabel": "cookies",
  "prepMin": 15,
  "cookMin": 11,
  "equipment": ["Baking sheets"],
  "ingredients": [
    { "id": "flour", "qty": 2.25, "unit": "cup", "name": "all-purpose flour" },
    { "id": "butter", "qty": 1, "unit": "cup", "name": "butter", "note": "softened" },
    { "id": "eggs", "qty": 2, "name": "large eggs" },
    { "id": "salt", "name": "salt", "note": "to taste" }
  ],
  "steps": [
    { "text": "Whisk {flour} with the salt." },
    { "title": "Bake", "text": "Bake 9-11 minutes until golden." }
  ],
  "notes": "Optional.",
  "source": "Optional",
  "sourceUrl": "https://example.com"
}
```

## Rules

- **Required:** `title`, and at least one ingredient or step. Everything else is optional.
- **id:** lowercase letters, digits and dashes, unique per recipe. The same id means "the same recipe" (importing it again offers Replace or Keep both).
- **category:** the app shows tabs for Main dish, Sides and Baking, so use those for most recipes (so a roast chicken plus a side can be mixed into a meal). One of Breakfast, Main dish, Sides, Soup & stew, Salad, Appetizer, Sauce & condiment, Bread, Baking, Dessert, Drink, Other.
- **ingredients:** `qty` is a number (decimals like 2.25 are fine and show as 2 ¼). Leave `qty` out for "to taste". `qtyMax` makes a range (2 to 3). `unit` is one of tsp, tbsp, cup, fl oz, oz, lb, g, kg, ml, l, pinch, dash, clove, can, stick, slice, bunch, sprig, package; leave it out for counted things (`"qty": 2, "name": "large eggs"`). Use `group` (for example "Dough", "Icing") to split the list into sections. Give each ingredient a short unique `id`.
- **as (optional, on an ingredient):** what to count it as for nutrition when the name is unusual, for example `{ "qty": 8, "unit": "oz", "name": "Grandma's noodles", "as": "egg noodles" }`. The Nutrition tab lists anything it couldn't match.
- **Nutrition:** worked out on the phone from the ingredient list (USDA data plus product labels for brands like Better Than Bouillon or Impastable). Ingredients with no amount, marked `optional` (unless "optional but recommended"), marked "for the boiling water" or "removed before serving", or used only in the boiling water are not counted. Weights or the usual units (cup, tbsp, tsp, oz, lb, g, clove, can…) work best.
- **steps:** `text` is one action. `{id}` in the text shows that ingredient's amount, scaled to the servings chosen (`{butter}` shows "1 cup butter"). `title` is optional. Times written in the text ("10 minutes", "1 hour") get a timer button automatically; add `"timer": 600` (seconds) to force one.
- **Many recipes at once:** use `{"format": "goobs-recipe-library", "version": 1, "recipes": [ ... ]}` or a plain JSON array.
- Plain text also works (title, "Serves 4", an Ingredients heading, an Instructions heading), but the JSON is more reliable.

## Where recipes live

- **`recipes/library/<id>.json`: one file per recipe (the normal way).** Upload a recipe file there and the app shows it the next time it opens (GitHub Pages takes a minute or two to publish). The app finds the files through the public GitHub API, so this works when the app is opened from `<owner>.github.io/<repo>/recipes/`. A file can hold one recipe, a library (`goobs-recipe-library`) or an array. Uploading a file with the same name replaces that recipe; a recipe file wins over the same id in `library.json`.
- `recipes/library.json` is the older single-file library and still works. Both are public, like the rest of the repo.
- Recipes added inside the app stay on that phone until you export them (Backup & library, then Export library file) and upload the result.
