// ─── Synqto Theme, Typography & Visual Customization Suite ───

export type ThemeMode =
  | 'nordic_forest'
  | 'system'
  | 'night'
  | 'day'
  | 'leetcode_dark'
  | 'leetcode_light'
  | 'oled'
  | 'espresso'
  | 'forest'
  | 'nord'
  | 'dracula'
  | 'synthwave'
  | 'solarized_dark'
  | 'solarized_light'
  | 'sakura';

export type AccentColor =
  | 'indigo'
  | 'leetcode'
  | 'cyan'
  | 'emerald'
  | 'rose'
  | 'amber'
  | 'purple'
  | 'slate'
  | 'crimson'
  | 'lime'
  | 'custom';

export type FontSizeOption = 'compact' | 'normal' | 'medium' | 'large' | 'xlarge' | 'custom';
export type UiDensity = 'compact' | 'normal' | 'comfortable';
export type BorderRadiusOption = 'sharp' | 'subtle' | 'smooth' | 'rounded' | 'pill';
export type FontFamilyOption =
  | 'system'
  | 'inter'
  | 'jetbrains'
  | 'fira'
  | 'roboto'
  | 'poppins'
  | 'outfit'
  | 'space_grotesk'
  | 'cascadia'
  | 'merriweather';

export interface FontFamilyDetails {
  id: FontFamilyOption;
  name: string;
  category: 'Sans-Serif' | 'Monospace' | 'Geometric' | 'Serif';
  fontFamily: string;
  icon: string;
  preview: string;
}

export const FONT_FAMILY_DETAILS: Record<FontFamilyOption, FontFamilyDetails> = {
  system: {
    id: 'system',
    name: 'System Modern',
    category: 'Sans-Serif',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    icon: '💻',
    preview: 'Sphinx of black quartz, judge my vow',
  },
  inter: {
    id: 'inter',
    name: 'Inter Pro',
    category: 'Sans-Serif',
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    icon: '✨',
    preview: 'Sphinx of black quartz, judge my vow',
  },
  jetbrains: {
    id: 'jetbrains',
    name: 'JetBrains Mono',
    category: 'Monospace',
    fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
    icon: '⚡',
    preview: 'const solve = (n: number) => n * 2;',
  },
  fira: {
    id: 'fira',
    name: 'Fira Code',
    category: 'Monospace',
    fontFamily: '"Fira Code", "JetBrains Mono", Consolas, monospace',
    icon: '⌨️',
    preview: 'fn binary_search<T>() -> Option<T>',
  },
  roboto: {
    id: 'roboto',
    name: 'Roboto Clean',
    category: 'Sans-Serif',
    fontFamily: '"Roboto", -apple-system, sans-serif',
    icon: '📱',
    preview: 'Sphinx of black quartz, judge my vow',
  },
  poppins: {
    id: 'poppins',
    name: 'Poppins Geometric',
    category: 'Geometric',
    fontFamily: '"Poppins", -apple-system, sans-serif',
    icon: '🎯',
    preview: 'Sphinx of black quartz, judge my vow',
  },
  outfit: {
    id: 'outfit',
    name: 'Outfit Minimal',
    category: 'Geometric',
    fontFamily: '"Outfit", -apple-system, sans-serif',
    icon: '💎',
    preview: 'Sphinx of black quartz, judge my vow',
  },
  space_grotesk: {
    id: 'space_grotesk',
    name: 'Space Grotesk',
    category: 'Geometric',
    fontFamily: '"Space Grotesk", sans-serif',
    icon: '🚀',
    preview: 'Sphinx of black quartz, judge my vow',
  },
  cascadia: {
    id: 'cascadia',
    name: 'Cascadia Code',
    category: 'Monospace',
    fontFamily: '"Cascadia Code", Consolas, monospace',
    icon: '🪄',
    preview: 'for (let i = 0; i < n; i++) {}',
  },
  merriweather: {
    id: 'merriweather',
    name: 'Merriweather Editorial',
    category: 'Serif',
    fontFamily: '"Merriweather", Georgia, "Times New Roman", serif',
    icon: '📖',
    preview: 'Sphinx of black quartz, judge my vow',
  },
};

export interface AccentPalette {
  id: AccentColor;
  name: string;
  emoji: string;
  primary: string;
  primaryHover: string;
  primaryGlow: string;
}

export interface ThemeModeDetails {
  id: ThemeMode;
  name: string;
  icon: string;
  desc: string;
  type: 'dark' | 'light' | 'auto';
  sampleBg: string;
  sampleText: string;
  sampleBorder: string;
}

export interface FiveColorPalette {
  id: string;
  name: string;
  emoji: string;
  category: 'standard' | 'leetcode' | 'creative';
  desc: string;
  colors: {
    bgApp: string;
    bgSurface: string;
    primary: string;
    textPrimary: string;
    textSecondary: string;
  };
  themeMode: ThemeMode;
  accent: AccentColor;
  customAccentHex?: string;
}

export interface CustomThemeSettings {
  mode: ThemeMode;
  accent: AccentColor;
  customAccentHex: string;
  // 5-Color Custom Palette Overrides (when customPaletteEnabled is true)
  customPaletteEnabled: boolean;
  customBgApp: string;
  customBgSurface: string;
  customPrimary: string;
  customTextPrimary: string;
  customTextSecondary: string;

  fontSize: number; // in px: 10 to 20, default 13
  fontSizeOption: FontSizeOption;
  density: UiDensity;
  borderRadius: BorderRadiusOption;
  glassOpacity: number; // 0 to 100, default 85
  highContrast: boolean;
  fontFamily: FontFamilyOption;
}

export const FIVE_COLOR_PALETTES: FiveColorPalette[] = [
  {
    id: 'palette_nordic_forest',
    name: 'Nordic Forest',
    emoji: '🌲',
    category: 'standard',
    desc: 'Default Scandinavian pine slate with crisp mint frost (>15:1 AAA)',
    colors: {
      bgApp: '#162124',
      bgSurface: '#1e2b2f',
      primary: '#2dd4bf',
      textPrimary: '#ecfdf5',
      textSecondary: '#94a3b8',
    },
    themeMode: 'nordic_forest',
    accent: 'emerald',
    customAccentHex: '#2dd4bf',
  },
  {
    id: 'palette_night',
    name: 'Standard Night',
    emoji: '🌙',
    category: 'standard',
    desc: 'Ergonomic obsidian dark with high-contrast text (>15:1 AAA)',
    colors: {
      bgApp: '#0d1117',
      bgSurface: '#161b22',
      primary: '#6366f1',
      textPrimary: '#f0f6fc',
      textSecondary: '#8b949e',
    },
    themeMode: 'night',
    accent: 'indigo',
  },
  {
    id: 'palette_day',
    name: 'Standard Day',
    emoji: '☀️',
    category: 'standard',
    desc: 'Crisp white & slate daylight with zero eye strain (14.8:1 AAA)',
    colors: {
      bgApp: '#f6f8fa',
      bgSurface: '#ffffff',
      primary: '#2563eb',
      textPrimary: '#1f2328',
      textSecondary: '#57606a',
    },
    themeMode: 'day',
    accent: 'indigo',
  },
  {
    id: 'palette_system',
    name: 'System Adaptive',
    emoji: '💻',
    category: 'standard',
    desc: 'Automatically transitions with your device light/dark schedule',
    colors: {
      bgApp: '#0d1117',
      bgSurface: '#161b22',
      primary: '#6366f1',
      textPrimary: '#f0f6fc',
      textSecondary: '#8b949e',
    },
    themeMode: 'system',
    accent: 'indigo',
  },
  {
    id: 'palette_leetcode_dark',
    name: 'LeetCode Arena',
    emoji: '🧡',
    category: 'leetcode',
    desc: 'Signature LeetCode IDE Darkroom with vibrant gold accent (#FFA116)',
    colors: {
      bgApp: '#1a1a1a',
      bgSurface: '#262626',
      primary: '#FFA116',
      textPrimary: '#eff1f6',
      textSecondary: '#abb2bf',
    },
    themeMode: 'leetcode_dark',
    accent: 'leetcode',
  },
  {
    id: 'palette_leetcode_light',
    name: 'LeetCode Study',
    emoji: '💛',
    category: 'leetcode',
    desc: 'Clean LeetCode daytime problem viewer with deep charcoal text',
    colors: {
      bgApp: '#ffffff',
      bgSurface: '#f7f7f8',
      primary: '#e68a00',
      textPrimary: '#262626',
      textSecondary: '#595959',
    },
    themeMode: 'leetcode_light',
    accent: 'leetcode',
  },
  {
    id: 'palette_oled',
    name: 'OLED Deep Space',
    emoji: '🌌',
    category: 'creative',
    desc: 'Pitch black #000000 with cyan neon for maximum battery saving',
    colors: {
      bgApp: '#000000',
      bgSurface: '#121212',
      primary: '#06b6d4',
      textPrimary: '#ffffff',
      textSecondary: '#a0aec0',
    },
    themeMode: 'oled',
    accent: 'cyan',
  },
  {
    id: 'palette_espresso',
    name: 'Warm Espresso',
    emoji: '☕',
    category: 'creative',
    desc: 'Cozy mocha cafe ambiance with low blue-light amber glow',
    colors: {
      bgApp: '#140d07',
      bgSurface: '#241810',
      primary: '#f59e0b',
      textPrimary: '#fef3c7',
      textSecondary: '#d97706',
    },
    themeMode: 'espresso',
    accent: 'amber',
  },
  {
    id: 'palette_forest',
    name: 'Emerald Matrix',
    emoji: '🌲',
    category: 'creative',
    desc: 'Deep pine matrix slate with crisp mint snow highlights',
    colors: {
      bgApp: '#04130b',
      bgSurface: '#0a2215',
      primary: '#10b981',
      textPrimary: '#ecfdf5',
      textSecondary: '#34d399',
    },
    themeMode: 'forest',
    accent: 'emerald',
  },
  {
    id: 'palette_nord',
    name: 'Nordic Frost',
    emoji: '❄️',
    category: 'creative',
    desc: 'Arctic blue slate with soothing icy contrast',
    colors: {
      bgApp: '#242933',
      bgSurface: '#2e3440',
      primary: '#88c0d0',
      textPrimary: '#eceff4',
      textSecondary: '#81a1c1',
    },
    themeMode: 'nord',
    accent: 'cyan',
  },
  {
    id: 'palette_dracula',
    name: 'Dracula Gothic',
    emoji: '🧛',
    category: 'creative',
    desc: 'Classic gothic dark purple with luminous pastels',
    colors: {
      bgApp: '#21222c',
      bgSurface: '#282a36',
      primary: '#bd93f9',
      textPrimary: '#f8f8f2',
      textSecondary: '#6272a4',
    },
    themeMode: 'dracula',
    accent: 'purple',
  },
  {
    id: 'palette_synthwave',
    name: 'Synthwave 84',
    emoji: '🌆',
    category: 'creative',
    desc: 'Retro cyberpunk violet with radiant neon pink',
    colors: {
      bgApp: '#1a102f',
      bgSurface: '#261447',
      primary: '#f472b6',
      textPrimary: '#fff0f5',
      textSecondary: '#c084fc',
    },
    themeMode: 'synthwave',
    accent: 'rose',
  },
  {
    id: 'palette_solarized_dark',
    name: 'Solarized Dark',
    emoji: '📜',
    category: 'creative',
    desc: 'Scientifically calibrated cyan-teal dark contrast',
    colors: {
      bgApp: '#00212b',
      bgSurface: '#002b36',
      primary: '#2aa198',
      textPrimary: '#fdf6e3',
      textSecondary: '#657b83',
    },
    themeMode: 'solarized_dark',
    accent: 'cyan',
  },
  {
    id: 'palette_solarized_light',
    name: 'Solarized Light',
    emoji: '📖',
    category: 'creative',
    desc: 'Soft ivory cream paper with deep charcoal text',
    colors: {
      bgApp: '#fdf6e3',
      bgSurface: '#eee8d5',
      primary: '#268bd2',
      textPrimary: '#073642',
      textSecondary: '#586e75',
    },
    themeMode: 'solarized_light',
    accent: 'cyan',
  },
  {
    id: 'palette_sakura',
    name: 'Sakura Petal',
    emoji: '🌸',
    category: 'creative',
    desc: 'Gentle blush rose morning with deep berry maroon text',
    colors: {
      bgApp: '#fff0f3',
      bgSurface: '#ffffff',
      primary: '#f43f5e',
      textPrimary: '#4c0519',
      textSecondary: '#881337',
    },
    themeMode: 'sakura',
    accent: 'rose',
  },
];

export const THEME_MODE_DETAILS: Record<ThemeMode, ThemeModeDetails> = {
  nordic_forest: {
    id: 'nordic_forest',
    name: 'Nordic Forest (Default)',
    icon: '🌲',
    desc: 'Default Scandinavian pine slate with mint frost (High contrast >15:1 AAA)',
    type: 'dark',
    sampleBg: '#162124',
    sampleText: '#ecfdf5',
    sampleBorder: 'rgba(45, 212, 191, 0.3)',
  },
  system: {
    id: 'system',
    name: 'System Auto',
    icon: '💻',
    desc: 'Matches device daylight/dark mode automatically',
    type: 'auto',
    sampleBg: '#0d1117',
    sampleText: '#f0f6fc',
    sampleBorder: 'rgba(255, 255, 255, 0.15)',
  },
  night: {
    id: 'night',
    name: 'Midnight Dark',
    icon: '🌙',
    desc: 'Calibrated ergonomic dark theme (Obsidian slate & crisp text)',
    type: 'dark',
    sampleBg: '#0d1117',
    sampleText: '#f0f6fc',
    sampleBorder: 'rgba(255, 255, 255, 0.15)',
  },
  day: {
    id: 'day',
    name: 'Daylight Clean',
    icon: '☀️',
    desc: 'Ergonomic light theme (Pure white & deep charcoal, 14:1 contrast)',
    type: 'light',
    sampleBg: '#f6f8fa',
    sampleText: '#1f2328',
    sampleBorder: 'rgba(31, 35, 40, 0.15)',
  },
  leetcode_dark: {
    id: 'leetcode_dark',
    name: 'LeetCode Dark',
    icon: '🧡',
    desc: 'Signature LeetCode IDE Dark with vibrant gold highlights',
    type: 'dark',
    sampleBg: '#1a1a1a',
    sampleText: '#eff1f6',
    sampleBorder: 'rgba(255, 161, 22, 0.35)',
  },
  leetcode_light: {
    id: 'leetcode_light',
    name: 'LeetCode Light',
    icon: '💛',
    desc: 'Clean LeetCode daytime problem viewer with gold accents',
    type: 'light',
    sampleBg: '#ffffff',
    sampleText: '#262626',
    sampleBorder: 'rgba(230, 138, 0, 0.35)',
  },
  oled: {
    id: 'oled',
    name: 'OLED True Black',
    icon: '🌌',
    desc: 'Pure pitch black #000000 with ultra battery saver',
    type: 'dark',
    sampleBg: '#000000',
    sampleText: '#ffffff',
    sampleBorder: 'rgba(255, 255, 255, 0.2)',
  },
  espresso: {
    id: 'espresso',
    name: 'Warm Espresso',
    icon: '☕',
    desc: 'Cozy mocha cafe darkroom with amber glow',
    type: 'dark',
    sampleBg: '#140d07',
    sampleText: '#fef3c7',
    sampleBorder: 'rgba(245, 158, 11, 0.25)',
  },
  forest: {
    id: 'forest',
    name: 'Emerald Forest',
    icon: '🌲',
    desc: 'Deep pine matrix slate with mint snow highlights',
    type: 'dark',
    sampleBg: '#04130b',
    sampleText: '#ecfdf5',
    sampleBorder: 'rgba(16, 185, 129, 0.25)',
  },
  nord: {
    id: 'nord',
    name: 'Nordic Frost',
    icon: '❄️',
    desc: 'Arctic blue slate with soothing icy contrast',
    type: 'dark',
    sampleBg: '#242933',
    sampleText: '#eceff4',
    sampleBorder: 'rgba(136, 192, 208, 0.25)',
  },
  dracula: {
    id: 'dracula',
    name: 'Dracula Gothic',
    icon: '🧛',
    desc: 'Classic gothic dark purple with radiant pastels',
    type: 'dark',
    sampleBg: '#21222c',
    sampleText: '#f8f8f2',
    sampleBorder: 'rgba(189, 147, 249, 0.25)',
  },
  synthwave: {
    id: 'synthwave',
    name: 'Synthwave 84',
    icon: '🌆',
    desc: 'Retro cyberpunk violet with luminous neon pink',
    type: 'dark',
    sampleBg: '#1a102f',
    sampleText: '#fff0f5',
    sampleBorder: 'rgba(244, 114, 182, 0.3)',
  },
  solarized_dark: {
    id: 'solarized_dark',
    name: 'Solarized Dark',
    icon: '📜',
    desc: 'Scientifically calibrated cyan-teal dark contrast',
    type: 'dark',
    sampleBg: '#00212b',
    sampleText: '#fdf6e3',
    sampleBorder: 'rgba(147, 161, 161, 0.22)',
  },
  solarized_light: {
    id: 'solarized_light',
    name: 'Solarized Light',
    icon: '📖',
    desc: 'Soft ivory cream paper with deep charcoal text',
    type: 'light',
    sampleBg: '#fdf6e3',
    sampleText: '#073642',
    sampleBorder: 'rgba(7, 54, 66, 0.2)',
  },
  sakura: {
    id: 'sakura',
    name: 'Sakura Petal',
    icon: '🌸',
    desc: 'Gentle blush rose morning with deep berry text',
    type: 'light',
    sampleBg: '#fff0f3',
    sampleText: '#4c0519',
    sampleBorder: 'rgba(244, 63, 94, 0.22)',
  },
};

export const ACCENT_PALETTES: Record<AccentColor, AccentPalette> = {
  indigo: {
    id: 'indigo',
    name: 'Electric Indigo',
    emoji: '⚡',
    primary: '#6366f1',
    primaryHover: '#4f46e5',
    primaryGlow: 'rgba(99, 102, 241, 0.35)',
  },
  leetcode: {
    id: 'leetcode',
    name: 'LeetCode Gold',
    emoji: '🧡',
    primary: '#FFA116',
    primaryHover: '#f59e0b',
    primaryGlow: 'rgba(255, 161, 22, 0.4)',
  },
  cyan: {
    id: 'cyan',
    name: 'Cyber Cyan',
    emoji: '🌊',
    primary: '#06b6d4',
    primaryHover: '#0891b2',
    primaryGlow: 'rgba(6, 182, 212, 0.35)',
  },
  emerald: {
    id: 'emerald',
    name: 'Emerald Matrix',
    emoji: '🍀',
    primary: '#10b981',
    primaryHover: '#059669',
    primaryGlow: 'rgba(16, 185, 129, 0.35)',
  },
  rose: {
    id: 'rose',
    name: 'Sakura Sunset',
    emoji: '🌸',
    primary: '#f43f5e',
    primaryHover: '#e11d48',
    primaryGlow: 'rgba(244, 63, 94, 0.35)',
  },
  amber: {
    id: 'amber',
    name: 'Solar Amber',
    emoji: '🔥',
    primary: '#f59e0b',
    primaryHover: '#d97706',
    primaryGlow: 'rgba(245, 158, 11, 0.35)',
  },
  purple: {
    id: 'purple',
    name: 'Galactic Purple',
    emoji: '🔮',
    primary: '#a855f7',
    primaryHover: '#9333ea',
    primaryGlow: 'rgba(168, 85, 247, 0.35)',
  },
  slate: {
    id: 'slate',
    name: 'Stealth Gunmetal',
    emoji: '🪙',
    primary: '#64748b',
    primaryHover: '#475569',
    primaryGlow: 'rgba(100, 116, 139, 0.35)',
  },
  crimson: {
    id: 'crimson',
    name: 'Crimson Blaze',
    emoji: '💥',
    primary: '#ef4444',
    primaryHover: '#dc2626',
    primaryGlow: 'rgba(239, 68, 68, 0.35)',
  },
  lime: {
    id: 'lime',
    name: 'Neon Lime',
    emoji: '⭐',
    primary: '#84cc16',
    primaryHover: '#65a30d',
    primaryGlow: 'rgba(132, 204, 22, 0.35)',
  },
  custom: {
    id: 'custom',
    name: 'Custom Picker',
    emoji: '🎨',
    primary: '#6366f1',
    primaryHover: '#4f46e5',
    primaryGlow: 'rgba(99, 102, 241, 0.35)',
  },
};

export const FONT_SIZE_PRESETS: Record<FontSizeOption, { label: string; size: number; desc: string }> = {
  compact: { label: 'Compact', size: 11, desc: 'Tight 11px for dense viewports' },
  normal: { label: 'Default', size: 13, desc: 'Balanced 13px standard' },
  medium: { label: 'Medium', size: 14.5, desc: 'Comfortable 14.5px reading' },
  large: { label: 'Large', size: 16, desc: 'High visibility 16px' },
  xlarge: { label: 'Extra Large', size: 18, desc: 'Maximum accessibility 18px' },
  custom: { label: 'Custom Slider', size: 13, desc: 'Manual fine-grain slider' },
};

export const RADIUS_PRESETS: Record<BorderRadiusOption, { label: string; sm: string; md: string; lg: string }> = {
  sharp: { label: 'Sharp (2px)', sm: '2px', md: '3px', lg: '4px' },
  subtle: { label: 'Subtle (6px)', sm: '4px', md: '6px', lg: '8px' },
  smooth: { label: 'Smooth (10px)', sm: '6px', md: '10px', lg: '14px' },
  rounded: { label: 'Rounded (16px)', sm: '8px', md: '14px', lg: '18px' },
  pill: { label: 'Pill (24px)', sm: '12px', md: '20px', lg: '28px' },
};

export const DEFAULT_THEME_SETTINGS: CustomThemeSettings = {
  mode: 'nordic_forest',
  accent: 'emerald',
  customAccentHex: '#2dd4bf',
  customPaletteEnabled: false,
  customBgApp: '#162124',
  customBgSurface: '#1e2b2f',
  customPrimary: '#2dd4bf',
  customTextPrimary: '#ecfdf5',
  customTextSecondary: '#94a3b8',
  fontSize: 13,
  fontSizeOption: 'normal',
  density: 'normal',
  borderRadius: 'smooth',
  glassOpacity: 85,
  highContrast: false,
  fontFamily: 'system',
};

export const THEME_SETTINGS_STORAGE_KEY = 'synqto_theme_custom_settings';
export const THEME_STORAGE_KEY = 'synqto_theme_mode';
export const ACCENT_STORAGE_KEY = 'synqto_accent_color';

export class ThemeService {
  private static instance: ThemeService | null = null;
  private settings: CustomThemeSettings = { ...DEFAULT_THEME_SETTINGS };
  private listeners: Set<(settings: CustomThemeSettings) => void> = new Set();
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
        if (this.settings.mode === 'system') {
          this.applyAllSettings(this.settings);
        }
      });
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(
        [THEME_SETTINGS_STORAGE_KEY, THEME_STORAGE_KEY, ACCENT_STORAGE_KEY],
        (res) => {
          const savedSettings = res[THEME_SETTINGS_STORAGE_KEY] as Partial<CustomThemeSettings>;
          const legacyMode = res[THEME_STORAGE_KEY] as ThemeMode;
          const legacyAccent = res[ACCENT_STORAGE_KEY] as AccentColor;

          this.settings = {
            ...DEFAULT_THEME_SETTINGS,
            ...(savedSettings || {}),
            ...(legacyMode ? { mode: legacyMode } : {}),
            ...(legacyAccent ? { accent: legacyAccent } : {}),
          };

          this.applyAllSettings(this.settings);
          this.emitChange();
        }
      );
    } else {
      this.applyAllSettings(this.settings);
    }
  }

  public getSettings(): CustomThemeSettings {
    return { ...this.settings };
  }

  public getThemeMode(): ThemeMode {
    return this.settings.mode;
  }

  public getAccentColor(): AccentColor {
    return this.settings.accent;
  }

  public updateSettings(partial: Partial<CustomThemeSettings>) {
    this.settings = { ...this.settings, ...partial };
    this.applyAllSettings(this.settings);
    this.saveSettings();
    this.emitChange();
  }

  public applyFiveColorPalette(palette: FiveColorPalette) {
    this.updateSettings({
      mode: palette.themeMode,
      accent: palette.accent,
      customAccentHex: palette.customAccentHex || palette.colors.primary,
      customPaletteEnabled: false,
      customBgApp: palette.colors.bgApp,
      customBgSurface: palette.colors.bgSurface,
      customPrimary: palette.colors.primary,
      customTextPrimary: palette.colors.textPrimary,
      customTextSecondary: palette.colors.textSecondary,
    });
  }

  public setCustomPaletteEnabled(enabled: boolean) {
    this.updateSettings({ customPaletteEnabled: enabled });
  }

  public setCustomPaletteColors(colors: Partial<{
    bgApp: string;
    bgSurface: string;
    primary: string;
    textPrimary: string;
    textSecondary: string;
  }>) {
    this.updateSettings({
      customPaletteEnabled: true,
      ...(colors.bgApp ? { customBgApp: colors.bgApp } : {}),
      ...(colors.bgSurface ? { customBgSurface: colors.bgSurface } : {}),
      ...(colors.primary ? { customPrimary: colors.primary, accent: 'custom', customAccentHex: colors.primary } : {}),
      ...(colors.textPrimary ? { customTextPrimary: colors.textPrimary } : {}),
      ...(colors.textSecondary ? { customTextSecondary: colors.textSecondary } : {}),
    });
  }

  public setThemeMode(mode: ThemeMode) {
    this.updateSettings({ mode, customPaletteEnabled: false });
  }

  public setAccentColor(accent: AccentColor) {
    this.updateSettings({ accent });
  }

  public setCustomAccentHex(hex: string) {
    this.updateSettings({ accent: 'custom', customAccentHex: hex });
  }

  public setFontSize(size: number, option: FontSizeOption = 'custom') {
    const clamped = Math.max(10, Math.min(22, size));
    this.updateSettings({ fontSize: clamped, fontSizeOption: option });
  }

  public setDensity(density: UiDensity) {
    this.updateSettings({ density });
  }

  public setBorderRadius(borderRadius: BorderRadiusOption) {
    this.updateSettings({ borderRadius });
  }

  public setGlassOpacity(glassOpacity: number) {
    const clamped = Math.max(0, Math.min(100, glassOpacity));
    this.updateSettings({ glassOpacity: clamped });
  }

  public setHighContrast(highContrast: boolean) {
    this.updateSettings({ highContrast });
  }

  public setFontFamily(fontFamily: FontFamilyOption) {
    this.updateSettings({ fontFamily });
  }

  public resetToDefaults() {
    this.settings = { ...DEFAULT_THEME_SETTINGS };
    this.applyAllSettings(this.settings);
    this.saveSettings();
    this.emitChange();
  }

  private saveSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({
        [THEME_SETTINGS_STORAGE_KEY]: this.settings,
        [THEME_STORAGE_KEY]: this.settings.mode,
        [ACCENT_STORAGE_KEY]: this.settings.accent,
      });
    }
  }

  private applyAllSettings(cfg: CustomThemeSettings) {
    if (typeof document === 'undefined') return;

    let effectiveTheme = cfg.mode;
    if (cfg.mode === 'system') {
      effectiveTheme = this.mediaQuery?.matches ? 'day' : 'night';
    }

    const root = document.documentElement;
    root.setAttribute('data-theme', effectiveTheme);
    root.setAttribute('data-accent', cfg.accent);
    root.setAttribute('data-density', cfg.density);
    root.setAttribute('data-high-contrast', String(cfg.highContrast));
    root.setAttribute('data-font', cfg.fontFamily);

    // Accent Palette calculation
    let primary = '#6366f1';
    let primaryHover = '#4f46e5';
    let primaryGlow = 'rgba(99, 102, 241, 0.35)';

    if (cfg.accent === 'custom' && cfg.customAccentHex) {
      primary = cfg.customAccentHex;
      primaryHover = this.adjustHexColor(cfg.customAccentHex, -15);
      const rgba = this.hexToRgba(cfg.customAccentHex, 0.35);
      primaryGlow = rgba || 'rgba(99, 102, 241, 0.35)';
    } else if (ACCENT_PALETTES[cfg.accent]) {
      const pal = ACCENT_PALETTES[cfg.accent];
      primary = pal.primary;
      primaryHover = pal.primaryHover;
      primaryGlow = pal.primaryGlow;
    }

    if (cfg.customPaletteEnabled) {
      root.style.setProperty('--bg-app', cfg.customBgApp);
      root.style.setProperty('--bg-surface', cfg.customBgSurface);
      root.style.setProperty('--bg-surface-elevated', this.adjustHexColor(cfg.customBgSurface, 8));
      root.style.setProperty('--bg-card', cfg.customBgSurface);
      root.style.setProperty('--bg-glass-input', cfg.customBgApp);
      root.style.setProperty('--primary', cfg.customPrimary);
      root.style.setProperty('--primary-hover', this.adjustHexColor(cfg.customPrimary, -15));
      root.style.setProperty('--primary-glow', this.hexToRgba(cfg.customPrimary, 0.35) || 'rgba(99, 102, 241, 0.35)');
      root.style.setProperty('--border-focus', `${cfg.customPrimary}80`);
      root.style.setProperty('--text-primary', cfg.customTextPrimary);
      root.style.setProperty('--text-secondary', cfg.customTextSecondary);
      root.style.setProperty('--text-muted', this.adjustHexColor(cfg.customTextSecondary, -15));
      root.style.setProperty('--border-subtle', this.hexToRgba(cfg.customTextSecondary, 0.18) || 'rgba(255, 255, 255, 0.12)');
      root.style.setProperty('--border-medium', this.hexToRgba(cfg.customTextSecondary, 0.35) || 'rgba(255, 255, 255, 0.25)');
    } else {
      root.style.removeProperty('--bg-app');
      root.style.removeProperty('--bg-surface');
      root.style.removeProperty('--bg-surface-elevated');
      root.style.removeProperty('--bg-card');
      root.style.removeProperty('--bg-glass-input');
      root.style.removeProperty('--text-primary');
      root.style.removeProperty('--text-secondary');
      root.style.removeProperty('--text-muted');
      root.style.removeProperty('--border-subtle');
      root.style.removeProperty('--border-medium');

      root.style.setProperty('--primary', primary);
      root.style.setProperty('--primary-hover', primaryHover);
      root.style.setProperty('--primary-glow', primaryGlow);
      root.style.setProperty('--border-focus', `${primary}80`);
    }

    // Typography & Font Sizes
    const base = cfg.fontSize || 13;
    root.setAttribute('data-font-size', cfg.fontSizeOption);
    root.style.setProperty('--font-size-base', `${base}px`);
    root.style.setProperty('--font-size-xs', `${Math.max(8.5, base - 2.5)}px`);
    root.style.setProperty('--font-size-sm', `${Math.max(9.5, base - 1.5)}px`);
    root.style.setProperty('--font-size-md', `${base}px`);
    root.style.setProperty('--font-size-lg', `${base + 2}px`);
    root.style.setProperty('--font-size-xl', `${base + 5}px`);
    root.style.setProperty('--font-size-title', `${base + 8}px`);
    root.style.setProperty('--font-scale', String(base / 13));

    const fontDetail = FONT_FAMILY_DETAILS[cfg.fontFamily] || FONT_FAMILY_DETAILS.system;
    root.style.setProperty('--font-sans', fontDetail.fontFamily);

    if (document.body) {
      document.body.style.fontFamily = fontDetail.fontFamily;
      document.body.style.fontSize = `${base}px`;
    }
    root.style.fontSize = `${base}px`;

    // Radius Presets
    const rad = RADIUS_PRESETS[cfg.borderRadius] || RADIUS_PRESETS.smooth;
    root.style.setProperty('--radius-sm', rad.sm);
    root.style.setProperty('--radius-md', rad.md);
    root.style.setProperty('--radius-lg', rad.lg);

    // Glass & Opacity
    const opacityFactor = (cfg.glassOpacity ?? 85) / 100;
    root.style.setProperty('--glass-opacity', String(opacityFactor));
  }

  private hexToRgba(hex: string, alpha: number): string | null {
    let clean = hex.replace('#', '');
    if (clean.length === 3) {
      clean = clean.split('').map((c) => c + c).join('');
    }
    if (clean.length !== 6) return null;
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private adjustHexColor(hex: string, percent: number): string {
    let clean = hex.replace('#', '');
    if (clean.length === 3) {
      clean = clean.split('').map((c) => c + c).join('');
    }
    if (clean.length !== 6) return hex;
    const num = parseInt(clean, 16);
    let r = (num >> 16) + Math.round(255 * (percent / 100));
    let g = ((num >> 8) & 0x00ff) + Math.round(255 * (percent / 100));
    let b = (num & 0x0000ff) + Math.round(255 * (percent / 100));
    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  private emitChange() {
    const copy = { ...this.settings };
    this.listeners.forEach((fn) => {
      try {
        fn(copy);
      } catch (e) {
        console.error('[ThemeService] Error in listener:', e);
      }
    });
  }

  public onChange(listener: (settings: CustomThemeSettings) => void): () => void {
    this.listeners.add(listener);
    listener({ ...this.settings });
    return () => {
      this.listeners.delete(listener);
    };
  }
}
