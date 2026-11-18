import tokens from './tokens.json' with { type: 'json' };

type Theme = 'light' | 'dark';

const declarations = (vars: Record<string, string>, prefix = '') =>
  Object.entries(vars)
    .map(([name, value]) => `  --${prefix}${name}: ${value};`)
    .join('\n');

const themeVars = (theme: Theme) => ({ ...tokens.color[theme], ...tokens.shadow[theme] });

/** The CSS custom properties for both themes. Light is the default; dark applies under data-theme="dark". */
export function toCss(): string {
  return [
    '/* Generated from tokens.json by pnpm --filter @aivera/tokens build. Do not edit. */',
    ':root,',
    '[data-theme="light"] {',
    '  color-scheme: light;',
    declarations(themeVars('light')),
    declarations(tokens.space, 'space-'),
    declarations(tokens.radius, 'radius-'),
    declarations(tokens.control, 'control-'),
    declarations(tokens.motion, 'motion-'),
    '}',
    '',
    '[data-theme="dark"] {',
    '  color-scheme: dark;',
    declarations(themeVars('dark')),
    '}',
    '',
  ].join('\n');
}
