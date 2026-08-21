// ─── Navigation Bar Component ───

import React, { useRef } from 'react';
import { MessageSquare, Users, Compass, Settings, type LucideIcon } from 'lucide-react';

export type NavTabType = 'chat' | 'whiteboard' | 'groups' | 'peers' | 'profile';

interface NavBarProps {
  currentTab: NavTabType;
  onSelectTab: (tab: NavTabType) => void;
  unreadCount?: number;
  peerCount?: number;
}

interface TabDef {
  id: NavTabType;
  label: string;
  Icon: LucideIcon;
  title: string;
}

/**
 * The whiteboard is entered from a button inside the Room view rather than from here, but
 * it IS a distinct value of NavTabType. It is listed so the bar can still reflect that
 * state: previously, entering the whiteboard left every tab visually inactive, so the nav
 * silently misrepresented where the user was. It is rendered as a non-interactive
 * indicator that only appears while active, keeping the primary tab row uncluttered.
 */
const TABS: TabDef[] = [
  { id: 'chat', label: 'Room', Icon: MessageSquare, title: 'Active problem room and chat' },
  { id: 'groups', label: 'Squads', Icon: Users, title: 'Study squads and problem groups' },
  { id: 'peers', label: 'Peers', Icon: Compass, title: 'Online buddies' },
  { id: 'profile', label: 'Settings', Icon: Settings, title: 'Profile, streaks and settings' },
];

export const NavBar: React.FC<NavBarProps> = ({
  currentTab,
  onSelectTab,
  unreadCount = 0,
  peerCount = 0,
}) => {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Whiteboard is reached from the Room view, so treat it as "Room" for selection purposes
  // rather than leaving the whole bar with nothing selected.
  const effectiveTab: NavTabType = currentTab === 'whiteboard' ? 'chat' : currentTab;
  const activeIndex = Math.max(0, TABS.findIndex((t) => t.id === effectiveTab));

  // Arrow-key navigation is expected of a tablist and was previously absent, making the
  // bar reachable by Tab but not traversable the way assistive tech users expect.
  const onKeyDown = (e: React.KeyboardEvent) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (activeIndex + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (activeIndex - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next === null) return;

    e.preventDefault();
    onSelectTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <nav className="bottom-nav" role="tablist" aria-label="Main navigation" onKeyDown={onKeyDown}>
      {TABS.map((tab, i) => {
        const isActive = effectiveTab === tab.id;
        const showWhiteboardHint = tab.id === 'chat' && currentTab === 'whiteboard';
        const badge =
          tab.id === 'chat' && unreadCount > 0
            ? { text: unreadCount > 99 ? '99+' : String(unreadCount), label: `${unreadCount} unread messages`, bg: undefined }
            : tab.id === 'peers' && peerCount > 0
            ? { text: String(peerCount), label: `${peerCount} peers online`, bg: '#6366f1' }
            : null;

        return (
          <button
            key={tab.id}
            ref={(el) => { tabRefs.current[i] = el; }}
            type="button"
            role="tab"
            id={`nav-tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`nav-panel-${tab.id}`}
            // Roving tabindex: only the active tab is in the tab order; arrows move within.
            tabIndex={isActive ? 0 : -1}
            className={`nav-tab ${isActive ? 'active' : ''}`}
            onClick={() => onSelectTab(tab.id)}
            title={tab.title}
            aria-label={tab.label}
          >
            <tab.Icon
              size={17}
              // Active colouring was previously applied only to Settings, so the active
              // state looked different depending on which tab you were on.
              color={isActive ? 'var(--primary)' : undefined}
              aria-hidden={true}
            />
            {/* The label collapses at narrow widths (see .nav-tab-label). aria-label on the
                button carries the name once the text is hidden, so the tab is still
                identifiable to a screen reader and to anyone who does not recognise the
                glyph — which is the whole precondition for dropping the text at all. */}
            <span className="nav-tab-label">{tab.label}</span>

            {showWhiteboardHint && (
              <span
                className="nav-subtag"
                style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--accent-cyan)', display: 'block', lineHeight: 1 }}
              >
                Board
              </span>
            )}

            {badge && (
              // aria-label carries the meaning; the bare number is hidden from screen
              // readers, which would otherwise announce a context-free "3".
              <span className="nav-badge" style={badge.bg ? { background: badge.bg } : undefined} aria-label={badge.label}>
                <span aria-hidden={true}>{badge.text}</span>
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
};
