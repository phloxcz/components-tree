# phlox/components-tree

Nette Framework Tree UI component. Lazy AJAX loading, drag & drop s automatickým rollbackem, klávesová navigace, podpora Bootstrap 5 a libovolného CSS frameworku.

---

## Obsah

- [Instalace](#instalace)
- [Registrace](#registrace)
- [Základní použití](#základní-použití)
- [Konfigurace](#konfigurace)
  - [Databázové sloupce](#databázové-sloupce)
  - [Ikony](#ikony)
  - [Chování](#chování)
  - [Výběr uzlu](#výběr-uzlu)
  - [Navigace zpět/vpřed](#navigace-zpětvpřed)
  - [Drag & Drop](#drag--drop)
  - [Téma a stylování](#téma-a-stylování)
- [JavaScript events](#javascript-events)
- [JavaScript API](#javascript-api)
- [CSS proměnné](#css-proměnné)
- [Databázové schéma](#databázové-schéma)
- [Pokročilé použití](#pokročilé-použití)

---

## Instalace

```bash
composer require phlox/components-tree
```

Do stránky zahrňte assets:

```html
<link rel="stylesheet" href="vendor/phlox/components-tree/assets/tree-control.css">
<script src="vendor/phlox/components-tree/assets/tree-control.js" defer></script>
```

Nebo přes npm / webpack – soubory jsou v `assets/`.

---

## Registrace

V `config.neon`:

```neon
extensions:
    tree: Phlox\Components\Tree\DI\TreeExtension
```

---

## Základní použití

### Presenter

```php
use Phlox\Components\Tree\TreeControl;
use Phlox\Components\Tree\TreeControlFactory;

class PagePresenter extends Nette\Application\UI\Presenter
{
    public function __construct(
        private TreeControlFactory $treeFactory,
        private Nette\Database\Explorer $db,
    ) {}

    protected function createComponentCategoryTree(): TreeControl
    {
        return $this->treeFactory
            ->create($this->db->table('categories'))
            ->setLabelColumn('name');
    }
}
```

### Šablona

```latte
{control categoryTree}
```

---

## Konfigurace

Všechny settery jsou fluent a lze je řetězit.

### Databázové sloupce

| Metoda | Výchozí | Popis |
|--------|---------|-------|
| `setIdColumn(string)` | `'id'` | Sloupec primárního klíče |
| `setParentColumn(string)` | `'parent_id'` | Sloupec cizího klíče na rodiče (`NULL` = kořen) |
| `setLabelColumn(string)` | `'name'` | Sloupec s popiskem uzlu |
| `setDisabledColumn(string)` | `null` | Bool sloupec – disabled uzly nejsou klikatelné ani přetahovatelné |
| `setChildrenCountColumn(string)` | `null` | Denormalizovaný počet dětí – eliminuje COUNT dotazy |
| `setDataColumns(array)` | `[]` | Sloupce přidané jako `data-*` atributy na `<li>` |
| `setIconColumn(string)` | `null` | Sloupec s HTML/SVG ikonou per-řádek (nejvyšší priorita) |

**Tip:** `setChildrenCountColumn` je velká optimalizace pro stromy s tisíci uzly. Udržujte sloupec triggerem nebo v aplikační vrstvě.

```php
->setIdColumn('id')
->setParentColumn('parent_id')
->setLabelColumn('title')
->setChildrenCountColumn('children_count')
->setDataColumns(['slug', 'type'])   // přístupné v JS jako item.dataset.slug
```

### Ikony

Ikony se předávají jako libovolné HTML nebo SVG. Priority:

1. `iconColumn` – per-řádek z DB (nejvyšší)
2. `rootIcon` – uzly na kořenové úrovni (parent = NULL)
3. `branchIcon` – uzly s dětmi
4. `leafIcon` – uzly bez dětí

```php
->setRootIcon('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>')
->setBranchIcon('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>')
->setLeafIcon('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>')
```

### Chování

| Metoda | Výchozí | Popis |
|--------|---------|-------|
| `setLazyLoad(bool)` | `true` | Načítání dětí až při rozbalení |
| `setAnimation(bool)` | `true` | Animace rozbalování/sbalování |
| `setTreeLines(bool)` | `false` | Klasické I/L/T spojovací čáry + rámeček kolem expand tlačítka |
| `setDragAndDrop(bool)` | `false` | Přetahování uzlů |
| `setCheckboxes(bool)` | `false` | Zobrazení checkboxů |
| `setCssClass(string)` | `''` | Extra CSS třída na kořenový `<div>` |
| `setQueryModifier(Closure)` | `null` | Úprava dotazu před načtením uzlů |

```php
->setLazyLoad()
->setTreeLines()
->setDragAndDrop()
->setQueryModifier(function (Selection $s, mixed $parentId): Selection {
    return $s->where('active', 1)->order('sort_order');
})
```

### Výběr uzlu

`setSelectedNode` slouží pro **první načtení stránky** – typicky když URL obsahuje ID záznamu. Strom automaticky rozbalí cestu k uzlu a označí ho.

```php
protected function createComponentCategoryTree(): TreeControl
{
    return $this->treeFactory
        ->create($this->db->table('categories'))
        ->setLabelColumn('name')
        ->setSelectedNode($this->categoryId);  // ID z URL parametru
}
```

### Navigace zpět/vpřed

Pro správné obnovení výběru při použití tlačítek zpět/vpřed prohlížeče nastavte, **odkud má JS přečíst ID uzlu z URL**. Použijte jednu z metod:

#### Query parametr

```php
// URL: /page/?pageId=42
->setUrlParam('pageId')
```

#### Path pattern

```php
// URL: /page/42  nebo  /page/42/properties  nebo  /page/42/cokoli/dalsiho
->setUrlPattern('/page/{id}')
```

Vše za `{id}` je ignorováno – jeden pattern pokryje všechny sub-stránky uzlu.

> **Pozor:** `setUrlParam` / `setUrlPattern` a `setSelectedNode` se nevylučují. `setSelectedNode` vyhraje při prvním načtení (F5, sdílené URL). URL metody slouží výhradně pro back/forward navigaci.

### Drag & Drop

#### Pouze JS event (bez serveru)

```php
->setDragAndDrop()
```

```js
document.addEventListener('pt:move', e => {
    const { dragId, targetId, position, rollback } = e.detail;
    // position: 'before' | 'after' | 'child'

    fetch('/api/categories/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dragId, targetId, position }),
    }).catch(() => rollback());
});
```

#### Automatický POST na server

Pokud předáte URL, strom sám odešle POST a při non-2xx odpovědi provede rollback DOM:

```php
->setDragAndDrop()
->setMoveUrl($this->link('move!'))
```

```php
public function handleMove(): void
{
    $data = json_decode(file_get_contents('php://input'), true);

    $this->db->table('categories')
        ->where('id', $data['dragId'])
        ->update(['parent_id' => $data['position'] === 'child' ? $data['targetId'] : /* ... */ ]);

    $this->sendJson(['ok' => true]);
    // Libovolná non-2xx odpověď způsobí rollback v prohlížeči
}
```

`pt:move` event se dispatchuje vždy (i při `setMoveUrl`), takže JS listener funguje paralelně pro případné UI aktualizace.

**Rollback** je plný – zahrnuje obnovu leaf↔branch přechodů a ikon.

**Potlačené dropy** (neodešlou event ani POST):
- Uzel přetažen na stejné místo
- Uzel přetažen do vlastního přímého rodiče

### Téma a stylování

#### Výchozí téma

CSS komponenty neobsahuje žádné pevné barvy – vše dědí z `currentColor` okolního frameworku. Dark mode funguje automaticky.

#### Bootstrap 5

```php
use Phlox\Components\Tree\TreeControl;

->setTheme(TreeControl::THEME_BOOTSTRAP)
```

Aplikuje Bootstrap utility třídy na toggle button (`btn btn-sm btn-link …`) a selected stav (`active`).

#### Custom téma

```php
->setTheme([
    'row'         => 'd-flex align-items-center',   // přidáno na .pt-row
    'rowSelected' => 'active bg-primary-subtle',    // přidáno na .pt-row při is-selected
    'toggle'      => 'btn btn-sm btn-link p-0 border-0 text-reset text-decoration-none',
    'label'       => 'ms-1',
])
```

Podporované klíče: `row`, `rowSelected`, `toggle`, `label`.

#### CSS proměnné

Layout (ne barvy) lze přepsat CSS proměnnými:

```css
.phlox-tree {
    --pt-font-size     : 0.8125rem;
    --pt-row-height    : 28px;
    --pt-indent-width  : 18px;
    --pt-radius        : 4px;
    --pt-anim-duration : 120ms;
}
```

---

## JavaScript events

Oba eventy bublají (`bubbles: true`) ze stromu nahoru, takže stačí jeden listener na `document`.

### `pt:select`

Spuštěn po kliknutí na uzel (nebo po výběru klávesnicí).

```js
document.addEventListener('pt:select', e => {
    const { id, item, data } = e.detail;
    // id   – string, hodnota data-id
    // item – HTMLElement, kliknutý <li>
    // data – objekt všech data-* atributů uzlu (data-slug, data-type, …)

    // Typické použití: AJAX navigace
    naja.makeRequest('GET', `/category/${id}`);
});
```

### `pt:move`

Spuštěn po úspěšném přetažení uzlu (před serverovým voláním, pokud je nastaveno `setMoveUrl`).

```js
document.addEventListener('pt:move', e => {
    const { dragId, targetId, position, rollback } = e.detail;
    // dragId   – string, ID přetaženého uzlu
    // targetId – string, ID cílového uzlu
    // position – 'before' | 'after' | 'child'
    // rollback – funkce, vrátí DOM do původního stavu
});
```

---

## JavaScript API

Globální objekt `PhloxTree` (nebo CommonJS export):

```js
// Ruční inicializace (při dynamickém vložení stromu do DOM)
PhloxTree.init();
PhloxTree.initTree(document.getElementById('phlox-tree-myTree'));

// Programatické rozbalení / sbalení uzlu
PhloxTree.expand('phlox-tree-myTree', '42');
PhloxTree.collapse('phlox-tree-myTree', '42');

// Programatický výběr uzlu
PhloxTree.select('phlox-tree-myTree', '42');

// Vymazání uloženého stavu rozbalení (localStorage)
PhloxTree.clearState('phlox-tree-myTree');
```

ID stromu (`phlox-tree-myTree`) odpovídá Nette komponentě – pokud se presenter jmenuje `default` a komponenta `categoryTree`, ID bude `phlox-tree-categoryTree`.

---

## CSS proměnné

| Proměnná | Výchozí | Popis |
|----------|---------|-------|
| `--pt-font-size` | `0.875rem` | Velikost písma |
| `--pt-row-height` | `32px` | Výška řádku uzlu |
| `--pt-indent-width` | `26px` | Šířka kroku odsazení na úroveň |
| `--pt-line-x` | `32px` | Horizontální pozice spojovacích čar uvnitř indent/connector spanu |
| `--pt-line-overhang` | `20px` | O kolik pixelů přesahuje horizontální čára doprava za connector span |
| `--pt-radius` | `5px` | Zaoblení rohů hover/selected pozadí |
| `--pt-anim-duration` | `180ms` | Délka animací |

> `--pt-line-x` a `--pt-line-overhang` se uplatňují pouze při zapnutém `setTreeLines()`. Hodnotu `--pt-line-x` nastavte tak, aby čáry vizuálně vycházely ze středu ikon nadřazené úrovně.

```css
/* Příklad pro 24px ikony */
.phlox-tree {
    --pt-indent-width : 32px;
    --pt-line-x       : 38px;
    --pt-line-overhang: 20px;
}
```

---

## Databázové schéma

Minimální schéma pro hierarchickou tabulku:

```sql
CREATE TABLE categories (
    id        INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    parent_id INT UNSIGNED NULL REFERENCES categories(id) ON DELETE CASCADE,
    name      VARCHAR(255) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
);

-- Volitelně: denormalizovaný počet dětí (eliminuje COUNT dotazy)
ALTER TABLE categories ADD COLUMN children_count INT UNSIGNED NOT NULL DEFAULT 0;

CREATE TRIGGER trg_cat_insert AFTER INSERT ON categories
FOR EACH ROW
    UPDATE categories SET children_count = children_count + 1
    WHERE id = NEW.parent_id;

CREATE TRIGGER trg_cat_delete AFTER DELETE ON categories
FOR EACH ROW
    UPDATE categories SET children_count = children_count - 1
    WHERE id = OLD.parent_id;
```

---

## Pokročilé použití

### Kompletní příklad s Bootstrap 5

```php
protected function createComponentPageTree(): TreeControl
{
    return $this->treeFactory
        ->create($this->db->table('pages'))
        ->setLabelColumn('title')
        ->setParentColumn('parent_id')
        ->setChildrenCountColumn('children_count')
        ->setDataColumns(['slug', 'status'])
        ->setRootIcon('<svg>…</svg>')
        ->setBranchIcon('<svg>…</svg>')
        ->setLeafIcon('<svg>…</svg>')
        ->setTreeLines()
        ->setDragAndDrop()
        ->setMoveUrl($this->link('moveNode!'))
        ->setUrlPattern('/admin/pages/{id}')
        ->setSelectedNode($this->pageId)
        ->setTheme(TreeControl::THEME_BOOTSTRAP)
        ->setQueryModifier(fn($s) => $s->order('sort_order, title'));
}

public function handleMoveNode(): void
{
    $data = json_decode(file_get_contents('php://input'), true);
    // … logika přesunu …
    $this->sendJson(['ok' => true]);
}
```

### Více stromů na jedné stránce

```php
protected function createComponentCategoryTree(): TreeControl { … }
protected function createComponentTagTree(): TreeControl { … }
```

```latte
<div class="row">
    <div class="col-4">{control categoryTree}</div>
    <div class="col-8">{control tagTree}</div>
</div>
```

Každý strom má vlastní localStorage klíč a vlastní JS instanci – vzájemně se neovlivňují.

### Filtrování uzlů přes queryModifier

```php
->setQueryModifier(function (Selection $s, mixed $parentId): Selection {
    // $parentId = null pro kořen, int pro konkrétního rodiče
    return $s
        ->where('active', 1)
        ->where('type != ?', 'archived')
        ->order('sort_order ASC, name ASC');
})
```

### Reload stromu po AJAX akci

```js
// Po přidání / smazání uzlu přes AJAX:
naja.addEventListener('success', () => {
    PhloxTree.clearState('phlox-tree-categoryTree');
    PhloxTree.init();
});
```
