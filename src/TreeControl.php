<?php

declare(strict_types=1);

namespace Phlox\Components\Tree;

use Nette\Application\UI\Control;
use Nette\Database\Table\Selection;

class TreeControl extends Control
{
    // ── Theme constants ───────────────────────────────────────────────────────

    public const THEME_DEFAULT   = 'default';
    public const THEME_BOOTSTRAP = 'bootstrap';

    // ── Persistent state ──────────────────────────────────────────────────────

    /** @persistent */
    public string $expanded = '';

    // ── Configuration ─────────────────────────────────────────────────────────

    private Selection $dataSource;

    private string  $idColumn             = 'id';
    private string  $parentColumn         = 'parent_id';
    private string  $labelColumn          = 'name';
    private ?string $iconColumn           = null;
    private ?string $branchIcon           = null;
    private ?string $leafIcon             = null;
    private ?string $rootIcon             = null;
    private ?string $disabledColumn       = null;
    private ?string $childrenCountColumn  = null;
    private array   $dataColumns          = [];

    private bool    $dragAndDrop  = false;
    private bool    $checkboxes   = false;
    private bool    $lazyLoad     = true;
    private bool    $animation    = true;
    private bool    $treeLines    = false;
    private string  $cssClass     = '';

    private int|string|null $selectedNode = null;
    private ?string $urlParam             = null;
    private ?string $urlPattern           = null;

    /** @var string|array<string,string> */
    private string|array $theme = self::THEME_DEFAULT;

    /** POST endpoint for server-side move persistence (optional).
     *  When set, JS will POST {dragId, targetId, position} here after DnD.
     *  Non-2xx response triggers automatic DOM rollback. */
    private ?string $moveUrl = null;

    private ?\Closure $queryModifier = null;

    // ── Events ────────────────────────────────────────────────────────────────

    /** @var array<callable(TreeControl, int|string): void> */
    public array $onExpand   = [];
    /** @var array<callable(TreeControl, int|string): void> */
    public array $onCollapse = [];

    // ── Constructor ───────────────────────────────────────────────────────────

    public function __construct(Selection $dataSource)
    {
        $this->dataSource = $dataSource;
    }

    // ── Fluent API ────────────────────────────────────────────────────────────

    public function setDataSource(Selection $s): static        { $this->dataSource = $s; return $this; }
    public function setIdColumn(string $col): static           { $this->idColumn = $col; return $this; }
    public function setParentColumn(string $col): static       { $this->parentColumn = $col; return $this; }
    public function setLabelColumn(string $col): static        { $this->labelColumn = $col; return $this; }
    public function setIconColumn(string $col): static         { $this->iconColumn = $col; return $this; }
    public function setDisabledColumn(string $col): static     { $this->disabledColumn = $col; return $this; }
    public function setDataColumns(array $cols): static        { $this->dataColumns = $cols; return $this; }
    public function setDragAndDrop(bool $v = true): static     { $this->dragAndDrop = $v; return $this; }
    public function setCheckboxes(bool $v = true): static      { $this->checkboxes = $v; return $this; }
    public function setLazyLoad(bool $v = true): static        { $this->lazyLoad = $v; return $this; }
    public function setAnimation(bool $v = true): static       { $this->animation = $v; return $this; }
    public function setCssClass(string $cls): static           { $this->cssClass = $cls; return $this; }

    /**
     * HTML/SVG shown as icon for root-level nodes (parent is null).
     * Takes priority over branchIcon/leafIcon for top-level nodes.
     */
    public function setRootIcon(string $html): static
    {
        $this->rootIcon = $html;
        return $this;
    }

    /**
     * HTML/SVG shown as icon for nodes that HAVE children (branch icon).
     * Used when iconColumn is not set or empty for that node.
     */
    public function setBranchIcon(string $html): static
    {
        $this->branchIcon = $html;
        return $this;
    }

    /**
     * HTML/SVG shown as icon for leaf nodes (no children).
     */
    public function setLeafIcon(string $html): static
    {
        $this->leafIcon = $html;
        return $this;
    }

    /**
     * Name of a DB column that stores the pre-computed children count.
     * When set, no COUNT query is issued – value is read directly from the row.
     */
    public function setChildrenCountColumn(string $col): static
    {
        $this->childrenCountColumn = $col;
        return $this;
    }

    /**
     * Draw classic I/L/T tree connector lines between nodes.
     */
    public function setTreeLines(bool $enabled = true): static
    {
        $this->treeLines = $enabled;
        return $this;
    }

    /**
     * Modify the query before fetching nodes.
     * Callback: function(Selection $s, int|null $parentId): Selection
     */
    public function setQueryModifier(\Closure $modifier): static
    {
        $this->queryModifier = $modifier;
        return $this;
    }

    /**
     * Pre-select a node by ID on initial page load.
     * The tree will expand ancestor nodes as needed and mark the node selected.
     */
    public function setSelectedNode(int|string $id): static
    {
        $this->selectedNode = $id;
        return $this;
    }

    /**
     * URL query parameter that carries the selected node ID.
     * Back/forward navigation will automatically select and expand
     * the node whose ID matches the parameter value in the current URL.
     *
     * Example: $tree->setUrlParam('pageId')
     * Then /page/?pageId=42 selects node 42 on popstate.
     */
    public function setUrlParam(string $param): static
    {
        $this->urlParam = $param;
        return $this;
    }

    /**
     * URL path pattern with {id} placeholder for path-based routing.
     * Everything after {id} is ignored, so one pattern covers all sub-pages.
     *
     * Example: $tree->setUrlPattern('/page/{id}')
     * Matches: /page/42, /page/42/properties, /page/42/anything/deeper
     */
    public function setUrlPattern(string $pattern): static
    {
        $this->urlPattern = $pattern;
        return $this;
    }

    /**
     * Apply a visual theme to the tree.
     *
     * Built-in themes:
     *   TreeControl::THEME_DEFAULT   – uses built-in tree-control.css only
     *   TreeControl::THEME_BOOTSTRAP – applies Bootstrap 5 utility classes
     *
     * Custom theme (array of class overrides):
     *   $tree->setTheme([
     *       'row'         => 'd-flex align-items-center',
     *       'rowSelected' => 'active bg-primary-subtle',
     *       'toggle'      => 'btn btn-sm btn-link p-0 border-0 text-reset text-decoration-none',
     *       'label'       => 'ms-1',
     *   ])
     *
     * Supported keys: row, rowSelected, toggle, label
     *
     * @param string|array<string,string> $theme
     */
    public function setTheme(string|array $theme): static
    {
        $this->theme = $theme;
        return $this;
    }

    /**
     * POST endpoint for server-side drag & drop persistence.
     *
     * When set, JS will POST JSON {dragId, targetId, position} to this URL
     * after every successful drop. A 2xx response confirms the move; any other
     * status code triggers an automatic DOM rollback.
     *
     * If not set, only the nt:move JS event is dispatched — handle it yourself.
     *
     * Example: $tree->setMoveUrl($this->link('move!'))
     *          $tree->setMoveUrl('/api/tree/move')
     */
    public function setMoveUrl(string $url): static
    {
        $this->moveUrl = $url;
        return $this;
    }

    // ── Signals ───────────────────────────────────────────────────────────────

    /** @deprecated Kept for custom server-side expand hooks only. */
    public function handleExpand(string $nodeId): void
    {
        $this->onExpand($this, (int) $nodeId);
    }

    /** @deprecated Kept for custom server-side collapse hooks only. */
    public function handleCollapse(string $nodeId): void
    {
        $this->onCollapse($this, (int) $nodeId);
    }

    /**
     * Returns the ancestor ID path for a given node (root-first).
     * Used by JS to expand exactly the right nodes when selecting a node by ID.
     * E.g. for node 42 in hierarchy root→5→12→42 returns [5, 12]
     */
    public function handleAncestorPath(string $nodeId): void
    {
        $id   = (int) $nodeId;
        $path = [];

        $current = $id;
        $safety  = 100;
        while ($safety-- > 0) {
            $row = (clone $this->dataSource)
                ->where($this->idColumn, $current)
                ->fetch();
            if (!$row) break;
            $parent = $row[$this->parentColumn];
            if ($parent === null || $parent === 0 || $parent === '') break;
            array_unshift($path, (int) $parent);
            $current = (int) $parent;
        }

        $this->getPresenter()->sendJson($path);
    }

    public function handleLoadChildren(string $parentId): void
    {
        $pid      = ($parentId === '' || $parentId === '0') ? null : (int) $parentId;
        $rawNodes = $this->fetchNodes($pid);
        $counts   = $this->resolveChildCounts($rawNodes);
        $eIds     = $this->getExpandedIds();
        $total    = count($rawNodes);
        $result   = [];

        foreach (array_values($rawNodes) as $i => $node) {
            $id    = $node[$this->idColumn];
            $count = $counts[(string) $id] ?? 0;
            $item  = $this->nodeToArray($node, in_array((int) $id, $eIds, true), $count, $pid === null);
            $item['isLast']        = ($i === $total - 1);
            $item['ancestorFlags'] = [];
            $result[] = $item;
        }

        $this->getPresenter()->sendJson($result);
    }

    public function handleLoadChildrenBatch(string $parentIds): void
    {
        $ids    = array_filter(array_map('intval', explode(',', $parentIds)));
        $eIds   = $this->getExpandedIds();
        $result = [];

        foreach ($ids as $pid) {
            $rawPid   = $pid === 0 ? null : $pid;
            $rows     = $this->fetchNodes($rawPid);
            $counts   = $this->resolveChildCounts($rows);
            $total    = count($rows);

            if ($total > 0) {
                $children = [];
                foreach (array_values($rows) as $i => $node) {
                    $id    = $node[$this->idColumn];
                    $count = $counts[(string) $id] ?? 0;
                    $item  = $this->nodeToArray($node, in_array((int) $id, $eIds, true), $count, $rawPid === null);
                    $item['isLast']        = ($i === $total - 1);
                    $item['ancestorFlags'] = [];
                    $children[] = $item;
                }
                $result[(string) $pid] = $children;
            }
        }

        $this->getPresenter()->sendJson($result);
    }

    // ── Data helpers ──────────────────────────────────────────────────────────

    private function fetchNodes(mixed $parentId): array
    {
        $selection = clone $this->dataSource;

        if ($parentId === null) {
            $selection->where("{$this->parentColumn} IS NULL");
        } else {
            $selection->where($this->parentColumn, $parentId);
        }

        if ($this->queryModifier !== null) {
            $selection = ($this->queryModifier)($selection, $parentId);
        }

        return $selection->fetchAll();
    }

    private function resolveChildCounts(array $nodes): array
    {
        if (empty($nodes)) return [];

        $ids = array_map(fn($n) => $n[$this->idColumn], $nodes);

        if ($this->childrenCountColumn !== null) {
            $counts = [];
            foreach ($nodes as $node) {
                $counts[(string) $node[$this->idColumn]] = (int) ($node[$this->childrenCountColumn] ?? 0);
            }
            return $counts;
        }

        $counts = array_fill_keys(array_map('strval', $ids), 0);
        $rows   = (clone $this->dataSource)
            ->select($this->parentColumn)
            ->where($this->parentColumn, $ids);

        foreach ($rows as $row) {
            $pid = (string) $row[$this->parentColumn];
            if (isset($counts[$pid])) $counts[$pid]++;
        }

        return $counts;
    }

    private function nodeToArray(mixed $node, bool $expanded, int $childCount = 0, bool $isRoot = false): array
    {
        $id          = $node[$this->idColumn];
        $hasChildren = $childCount > 0;

        $icon = null;
        if ($this->iconColumn !== null && !empty($node[$this->iconColumn])) {
            $icon = $node[$this->iconColumn];
        } elseif ($isRoot && $this->rootIcon !== null) {
            $icon = $this->rootIcon;
        } elseif ($hasChildren && $this->branchIcon !== null) {
            $icon = $this->branchIcon;
        } elseif (!$hasChildren && $this->leafIcon !== null) {
            $icon = $this->leafIcon;
        }

        $extra = [];
        foreach ($this->dataColumns as $col) {
            $extra[$col] = $node[$col] ?? null;
        }

        return [
            'id'          => $id,
            'label'       => $node[$this->labelColumn],
            'hasChildren' => $hasChildren,
            'expanded'    => $expanded,
            'icon'        => $icon,
            'disabled'    => $this->disabledColumn ? (bool) ($node[$this->disabledColumn] ?? false) : false,
            'data'        => $extra,
        ];
    }

    private function buildTree(mixed $parentId = null, array $ancestorFlags = []): array
    {
        $rawNodes = $this->fetchNodes($parentId);
        if (empty($rawNodes)) return [];

        $counts = $this->resolveChildCounts($rawNodes);
        $eIds   = $this->getExpandedIds();
        $total  = count($rawNodes);
        $result = [];

        foreach (array_values($rawNodes) as $i => $node) {
            $id     = $node[$this->idColumn];
            $isLast = ($i === $total - 1);
            $isExp  = in_array((int) $id, $eIds, true);
            $count  = $counts[(string) $id] ?? 0;

            $item                  = $this->nodeToArray($node, $isExp, $count, $parentId === null);
            $item['isLast']        = $isLast;
            $item['ancestorFlags'] = $ancestorFlags;
            $item['children']      = [];

            if ($isExp && $item['hasChildren']) {
                if ($this->lazyLoad) {
                    $item['lazyLoaded'] = false;
                } else {
                    $item['children'] = $this->buildTree($id, [...$ancestorFlags, $isLast]);
                }
            }

            $result[] = $item;
        }

        return $result;
    }

    private function getExpandedIds(): array
    {
        return $this->expanded === ''
            ? []
            : array_map('intval', array_filter(explode(',', $this->expanded)));
    }

    // ── Theme resolution ──────────────────────────────────────────────────────

    private function resolveThemeJson(): string
    {
        $bootstrap = [
            'row'         => '',
            'rowSelected' => 'active',
            'toggle'      => 'btn btn-sm btn-link p-0 border-0 text-reset text-decoration-none',
            'label'       => '',
        ];

        if ($this->theme === self::THEME_BOOTSTRAP) {
            return json_encode($bootstrap, JSON_THROW_ON_ERROR);
        }

        if (is_array($this->theme)) {
            return json_encode($this->theme, JSON_THROW_ON_ERROR);
        }

        return '{}';
    }

    // ── Rendering ─────────────────────────────────────────────────────────────

    public function render(): void
    {
        $template = $this->getTemplate();
        $template->setFile(__DIR__ . '/TreeControl.latte');

        $extraClass = '';
        if ($this->treeLines) $extraClass .= ' phlox-tree--lines';
        if ($this->cssClass)  $extraClass .= ' ' . $this->cssClass;

        $template->nodes       = $this->buildTree();
        $template->dragAndDrop = $this->dragAndDrop;
        $template->checkboxes  = $this->checkboxes;
        $template->lazyLoad    = $this->lazyLoad;
        $template->animation   = $this->animation;
        $template->treeLines   = $this->treeLines;
        $template->componentId = 'phlox-tree-' . $this->getUniqueId();
        $template->cssClass    = ltrim($extraClass);
        $template->branchIcon  = $this->branchIcon ?? '';
        $template->leafIcon    = $this->leafIcon   ?? '';
        $template->rootIcon    = $this->rootIcon   ?? '';
        $template->selectedNode = $this->selectedNode !== null ? (string) $this->selectedNode : '';
        $template->urlParam    = $this->urlParam    ?? '';
        $template->urlPattern  = $this->urlPattern  ?? '';
        $template->moveUrl     = $this->moveUrl     ?? '';
        $template->themeJson   = $this->resolveThemeJson();

        $template->signalLoadChildren      = $this->link('loadChildren!',       ['parentId'  => '__ID__']);
        $template->signalLoadChildrenBatch = $this->link('loadChildrenBatch!',  ['parentIds' => '__IDS__']);
        $template->signalAncestorPath      = $this->link('ancestorPath!',       ['nodeId'    => '__ID__']);

        $template->render();
    }
}
