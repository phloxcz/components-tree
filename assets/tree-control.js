/**
 * Phlox TreeControl – client-side logic
 *
 * Part of phloxcz/components-tree
 * https://github.com/phloxcz/components-tree
 * MIT License
 */

(function (global) {
    'use strict';

    // ── Helpers ───────────────────────────────────────────────────────────────

    function buildUrl(template, replacements) {
        let url = template;
        for (const [key, val] of Object.entries(replacements)) {
            url = url.replaceAll(key, encodeURIComponent(val));
        }
        return url;
    }

    function animate(el, from, to, duration, onDone) {
        if (!duration) {
            el.style.transition = '';
            el.style.height = to === 0 ? '' : to + 'px';
            if (to === 0) el.style.display = 'none';
            onDone && onDone();
            return;
        }

        // Generation counter — if a new animation starts before onEnd fires,
        // the stale onEnd callback sees a mismatched generation and bails out.
        // This prevents the collapse-animation's onEnd from hiding content that
        // was just re-expanded by a rapid click.
        const gen = (el._animGen = (el._animGen || 0) + 1);

        el.style.transition = '';
        el.style.height     = from + 'px';
        el.style.overflow   = 'hidden';
        requestAnimationFrame(() => {
            if (el._animGen !== gen) return;
            el.style.transition = `height ${duration}ms cubic-bezier(0.4,0,0.2,1)`;
            el.style.height     = to + 'px';
            const onEnd = () => {
                el.removeEventListener('transitionend', onEnd);
                if (el._animGen !== gen) return; // superseded — do nothing
                el.style.transition = '';
                el.style.overflow   = '';
                if (to === 0) el.style.display = 'none';
                else          el.style.height  = '';
                onDone && onDone();
            };
            el.addEventListener('transitionend', onEnd);
        });
    }

    function getAnimDuration(tree) {
        return tree.dataset.animation === 'false' ? 0 : 180;
    }

    // ── Theme ─────────────────────────────────────────────────────────────────
    //
    // data-theme attribute contains a JSON object with class overrides.
    // Keys: row, rowSelected, toggle, label
    // Built-in themes are resolved in PHP; JS just reads the JSON.

    function getTheme(tree) {
        try { return JSON.parse(tree.dataset.theme || '{}'); } catch { return {}; }
    }

    /** Apply extra theme classes to a rendered .pt-row and its children */
    function applyThemeToRow(row, theme) {
        if (theme.row)    row.classList.add(...theme.row.split(' ').filter(Boolean));
        const toggle = row.querySelector('.pt-toggle:not(.pt-toggle--leaf)');
        if (toggle && theme.toggle) toggle.classList.add(...theme.toggle.split(' ').filter(Boolean));
        const label = row.querySelector('.pt-label');
        if (label && theme.label)   label.classList.add(...theme.label.split(' ').filter(Boolean));
    }

    /** Apply rowSelected theme class on selection / remove on deselection */
    function applyThemeSelected(tree, item, selected) {
        const theme = getTheme(tree);
        if (!theme.rowSelected) return;
        const row = item.querySelector(':scope > .pt-row');
        if (!row) return;
        theme.rowSelected.split(' ').filter(Boolean).forEach(cls => {
            row.classList.toggle(cls, selected);
        });
    }

    /** Apply theme to all existing SSR rows in the tree */
    function applyThemeToTree(tree) {
        const theme = getTheme(tree);
        if (!Object.keys(theme).length) return;
        tree.querySelectorAll('.pt-row').forEach(row => applyThemeToRow(row, theme));
    }

    // ── localStorage ─────────────────────────────────────────────────────────

    function lsKey(tree) { return 'phlox-tree:' + tree.id + ':expanded'; }

    function lsGetExpanded(tree) {
        try {
            const raw = localStorage.getItem(lsKey(tree));
            return raw ? new Set(raw.split(',').filter(Boolean)) : new Set();
        } catch { return new Set(); }
    }

    function lsSave(tree, ids) {
        try {
            if (ids.size === 0) localStorage.removeItem(lsKey(tree));
            else                localStorage.setItem(lsKey(tree), [...ids].join(','));
        } catch { /* storage blocked */ }
    }

    function lsMarkExpanded(tree, id)         { const s = lsGetExpanded(tree); s.add(String(id)); lsSave(tree, s); }
    function lsMarkCollapsed(tree, id, item)  {
        const s = lsGetExpanded(tree);
        s.delete(String(id));
        item?.querySelectorAll('.pt-item').forEach(el => s.delete(el.dataset.id));
        lsSave(tree, s);
    }

    // ── Depth / ancestor helpers ───────────────────────────────────────────────

    /** Count .pt-item ancestors of an .pt-item element → nesting depth (0 = root) */
    function getItemDepth(item) {
        let depth = 0;
        let el = item.parentElement?.closest('.pt-item');
        while (el) {
            depth++;
            el = el.parentElement?.closest('.pt-item');
        }
        return depth;
    }

    /**
     * For a .pt-children container already in the DOM, compute the array of
     * ancestor isLast flags.  Index 0 = root ancestor, last index = direct parent.
     * Used when lazy-loading children (server doesn't know ancestor context).
     */
    function computeAncestorFlags(container) {
        const flags = [];
        let item = container.closest('.pt-item');
        while (item) {
            const sibs = [...(item.parentElement?.children ?? [])]
                .filter(c => c.classList.contains('pt-item'));
            flags.unshift(sibs.indexOf(item) === sibs.length - 1);
            item = item.parentElement?.closest('.pt-children')?.closest('.pt-item');
        }
        return flags;
    }

    // ── Render children from JSON ──────────────────────────────────────────────

    function renderChildren(tree, container, nodes, explicitDepth = null) {
        const ul = document.createElement('ul');
        ul.className = 'pt-list';
        ul.setAttribute('role', 'group');

        const depth      = explicitDepth !== null ? explicitDepth : 0;
        const treeLines  = tree.classList.contains('phlox-tree--lines');
        const dnd        = tree.dataset.dragDrop === 'true';

        // For lazy-loaded nodes, server sends ancestorFlags=[] – compute from DOM.
        const domAncestorFlags = treeLines ? computeAncestorFlags(container) : [];

        nodes.forEach((node, i) => {
            // isLast: server provides it; compute as fallback
            const isLast = node.isLast !== undefined ? node.isLast : (i === nodes.length - 1);
            // ancestorFlags: use server value if non-empty, else DOM-computed
            const ancestorFlags = (node.ancestorFlags && node.ancestorFlags.length > 0)
                ? node.ancestorFlags
                : domAncestorFlags;

            ul.appendChild(renderNode(tree, { ...node, isLast, ancestorFlags }, depth, dnd, treeLines));
        });

        container.innerHTML = '';
        container.appendChild(ul);
        container.dataset.loaded = 'true';
    }

    function renderNode(tree, node, depth = 0, dnd, treeLines) {
        if (dnd       === undefined) dnd       = tree.dataset.dragDrop === 'true';
        if (treeLines === undefined) treeLines = tree.classList.contains('phlox-tree--lines');

        const li  = document.createElement('li');
        const cls = ['pt-item'];
        if (node.hasChildren) cls.push('has-children'); else cls.push('is-leaf');
        if (node.expanded)    cls.push('is-expanded');
        if (node.disabled)    cls.push('is-disabled');
        if (node.isLast)      cls.push('is-last');

        li.className           = cls.join(' ');
        li.dataset.id          = node.id;
        li.dataset.hasChildren = node.hasChildren ? '1' : '0';
        if (node.data) {
            for (const [k, v] of Object.entries(node.data)) li.dataset[k] = v;
        }
        li.setAttribute('role',          'treeitem');
        li.setAttribute('tabindex',      '0');
        li.setAttribute('aria-expanded', node.hasChildren ? String(node.expanded) : null);
        li.setAttribute('aria-selected', 'false');

        // ── Row (draggable here, not on li) ──
        const row = document.createElement('div');
        row.className = 'pt-row';
        if (dnd && !node.disabled) row.setAttribute('draggable', 'true');

        // Indent guides — skip ancestorFlags[0] (root has no connector, its isLast is irrelevant).
        // Use indices 1..depth-1: each maps to the ancestor who drew a connector at that column.
        const ancestorFlags = node.ancestorFlags || [];
        for (let i = 1; i < depth; i++) {
            const sp = document.createElement('span');
            sp.className = 'pt-indent';
            sp.setAttribute('aria-hidden', 'true');
            sp.dataset.hasLine = ancestorFlags[i] === true ? '0' : '1';
            row.appendChild(sp);
        }

        // Connector span (├─ / └─): always rendered for child nodes, visibility via CSS
        if (depth > 0) {
            const conn = document.createElement('span');
            conn.className = 'pt-connector' + (node.isLast ? ' pt-connector--last' : '');
            conn.setAttribute('aria-hidden', 'true');
            row.appendChild(conn);
        }

        // Toggle
        if (node.hasChildren) {
            const btn = document.createElement('button');
            btn.type      = 'button';
            btn.className = 'pt-toggle';
            btn.tabIndex  = -1;
            btn.setAttribute('aria-label', node.expanded ? 'Sbalit' : 'Rozbalit');
            btn.innerHTML = '<svg class="pt-toggle__icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            row.appendChild(btn);
        } else {
            const sp = document.createElement('span');
            sp.className = 'pt-toggle pt-toggle--leaf';
            row.appendChild(sp);
        }

        // Icon (resolved by server for SSR; mirrored here for lazy-loaded nodes)
        const rootIcon   = tree.dataset.rootIcon;
        const branchIcon = tree.dataset.branchIcon;
        const leafIcon   = tree.dataset.leafIcon;
        const resolvedIcon = node.icon
            || (depth === 0 && rootIcon   ? rootIcon   : null)
            || (node.hasChildren && branchIcon ? branchIcon : null)
            || (!node.hasChildren && leafIcon  ? leafIcon  : null);

        if (resolvedIcon) {
            const ic = document.createElement('span');
            ic.className = 'pt-icon';
            ic.innerHTML = resolvedIcon;
            row.appendChild(ic);
        }

        // Label
        const label = document.createElement('span');
        label.className   = 'pt-label';
        label.textContent = node.label;
        row.appendChild(label);

        li.appendChild(row);

        // Apply theme classes to the newly created row
        applyThemeToRow(row, getTheme(tree));

        // Children container
        const childDiv = document.createElement('div');
        childDiv.className      = 'pt-children';
        childDiv.dataset.loaded = 'false';
        if (!node.expanded) childDiv.style.display = 'none';
        li.appendChild(childDiv);

        if (node.expanded && node.children?.length) {
            renderChildren(tree, childDiv, node.children, depth + 1);
        }

        return li;
    }

    // ── Expand / Collapse ─────────────────────────────────────────────────────

    async function expandNode(tree, item) {
        if (item.classList.contains('is-disabled')) return;
        if (item.classList.contains('is-expanded'))  return;

        const id     = item.dataset.id;
        const toggle = item.querySelector(':scope > .pt-row .pt-toggle:not(.pt-toggle--leaf)');
        const dur    = getAnimDuration(tree);
        const isLazy = tree.dataset.lazy === 'true';

        // Ensure .pt-children container exists (may be missing for lazy nodes
        // that were never rendered server-side, e.g. during restoreExpandedState)
        let container = item.querySelector(':scope > .pt-children');
        if (!container) {
            container = document.createElement('div');
            container.className      = 'pt-children';
            container.dataset.loaded = 'false';
            container.style.display  = 'none';
            item.appendChild(container);
        }

        const loaded = container.dataset.loaded === 'true';

        if (isLazy && !loaded) {
            const spinner = document.createElement('span');
            spinner.className = 'pt-spinner';
            toggle && toggle.after(spinner);
            try {
                const url   = buildUrl(tree.dataset.signalLoadChildren, { '__ID__': id });
                const resp  = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
                const nodes = await resp.json();
                renderChildren(tree, container, nodes, getItemDepth(item) + 1);
            } catch (err) {
                console.error('[PhloxTree] Failed to load children', err);
                spinner.remove();
                return;
            }
            spinner.remove();
        }

        lsMarkExpanded(tree, id);

        item.classList.add('is-expanded');
        item.setAttribute('aria-expanded', 'true');
        toggle?.setAttribute('aria-label', 'Sbalit');

        if (container) {
            container.style.display = 'block';
            animate(container, 0, container.scrollHeight, dur);
        }
    }

    function collapseNode(tree, item) {
        if (!item.classList.contains('is-expanded')) return;

        const id        = item.dataset.id;
        const container = item.querySelector(':scope > .pt-children');
        const toggle    = item.querySelector(':scope > .pt-row .pt-toggle:not(.pt-toggle--leaf)');
        const dur       = getAnimDuration(tree);

        lsMarkCollapsed(tree, id, item);

        item.classList.remove('is-expanded');
        item.setAttribute('aria-expanded', 'false');
        toggle?.setAttribute('aria-label', 'Rozbalit');

        if (container) animate(container, container.scrollHeight, 0, dur);
    }

    /**
     * Restore expanded state from localStorage using a single batch request.
     *
     * Algorithm:
     *   1. Collect all expanded IDs from localStorage.
     *   2. Send one request to handleLoadChildrenBatch with all IDs at once.
     *      The server returns { parentId: [children], ... } for every ID.
     *   3. Walk the tree top-down, rendering children from the batch cache.
     *      No further network requests are needed.
     */
    async function restoreExpandedState(tree) {
        const ids = lsGetExpanded(tree);
        if (!ids.size) return;

        const batchUrl = tree.dataset.signalLoadChildrenBatch;
        if (!batchUrl) {
            // Fallback: sequential expand (old behaviour) if signal not available
            return restoreExpandedStateSequential(tree, ids);
        }

        // Always include '0' so the server can return root children if needed
        const allIds = ['0', ...[...ids]];
        const url    = buildUrl(batchUrl, { '__IDS__': allIds.join(',') });

        let batch;
        try {
            const resp = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            batch = await resp.json(); // { "parentId": [children], ... }
        } catch (err) {
            console.error('[PhloxTree] Batch load failed, falling back to sequential', err);
            return restoreExpandedStateSequential(tree, ids);
        }

        // Walk expanded IDs top-down (multi-pass so parents render before children)
        for (let pass = 0; pass < 20; pass++) {
            let any = false;
            for (const id of ids) {
                const item = tree.querySelector(`.pt-item[data-id="${id}"]`);
                if (!item || item.classList.contains('is-expanded')) continue;

                // Get children from batch cache
                const children = batch[String(id)];
                if (!children) continue; // server had no children for this id

                // Ensure container exists
                let container = item.querySelector(':scope > .pt-children');
                if (!container) {
                    container = document.createElement('div');
                    container.className      = 'pt-children';
                    container.dataset.loaded = 'false';
                    container.style.display  = 'none';
                    item.appendChild(container);
                }

                if (container.dataset.loaded !== 'true') {
                    renderChildren(tree, container, children, getItemDepth(item) + 1);
                }

                // Expand without animation (restoring state, not user interaction)
                item.classList.add('is-expanded');
                item.setAttribute('aria-expanded', 'true');
                item.querySelector(':scope > .pt-row .pt-toggle:not(.pt-toggle--leaf)')
                    ?.setAttribute('aria-label', 'Sbalit');
                container.style.display = 'block';

                any = true;
            }
            if (!any) break;
        }
    }

    /** Sequential fallback (used when batch signal is unavailable) */
    async function restoreExpandedStateSequential(tree, ids) {
        for (let pass = 0; pass < 20; pass++) {
            let any = false;
            for (const id of ids) {
                const item = tree.querySelector(`.pt-item[data-id="${id}"]`);
                if (item && !item.classList.contains('is-expanded')) {
                    await expandNode(tree, item);
                    any = true;
                }
            }
            if (!any) break;
        }
    }

    // ── Selection persistence (per history entry via history.state) ───────────
    //
    // Each history entry carries ptSelected in its state object.
    // replaceState merges with existing state so naja's keys are preserved.
    // popstate passes e.state which belongs to the entry being restored — correct
    // selection for every back/forward step automatically.

    // ── Selection ─────────────────────────────────────────────────────────────

    function applySelection(tree, item) {
        tree.querySelectorAll('.pt-item.is-selected').forEach(el => {
            el.classList.remove('is-selected');
            el.setAttribute('aria-selected', 'false');
            applyThemeSelected(tree, el, false);
        });
        item.classList.add('is-selected');
        item.setAttribute('aria-selected', 'true');
        applyThemeSelected(tree, item, true);
    }

    function selectNode(tree, item) {
        if (item.classList.contains('is-disabled')) return;
        applySelection(tree, item);
        tree.dispatchEvent(new CustomEvent('pt:select', {
            bubbles: true,
            detail : { id: item.dataset.id, item, data: { ...item.dataset } },
        }));
    }

    /** Read node ID from current URL — query param or path pattern */
    function getIdFromUrl(tree) {
        // query param: ?pageId=5
        const param = tree.dataset.urlParam;
        if (param) return new URLSearchParams(location.search).get(param);

        // path pattern: /page/{id}/whatever  →  match prefix up to {id}, ignore the rest
        const pattern = tree.dataset.urlPattern;
        if (pattern) {
            const idIndex = pattern.indexOf('{id}');
            if (idIndex === -1) return null;
            const prefix = pattern.slice(0, idIndex).replace(/[.+^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp('^' + prefix + '([^/?#]+)');
            const m = location.pathname.match(regex);
            return m ? m[1] : null;
        }

        return null;
    }

    async function selectInitialNode(tree, id) {
        let item = tree.querySelector(`.pt-item[data-id="${id}"]`);
        if (item) {
            applySelection(tree, item);
            item.scrollIntoView({ block: 'nearest' });
            return;
        }

        const pathUrl = tree.dataset.signalAncestorPath;
        if (!pathUrl) return;
        let ancestors;
        try {
            const resp = await fetch(buildUrl(pathUrl, { '__ID__': id }),
                { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            ancestors = await resp.json();
        } catch { return; }

        for (const ancestorId of ancestors) {
            let ancestorItem = null;
            for (let i = 0; i < 20; i++) {
                ancestorItem = tree.querySelector(`.pt-item[data-id="${ancestorId}"]`);
                if (ancestorItem) break;
                await new Promise(r => setTimeout(r, 100));
            }
            if (!ancestorItem) continue;
            if (!ancestorItem.classList.contains('is-expanded')) {
                await expandNode(tree, ancestorItem);
            }
        }

        item = tree.querySelector(`.pt-item[data-id="${id}"]`);
        if (item) {
            applySelection(tree, item);
            item.scrollIntoView({ block: 'nearest' });
        }
    }

    // ── Drag & Drop ───────────────────────────────────────────────────────────
    //
    // Y-position zones within each target .pt-row:
    //   top 28%    → BEFORE
    //   middle 44% → CHILD  (or 50/50 before/after for leaves)
    //   bottom 28% → AFTER
    //
    // draggable="true" on .pt-row to avoid browser quirks with nested li elements.
    // Visual indicator via data-drop-pos attribute on target .pt-item + CSS.

    const DnD = {
        dragItem  : null,
        targetItem: null,
        targetPos : null,
        clear() {
            this.targetItem?.removeAttribute('data-drop-pos');
            this.targetItem = null;
            this.targetPos  = null;
        },
        isAncestorOf(ancestor, node) {
            let cur = node.parentElement;
            while (cur) {
                if (cur === ancestor) return true;
                cur = cur.parentElement;
            }
            return false;
        },
    };

    function calcDropPosition(clientY, rowRect, isLeaf) {
        const rel = (clientY - rowRect.top) / rowRect.height;
        if (rel < 0.28) return 'before';
        if (rel > 0.72) return 'after';
        // Middle zone: always 'child' – leaf nodes can receive children too
        return 'child';
    }

    function initDragAndDrop(tree) {
        tree.addEventListener('dragstart', e => {
            const row  = e.target.closest('.pt-row[draggable="true"]');
            const item = row?.closest('.pt-item');
            if (!row || !item || item.classList.contains('is-disabled')) { e.preventDefault(); return; }
            DnD.dragItem = item;
            item.classList.add('is-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.dataset.id);
            try { e.dataTransfer.setDragImage(row, 16, row.offsetHeight / 2); } catch { /* */ }
        });

        tree.addEventListener('dragend', () => {
            DnD.dragItem?.classList.remove('is-dragging');
            DnD.clear();
            DnD.dragItem = null;
        });

        tree.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!DnD.dragItem) return;
            const targetRow  = e.target.closest('.pt-row');
            const targetItem = e.target.closest('.pt-item');
            if (!targetItem || !targetRow)                   { DnD.clear(); return; }
            if (targetItem === DnD.dragItem)                 { DnD.clear(); return; }
            if (DnD.isAncestorOf(DnD.dragItem, targetItem)) { DnD.clear(); return; }

            const isLeaf   = !targetItem.classList.contains('has-children');
            const position = calcDropPosition(e.clientY, targetRow.getBoundingClientRect(), isLeaf);

            if (targetItem !== DnD.targetItem || position !== DnD.targetPos) {
                DnD.clear();
                DnD.targetItem = targetItem;
                DnD.targetPos  = position;
                targetItem.setAttribute('data-drop-pos', position);
            }
        });

        tree.addEventListener('dragleave', e => {
            if (!tree.contains(e.relatedTarget)) DnD.clear();
        });

        tree.addEventListener('drop', e => {
            e.preventDefault();
            const dragItem   = DnD.dragItem;
            const targetItem = DnD.targetItem;
            const position   = DnD.targetPos;
            DnD.clear();
            if (!dragItem || !targetItem || !position) return;

            const dragId   = dragItem.dataset.id;
            const targetId = targetItem.dataset.id;

            // Snapshot DOM state before move so rollback can fully restore it
            const prevParent      = dragItem.parentElement;
            const prevNext        = dragItem.nextSibling;
            const targetWasLeaf   = targetItem.classList.contains('is-leaf');
            const targetIconEl    = targetItem.querySelector(':scope > .pt-row .pt-icon');
            const targetIconHTML  = targetIconEl ? targetIconEl.innerHTML : null;

            // Snapshot source parent (the .pt-item that contains prevParent .pt-list)
            const srcItem         = prevParent.closest('.pt-children')?.closest('.pt-item') ?? null;
            const srcIconEl       = srcItem?.querySelector(':scope > .pt-row .pt-icon') ?? null;
            const srcIconHTML     = srcIconEl ? srcIconEl.innerHTML : null;

            // Suppress drop onto own direct parent (node is already a child there)
            if (position === 'child' && targetItem === srcItem) return;

            applyDomMove(dragItem, targetItem, position, tree);

            // If the node ended up in the exact same position, abort silently
            if (dragItem.parentElement === prevParent && dragItem.nextSibling === prevNext) {
                return;
            }

            // Demote source parent to leaf if it lost its last child
            let srcWasDemoted = false;
            if (srcItem) {
                const remaining = srcItem.querySelectorAll(':scope > .pt-children > .pt-list > .pt-item');
                if (remaining.length === 0) {
                    srcWasDemoted = true;
                    srcItem.classList.remove('has-children', 'is-expanded');
                    srcItem.classList.add('is-leaf');
                    srcItem.removeAttribute('aria-expanded');
                    srcItem.dataset.hasChildren = '0';

                    // Swap toggle button → leaf placeholder span
                    const btn = srcItem.querySelector(':scope > .pt-row .pt-toggle:not(.pt-toggle--leaf)');
                    if (btn) {
                        const leafSpan = document.createElement('span');
                        leafSpan.className = 'pt-toggle pt-toggle--leaf';
                        btn.replaceWith(leafSpan);
                    }

                    // Swap icon: branch → leaf
                    const leafIcon = tree.dataset.leafIcon;
                    const srcIcon  = srcItem.querySelector(':scope > .pt-row .pt-icon');
                    if (srcIcon && leafIcon) srcIcon.innerHTML = leafIcon;
                }
            }

            refreshAllIndents(tree);

            // rollback() fully undoes the DOM move including leaf→branch promotion
            const rollback = () => {
                prevParent.insertBefore(dragItem, prevNext);

                // Restore source parent from leaf back to branch if it was demoted
                if (srcWasDemoted && srcItem) {
                    srcItem.classList.remove('is-leaf');
                    srcItem.classList.add('has-children');
                    srcItem.dataset.hasChildren = '1';

                    const leafSpan = srcItem.querySelector(':scope > .pt-row .pt-toggle--leaf');
                    if (leafSpan) {
                        const btn = document.createElement('button');
                        btn.type      = 'button';
                        btn.className = 'pt-toggle';
                        btn.setAttribute('aria-label', 'Rozbalit');
                        leafSpan.replaceWith(btn);
                    }

                    if (srcIconEl && srcIconHTML !== null) {
                        const ic = srcItem.querySelector(':scope > .pt-row .pt-icon');
                        if (ic) ic.innerHTML = srcIconHTML;
                    }
                }

                if (targetWasLeaf && !targetItem.classList.contains('is-leaf')) {
                    // Undo branch promotion: restore leaf classes
                    targetItem.classList.remove('has-children', 'is-expanded');
                    targetItem.classList.add('is-leaf');
                    targetItem.removeAttribute('aria-expanded');
                    targetItem.dataset.hasChildren = '0';

                    // Swap real toggle button back to leaf placeholder span
                    const btn = targetItem.querySelector(':scope > .pt-row .pt-toggle:not(.pt-toggle--leaf)');
                    if (btn) {
                        const leafSpan = document.createElement('span');
                        leafSpan.className = 'pt-toggle pt-toggle--leaf';
                        btn.replaceWith(leafSpan);
                    }

                    // Remove the children container that was created during promotion
                    const emptyChildren = targetItem.querySelector(':scope > .pt-children');
                    if (emptyChildren && !emptyChildren.querySelector('.pt-item')) {
                        emptyChildren.remove();
                    }

                    // Restore original icon
                    if (targetIconEl && targetIconHTML !== null) {
                        const currentIcon = targetItem.querySelector(':scope > .pt-row .pt-icon');
                        if (currentIcon) currentIcon.innerHTML = targetIconHTML;
                    }
                }

                refreshAllIndents(tree);
            };

            tree.dispatchEvent(new CustomEvent('pt:move', {
                bubbles: true,
                detail : { dragId, targetId, position, rollback },
            }));

            // If data-move-url is set, POST to server for persistence.
            // Rollback automatically on any non-2xx response.
            const moveUrl = tree.dataset.moveUrl;
            if (moveUrl) {
                fetch(moveUrl, {
                    method : 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                    body   : JSON.stringify({ dragId, targetId, position }),
                })
                .then(r => { if (!r.ok) rollback(); })
                .catch(() => rollback());
            }
        });
    }

    function applyDomMove(dragItem, targetItem, position, tree) {
        if (position === 'before') {
            targetItem.parentElement.insertBefore(dragItem, targetItem);
        } else if (position === 'after') {
            targetItem.parentElement.insertBefore(dragItem, targetItem.nextSibling);
        } else if (position === 'child') {
            // Promote leaf → branch if needed
            if (targetItem.classList.contains('is-leaf')) {
                targetItem.classList.remove('is-leaf');
                targetItem.classList.add('has-children', 'is-expanded');
                targetItem.dataset.hasChildren = '1';
                targetItem.setAttribute('aria-expanded', 'true');

                // Swap leaf placeholder span for a real toggle button
                const leafSpan = targetItem.querySelector(':scope > .pt-row .pt-toggle--leaf');
                if (leafSpan) {
                    const btn = document.createElement('button');
                    btn.type      = 'button';
                    btn.className = 'pt-toggle';
                    btn.tabIndex  = -1;
                    btn.setAttribute('aria-label', 'Sbalit');
                    btn.innerHTML = '<svg class="pt-toggle__icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                    btn.querySelector('.pt-toggle__icon').style.transform = 'rotate(90deg)';
                    leafSpan.replaceWith(btn);
                }

                // Swap leafIcon → branchIcon if configured
                const branchIconHtml = tree.dataset.branchIcon || '';
                const leafIconHtml   = tree.dataset.leafIcon   || '';
                if (branchIconHtml && leafIconHtml) {
                    // Only swap when both are configured (otherwise we can't tell if
                    // the current icon is the leaf default or a per-row custom icon)
                    const iconEl = targetItem.querySelector(':scope > .pt-row .pt-icon');
                    if (iconEl) iconEl.innerHTML = branchIconHtml;
                } else if (branchIconHtml) {
                    // branchIcon configured but no leafIcon → ensure icon exists and shows branch
                    let iconEl = targetItem.querySelector(':scope > .pt-row .pt-icon');
                    if (!iconEl) {
                        iconEl = document.createElement('span');
                        iconEl.className = 'pt-icon';
                        const label = targetItem.querySelector(':scope > .pt-row .pt-label');
                        label && label.before(iconEl);
                    }
                    iconEl.innerHTML = branchIconHtml;
                }

                // Make row draggable if DnD is on
                const row = targetItem.querySelector(':scope > .pt-row');
                if (row && !targetItem.classList.contains('is-disabled')) {
                    row.setAttribute('draggable', 'true');
                }
            }

            let container = targetItem.querySelector(':scope > .pt-children');
            if (!container) {
                container = document.createElement('div');
                container.className = 'pt-children';
                targetItem.appendChild(container);
            }
            let ul = container.querySelector(':scope > .pt-list');
            if (!ul) {
                ul = document.createElement('ul');
                ul.className = 'pt-list';
                ul.setAttribute('role', 'group');
                container.appendChild(ul);
                container.style.display  = 'block';
                container.dataset.loaded = 'true';
            }
            ul.appendChild(dragItem);
        }
    }

    /**
     * After any DOM move, rebuild is-last classes and indent+connector spans
     * for ALL items in the tree. O(n) but fast enough for typical tree sizes.
     */
    function refreshAllIndents(tree) {
        const treeLines = tree.classList.contains('phlox-tree--lines');

        // 1. Update is-last class on every item
        tree.querySelectorAll('.pt-list').forEach(ul => {
            const items = [...ul.children].filter(c => c.classList.contains('pt-item'));
            items.forEach((item, i) => {
                item.classList.toggle('is-last', i === items.length - 1);
            });
        });

        // 2. Rebuild indent spans (always — they carry the visual indentation)
        //    + connector spans when tree lines are active
        const rootList = tree.querySelector(':scope > .pt-list, :scope > ul');
        if (!rootList) return;
        [...rootList.children]
            .filter(c => c.classList.contains('pt-item'))
            .forEach(item => rebuildIndents(item, [], tree, treeLines));
    }

    /**
     * Recursively rebuild .pt-indent spans and .pt-connector span for one item.
     * @param {HTMLElement} item
     * @param {boolean[]}   ancestorFlags  isLast for each ancestor (outermost first)
     * @param {HTMLElement} tree
     */
    function rebuildIndents(item, ancestorFlags, tree, treeLines) {
        const row = item.querySelector(':scope > .pt-row');
        if (!row) return;

        const isLast = item.classList.contains('is-last');
        const depth  = ancestorFlags.length;

        // Remove all old indent spans and connector
        row.querySelectorAll('.pt-indent, .pt-connector').forEach(el => el.remove());

        const firstContent = row.querySelector('.pt-toggle, .pt-checkbox, .pt-icon, .pt-label');

        // Re-insert indent spans — skip ancestorFlags[0] (root has no connector).
        // Use indices 1..depth-1: each corresponds to the ancestor's connector at that column.
        for (let i = 1; i < depth; i++) {
            const sp = document.createElement('span');
            sp.className       = 'pt-indent';
            sp.dataset.hasLine = ancestorFlags[i] ? '0' : '1';
            sp.setAttribute('aria-hidden', 'true');
            row.insertBefore(sp, firstContent);
        }

        // Re-insert connector — only needed for tree lines
        if (treeLines && depth > 0) {
            const conn = document.createElement('span');
            conn.className = 'pt-connector' + (isLast ? ' pt-connector--last' : '');
            conn.setAttribute('aria-hidden', 'true');
            row.insertBefore(conn, firstContent);
        }

        // Recurse into visible children
        item.querySelectorAll(':scope > .pt-children > .pt-list > .pt-item')
            .forEach(child => rebuildIndents(child, [...ancestorFlags, isLast], tree, treeLines));
    }

    // ── Keyboard navigation ───────────────────────────────────────────────────

    function initKeyboard(tree) {
        tree.addEventListener('keydown', e => {
            const item = e.target.closest('.pt-item');
            if (!item) return;
            switch (e.key) {
                case 'ArrowRight':
                    e.preventDefault();
                    if (item.classList.contains('has-children')) {
                        if (!item.classList.contains('is-expanded')) expandNode(tree, item);
                        else item.querySelector(':scope > .pt-children > .pt-list > .pt-item')?.focus();
                    }
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    if (item.classList.contains('is-expanded')) collapseNode(tree, item);
                    else item.closest('.pt-children')?.closest('.pt-item')?.focus();
                    break;
                case 'ArrowDown':
                    e.preventDefault(); getNextVisible(item)?.focus(); break;
                case 'ArrowUp':
                    e.preventDefault(); getPrevVisible(item)?.focus(); break;
                case 'Enter': case ' ':
                    e.preventDefault(); selectNode(tree, item); break;
                case 'Home':
                    e.preventDefault(); tree.querySelector('.pt-item')?.focus(); break;
                case 'End':
                    e.preventDefault(); [...tree.querySelectorAll('.pt-item')].at(-1)?.focus(); break;
            }
        });
    }

    function getNextVisible(item) {
        if (item.classList.contains('is-expanded')) {
            const child = item.querySelector(':scope > .pt-children > .pt-list > .pt-item');
            if (child) return child;
        }
        let cur = item;
        while (cur) {
            const sib = cur.nextElementSibling;
            if (sib?.classList.contains('pt-item')) return sib;
            cur = cur.closest('.pt-children')?.closest('.pt-item');
        }
        return null;
    }

    function getPrevVisible(item) {
        const sib = item.previousElementSibling;
        if (sib?.classList.contains('pt-item')) return getDeepLastVisible(sib);
        return item.closest('.pt-children')?.closest('.pt-item') ?? null;
    }

    function getDeepLastVisible(item) {
        if (item.classList.contains('is-expanded')) {
            const last = [...(item.querySelector(':scope > .pt-children > .pt-list')?.children ?? [])]
                .filter(c => c.classList.contains('pt-item')).at(-1);
            if (last) return getDeepLastVisible(last);
        }
        return item;
    }

    // ── Click handler ─────────────────────────────────────────────────────────

    function initClicks(tree) {
        tree.addEventListener('click', e => {
            const toggle = e.target.closest('.pt-toggle:not(.pt-toggle--leaf)');
            const item   = e.target.closest('.pt-item');
            if (!item) return;

            if (toggle) {
                e.preventDefault();
                e.stopPropagation();
                item.classList.contains('is-expanded')
                    ? collapseNode(tree, item)
                    : expandNode(tree, item);
            } else if (e.target.closest('.pt-row')) {
                e.preventDefault();
                selectNode(tree, item);
            }
        });
    }

    // ── Upgrade SSR-rendered draggable attrs ──────────────────────────────────

    function upgradeDraggableAttrs(tree) {
        if (tree.dataset.dragDrop !== 'true') return;
        tree.querySelectorAll('.pt-item[draggable]').forEach(item => item.removeAttribute('draggable'));
        tree.querySelectorAll('.pt-item:not(.is-disabled) > .pt-row').forEach(row => {
            row.setAttribute('draggable', 'true');
        });
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    function initTree(tree) {
        if (tree._ptInit) return;
        tree._ptInit = true;
        upgradeDraggableAttrs(tree);
        applyThemeToTree(tree);
        initClicks(tree);
        initKeyboard(tree);
        if (tree.dataset.dragDrop === 'true') initDragAndDrop(tree);

        // Resolve which node to select: data-selected-node (PHP) or URL param
        const selectId = tree.dataset.selectedNode || getIdFromUrl(tree);

        restoreExpandedState(tree)
            .then(() => {
                if (selectId) return selectInitialNode(tree, selectId);
            })
            .catch(() => {});
    }

    function initAll(root) {
        (root || document).querySelectorAll('.phlox-tree').forEach(initTree);
    }

    document.addEventListener('DOMContentLoaded', () => {
        initAll();

        // Hook into naja's restoreState if available — fires after naja has applied
        // its DOM snapshot, so the tree is guaranteed to be in the correct state.
        // Fallback: popstate + setTimeout(0) per MDN recommendation (document may
        // not yet reflect the new state when popstate fires synchronously).
        if (window.naja?.historyHandler) {
            window.naja.historyHandler.addEventListener('restoreState', () => {
                reselectFromUrl();
            });
        } else {
            window.addEventListener('popstate', () => {
                setTimeout(reselectFromUrl, 0);
            });
        }
    });

    function reselectFromUrl() {
        document.querySelectorAll('.phlox-tree').forEach(tree => {
            const id = getIdFromUrl(tree);
            if (!id) {
                tree.querySelectorAll('.pt-item.is-selected').forEach(el => {
                    el.classList.remove('is-selected');
                    el.setAttribute('aria-selected', 'false');
                });
                return;
            }
            selectInitialNode(tree, id);
        });
    }

    // ── Public API ────────────────────────────────────────────────────────────

    const PhloxTree = {
        init: initAll,
        initTree,
        expand(treeId, nodeId) {
            const tree = document.getElementById(treeId);
            const item = tree?.querySelector(`.pt-item[data-id="${nodeId}"]`);
            if (tree && item) expandNode(tree, item);
        },
        collapse(treeId, nodeId) {
            const tree = document.getElementById(treeId);
            const item = tree?.querySelector(`.pt-item[data-id="${nodeId}"]`);
            if (tree && item) collapseNode(tree, item);
        },
        select(treeId, nodeId) {
            const tree = document.getElementById(treeId);
            const item = tree?.querySelector(`.pt-item[data-id="${nodeId}"]`);
            if (tree && item) selectNode(tree, item);
        },
        clearState(treeId) {
            const tree = document.getElementById(treeId);
            if (tree) try { localStorage.removeItem(lsKey(tree)); } catch { /* */ }
        },
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = PhloxTree;
    else global.PhloxTree = PhloxTree;

}(typeof window !== 'undefined' ? window : this));
