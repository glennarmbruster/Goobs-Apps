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
- **category:** one of Breakfast, Main dish, Side, Soup & stew, Salad, Appetizer, Sauce & condiment, Bread, Baking, Dessert, Drink, Other.
- **ingredients:** `qty` is a number (decimals like 2.25 are fine and show as 2 ¼). Leave `qty` out for "to taste". `qtyMax` makes a range (2 to 3). `unit` is one of tsp, tbsp, cup, fl oz, oz, lb, g, kg, ml, l, pinch, dash, clove, can, stick, slice, bunch, sprig, package; leave it out for counted things (`"qty": 2, "name": "large eggs"`). Use `group` (for example "Dough", "Icing") to split the list into sections. Give each ingredient a short unique `id`.
- **steps:** `text` is one action. `{id}` in the text shows that ingredient's amount, scaled to the servings chosen (`{butter}` shows "1 cup butter"). `title` is optional. Times written in the text ("10 minutes", "1 hour") get a timer button automatically; add `"timer": 600` (seconds) to force one.
- **Many recipes at once:** use `{"format": "goobs-recipe-library", "version": 1, "recipes": [ ... ]}` or a plain JSON array.
- Plain text also works (title, "Serves 4", an Ingredients heading, an Instructions heading), but the JSON is more reliable.

## Where recipes live

- `recipes/library.json` in this repo is the shared library. Everyone who opens the app sees it. It is public, like the rest of the repo.
- Recipes added inside the app stay on that phone until you export them (Backup & library, then Export library file) and upload the result as `recipes/library.json`.
