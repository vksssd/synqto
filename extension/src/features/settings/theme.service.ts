// ─── Synqto Theme Manager (Day / Night / System) ───

export type ThemeMode = 'system' | 'day' | 'night';
export const THEME_STORAGE_KEY = 'synqto_theme_mode';

export class ThemeService {
  private static instance: ThemeService | null = null;
  private currentMode: ThemeMode = 'system';
  private listeners: Set<(mode: ThemeMode) => void> = new Set();
  private mediaQuery: MediaQueryList | null = null;

  private constructor() {
    this.init();
  }

  public static getInstance(): ThemeService {
    if (!ThemeService.instance) {
      ThemeService.instance = new ThemeService();
    }
    return ThemeService.instance;
  }

  private async init() {
    if (typeof window !== 'undefined') {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
      this.mediaQuery.addEventListener('change', () => {
        if (this.currentMode === 'system') {
          this.applyTheme('system');
        }
      });
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get([THEME_STORAGE_KEY], (res) => {
        const saved = res[THEME_STORAGE_KEY] as ThemeMode;
        if (saved && (saved === 'system' || saved === 'day' || saved === 'night')) {
          this.setThemeMode(saved);
        } else {
          this.applyTheme('system');
        }
      });
    } else {
      this.applyTheme('system');
    }
  }

  public getThemeMode(): ThemeMode {
    return this.currentMode;
  }

  public setThemeMode(mode: ThemeMode) {
    this.currentMode = mode;
    this.applyTheme(mode);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ [THEME_STORAGE_KEY]: mode });
    }
    this.listeners.forEach((fn) => fn(mode));
  }

  private applyTheme(mode: ThemeMode) {
    if (typeof document === 'undefined') return;
    let effective: 'light' | 'dark' = 'dark';
    if (mode === 'day') {
      effective = 'light';
    } else if (mode === 'night') {
      effective = 'dark';
    } else {
      effective = this.mediaQuery?.matches ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', effective);
  }

  public onChange(listener: (mode: ThemeMode) => void): () => void {
    this.listeners.add(listener);
    listener(this.currentMode);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
