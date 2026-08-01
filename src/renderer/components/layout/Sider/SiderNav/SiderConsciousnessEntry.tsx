import React from 'react';
import { Eye } from 'lucide-react';
import SiderItem from '../SiderItem';
import type { SiderNavContext } from '../navItems';

export const SiderConsciousnessEntry: React.FC<{ ctx: SiderNavContext }> = ({ ctx }) => {
  const { pathname, onTopZoneNav } = ctx;
  const isSelected = pathname === '/consciousness';

  return (
    <SiderItem
      icon={<Eye className="w-4 h-4 text-[#89b4fa]" />}
      name="Consciousness HUD"
      selected={isSelected}
      onClick={() => onTopZoneNav('/consciousness')}
    />
  );
};

