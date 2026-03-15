<?php

declare(strict_types=1);

namespace Phlox\Components\Tree;

use Nette\Database\Table\Selection;

interface TreeControlFactory
{
    public function create(Selection $dataSource): TreeControl;
}
