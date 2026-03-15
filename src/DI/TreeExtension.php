<?php

declare(strict_types=1);

namespace Phlox\Components\Tree\DI;

use Nette\DI\CompilerExtension;
use Nette\Schema\Expect;
use Nette\Schema\Schema;
use Phlox\Components\Tree\TreeControl;
use Phlox\Components\Tree\TreeControlFactory;

/**
 * Nette DI extension for phlox/components-tree.
 *
 * Registration in config.neon:
 *
 *   extensions:
 *       tree: Phlox\Components\Tree\DI\TreeExtension
 *
 * Then inject the factory:
 *
 *   public function __construct(private TreeControlFactory $treeFactory) {}
 *
 *   protected function createComponentTree(): TreeControl
 *   {
 *       return $this->treeFactory->create($this->db->table('nodes'));
 *   }
 */
class TreeExtension extends CompilerExtension
{
    public function getConfigSchema(): Schema
    {
        return Expect::structure([]);
    }

    public function loadConfiguration(): void
    {
        $builder = $this->getContainerBuilder();

        $builder->addFactoryDefinition($this->prefix('factory'))
            ->setImplement(TreeControlFactory::class)
            ->getResultDefinition()
            ->setFactory(TreeControl::class);
    }
}
