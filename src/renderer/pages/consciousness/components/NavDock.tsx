/**
 * NavDock — Navegación integrada del Home (Consciousness).
 *
 * Reemplaza la "Botonera Menú Navegación Directa Wayland" que estaba inline
 * en ConsciousnessPage. Data-driven: cada entrada = { id, label, icon, route,
 * accent } para poder reordenar/editar sin tocar JSX.
 *
 * Fase A2:
 *  - SEARCH reusa ConversationSearchPopover (ya existía en el sider).
 *  - MISSION CONTROL es placeholder deshabilitado ("pronto") hasta su
 *    recreación (Fase F).
 *
 * TODO(A3): cuando se elimine el sider por completo, esta es la navegación
 * canónica del app.
 */
import React, { useState } from 'react';
import { Modal } from '@arco-design/web-react';
import { useNavigate } from 'react-router-dom';
import ConversationSearchPopover from '@renderer/pages/conversation/GroupedHistory/ConversationSearchPopover';

export interface NavDockItem {
  id: string;
  label: string;
  icon: string;
  /** Ruta de navegación. undefined + disabled => placeholder. */
  route?: string;
  /** Color de acento (texto/borde). */
  accent: string;
  /** Botón destacado (relleno) — p.ej. CHAT. */
  primary?: boolean;
  /** Placeholder deshabilitado. */
  disabled?: boolean;
  title?: string;
}

const NAV_ITEMS: NavDockItem[] = [
  { id: 'teams', label: 'TEAMS', icon: '👥', route: '/teams', accent: '#a89fc4' },
  { id: 'projects', label: 'PROJECTS', icon: '📁', route: '/projects', accent: '#e3c98c' },
  { id: 'workflows', label: 'WORKFLOWS', icon: '⚡', route: '/workflows', accent: '#9db8a2' },
  { id: 'goals', label: 'GOALS', icon: '🎯', route: '/goal', accent: '#d9a87e' },
  { id: 'memory', label: 'MEMORY', icon: '🧠', route: '/memory', accent: '#8fb3c4' },
  { id: 'cardgrids', label: 'CARDS GRID', icon: '📜', route: '/conversations', accent: '#c9a8c0' },
  { id: 'chat', label: 'CHAT', icon: '💬', route: '/guid', accent: '#f0b429', primary: true },
  {
    id: 'mission-control',
    label: 'MISSION CONTROL',
    icon: '🎛️',
    accent: '#f0b429',
    disabled: true,
    title: 'Próximamente: recreación en curso',
  },
  { id: 'settings', label: '', icon: '⚙️', route: '/settings', accent: '#a8b6c9', title: 'Settings' },
];

interface NavDockProps {
  className?: string;
}

export const NavDock: React.FC<NavDockProps> = ({ className }) => {
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const navBtnBase = 'px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center space-x-1 shrink-0';

  return (
    <>
    <div className={`flex items-center space-x-2 overflow-x-auto ${className ?? ''}`}>
            {/* SEARCH — botón que abre el modal de búsqueda por palabras clave */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        title="Buscar en conversaciones"
        className={`${navBtnBase} bg-[#232c3b] hover:bg-[#3e4c5e] border`}
        style={{ color: '#8fb3c4', borderColor: '#8fb3c466' }}
      >
        <span>🔍</span>
        <span>SEARCH</span>
      </button>

      {NAV_ITEMS.map((item) => {
        
        if (item.primary) {
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => item.route && navigate(item.route)}
              title={item.title}
              className={`${navBtnBase} bg-[#f0b429] hover:bg-[#f5c26b] text-[#141b26] shadow-lg shadow-[#f0b429]/25`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        }
        if (item.disabled) {
          return (
            <button
              key={item.id}
              type="button"
              disabled
              title={item.title}
              className={`${navBtnBase} opacity-50 cursor-not-allowed bg-[#232c3b] border border-dashed relative`}
              style={{ color: item.accent, borderColor: `${item.accent}66` }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
              <span className="absolute -top-2 -right-2 text-[8px] font-extrabold tracking-widest bg-[#f0b429] text-[#141b26] rounded-full px-1 py-px shadow">
                PRONTO
              </span>
            </button>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => item.route && navigate(item.route)}
            title={item.title}
            className={`${navBtnBase} bg-[#232c3b] hover:bg-[#3e4c5e] hover:-translate-y-px border`}
            style={{ color: item.accent, borderColor: `${item.accent}66` }}
          >
            <span>{item.icon}</span>
            {item.label && <span>{item.label}</span>}
          </button>
        );
      })}
    </div>

      {/* Modal búsqueda de conversaciones por palabras clave */}
      <Modal
        title="Buscar en conversaciones"
        visible={searchOpen}
        onCancel={() => setSearchOpen(false)}
        footer={null}
        style={{ borderRadius: '12px' }}
      >
        <ConversationSearchPopover label="SEARCH" fullWidth />
      </Modal>
    </>
  );
};

export default NavDock;
