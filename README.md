# phloxcz/components-tree

Nette Framework TreeControl component. Lazy AJAX loading, drag & drop, keyboard navigation, zero hardcoded colors.

```bash
composer require phloxcz/components-tree
```

## Quick start

**Registrace** v `config.neon`:

```neon
extensions:
    tree: Phlox\Components\Tree\DI\TreeExtension
```

**Presenter:**

```php
use Phlox\Components\Tree\TreeControl;
use Phlox\Components\Tree\TreeControlFactory;

protected function createComponentCategoryTree(): TreeControl
{
    return $this->treeFactory
        ->create($this->db->table('categories'))
        ->setLabelColumn('name')
        ->setTreeLines()
        ->setDragAndDrop()
        ->setMoveUrl($this->link('move!'))
        ->setUrlPattern('/admin/categories/{id}');
}
```

**Šablona:**

```latte
{control categoryTree}
```

**Assets:**

```html
<link rel="stylesheet" href="vendor/phloxcz/components-tree/assets/tree-control.css">
<script src="vendor/phloxcz/components-tree/assets/tree-control.js" defer></script>
```

**JS events:**

```js
document.addEventListener('pt:select', e => {
    const { id, data } = e.detail;
    naja.makeRequest('GET', `/admin/categories/${id}`);
});

document.addEventListener('pt:move', e => {
    const { dragId, targetId, position, rollback } = e.detail;
    // rollback() plně vrátí DOM při chybě
});
```

## Dokumentace

Kompletní dokumentace je v [`docs/README.md`](docs/README.md).

## Licence

[MIT](LICENSE)
