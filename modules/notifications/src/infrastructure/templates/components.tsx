import type { ReactNode } from 'react';

// The email components of the "Email: shared layout", "Email: components" and "Email style sheet" artboards
// (docs/01-design/artboards/ELayout, EComponents, EStyle): nested tables, 600 px at most, inline light colours with
// the dark ones in a prefers-color-scheme block, logical alignment from `dir`. Only the components a template uses
// are built; StatusLine, TextLink, QuotedNote, ChangeList, DetailTable and CompetencyTable come with their templates.

// The EStyle colour tokens. Mail clients need literal values, and modules may not import @aivera/tokens (AGENTS.md
// 9.4), so they are written here; each equals its Case file token (packages/tokens/src/tokens.json).
// shortcut: nothing fails when a token changes and these do not; add a check under tests/ if the palette starts moving (AIV-P5-E03, #34)
export const color = {
  light: {
    bg: '#F6F4F1',
    card: '#FFFFFF',
    text: '#1B1720',
    textMuted: '#55505A',
    border: '#E4DFD9',
    logoBorder: '#CFC8C0',
    subtle: '#EFECE8',
    button: '#1B1720',
    onButton: '#FFFFFF',
    highlight: '#FFE873',
    onHighlight: '#1B1720',
  },
  dark: {
    bg: '#141118',
    card: '#1D1922',
    text: '#F4F1F6',
    textMuted: '#BDB5C6',
    border: '#322C3B',
    logoBorder: '#4A4355',
    subtle: '#262130',
    button: '#F4F1F6',
    onButton: '#1B1720',
    highlight: '#4D4208',
    onHighlight: '#FFF3B0',
  },
};
const c = color.light;
const font = "'Hanken Grotesk', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const mono = 'Menlo, Consolas, monospace';

// Classes only switch colours (dark) and the 375 px layout; every value also sits inline for clients without <style>.
const css = `
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
.e-bg{background-color:${color.dark.bg}!important}
.e-card{background-color:${color.dark.card}!important;border-color:${color.dark.border}!important}
.e-text,.e-text strong,.e-text h1{color:${color.dark.text}!important}
.e-muted,.e-muted a{color:${color.dark.textMuted}!important}
.e-muted strong{color:${color.dark.text}!important}
.e-rule{border-color:${color.dark.border}!important}
.e-subtle{background-color:${color.dark.subtle}!important;border-color:${color.dark.border}!important}
.e-icon{stroke:${color.dark.textMuted}!important}
.e-button{background-color:${color.dark.button}!important}
.e-button a{color:${color.dark.onButton}!important}
.e-hl{background-color:${color.dark.highlight}!important;color:${color.dark.onHighlight}!important}
.e-logo{border-color:${color.dark.logoBorder}!important}
}
@media (max-width:480px){
.e-outer{padding:12px!important}
.e-pad{padding-left:20px!important;padding-right:20px!important}
.e-header{padding-top:12px!important}
.e-footer{padding-bottom:12px!important}
.e-h1{font-size:24px!important;line-height:30px!important}
.e-full{width:100%!important}
}`;

export type Direction = 'ltr' | 'rtl';
const startOf = (dir: Direction): 'left' | 'right' => (dir === 'rtl' ? 'right' : 'left');

const body = (dir: Direction) => ({
  fontFamily: font,
  fontSize: '16px',
  lineHeight: '24px',
  color: c.text,
  fontWeight: 400,
  textAlign: startOf(dir),
});

/** One body block: 16 below, 32 at the sides (20 on mobile). */
function Block({ dir, children, top = 0 }: { dir: Direction; children: ReactNode; top?: number }) {
  return (
    <tr>
      <td className="e-pad e-text" style={{ padding: `${top}px 32px 16px`, ...body(dir) }}>
        {children}
      </td>
    </tr>
  );
}

export function Heading({ dir, children }: { dir: Direction; children: ReactNode }) {
  return (
    <Block dir={dir}>
      <h1
        className="e-h1"
        style={{
          margin: 0,
          fontFamily: font,
          fontSize: '26px',
          lineHeight: '32px',
          fontWeight: 700,
          letterSpacing: '-0.01em',
          color: c.text,
        }}
      >
        {children}
      </h1>
    </Block>
  );
}

export const Text = Block;

/** The only place the highlighter appears: the exact evidence a statement rests on. */
export function Evidence({ children }: { children: ReactNode }) {
  return (
    <span
      className="e-hl"
      style={{ backgroundColor: c.highlight, color: c.onHighlight, padding: '1px 3px', borderRadius: '3px' }}
    >
      {children}
    </span>
  );
}

/** One fact the reader must not miss; the info icon is decorative (aria-hidden), the words carry the meaning. */
export function Callout({ dir, children }: { dir: Direction; children: ReactNode }) {
  return (
    <tr>
      <td className="e-pad" style={{ padding: '0 32px 16px' }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
          <tbody>
            <tr>
              <td
                className="e-subtle e-text"
                style={{
                  padding: '14px 16px',
                  backgroundColor: c.subtle,
                  border: `1px solid ${c.border}`,
                  borderRadius: '8px',
                  ...body(dir),
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={c.textMuted}
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="e-icon"
                  style={{ verticalAlign: '-3px' }}
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v6M12 7.5v.5" />
                </svg>
                {'  '}
                {children}
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  );
}

/** The one primary action: ink fill, 48 tall, full width on mobile; followed by CopyLink. */
export function Button({ dir, href, children }: { dir: Direction; href: string; children: ReactNode }) {
  return (
    <tr>
      <td className="e-pad" align={startOf(dir)} style={{ padding: '8px 32px 8px' }}>
        <table role="presentation" className="e-full" cellPadding={0} cellSpacing={0} border={0}>
          <tbody>
            <tr>
              <td className="e-button" align="center" style={{ backgroundColor: c.button, borderRadius: '8px' }}>
                <a
                  href={href}
                  style={{
                    display: 'block',
                    padding: '14px 24px',
                    fontFamily: font,
                    fontSize: '16px',
                    lineHeight: '20px',
                    fontWeight: 700,
                    color: c.onButton,
                    textDecoration: 'none',
                    borderRadius: '8px',
                  }}
                >
                  {children}
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  );
}

export function CopyLink({ dir, label, href }: { dir: Direction; label: string; href: string }) {
  return (
    <tr>
      <td
        className="e-pad e-muted"
        style={{ padding: '0 32px 16px', ...body(dir), fontSize: '14px', lineHeight: '20px', color: c.textMuted }}
      >
        {label}{' '}
        <span
          dir="ltr"
          className="e-text"
          style={{ fontFamily: mono, fontSize: '13px', wordBreak: 'break-all', color: c.text }}
        >
          {href}
        </span>
      </td>
    </tr>
  );
}

export type LayoutCopy = {
  lang: string;
  dir: Direction;
  title: string;
  preheader: string;
  logoUrl: string;
  logoAlt: string;
  brand: string;
  sentBy: string;
  /** "Synthetic data — development environment", shown only outside the pilot and production (AGENTS.md 1.1). */
  devBand: string | null;
  footer: {
    workspace: string;
    reason: string;
    replies: string;
    links: { label: string; href: string }[];
  };
};

/** EmailLayout: DevBand, Header (logo and name), SentBy, the body slot, and Footer. */
export function EmailLayout({ copy, children }: { copy: LayoutCopy; children: ReactNode }) {
  const align = startOf(copy.dir);
  const small = { fontFamily: font, fontSize: '14px', lineHeight: '20px', color: c.textMuted, textAlign: align };
  return (
    <html lang={copy.lang} dir={copy.dir}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <title>{copy.title}</title>
        <style>{css}</style>
      </head>
      <body className="e-bg" style={{ margin: 0, backgroundColor: c.bg }}>
        <table
          role="presentation"
          className="e-bg"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          bgcolor={c.bg}
          style={{ backgroundColor: c.bg }}
        >
          <tbody>
            <tr>
              <td className="e-outer" align="center" style={{ padding: '24px' }}>
                <span style={{ display: 'none', maxHeight: 0, overflow: 'hidden' }}>{copy.preheader}</span>
                <table
                  role="presentation"
                  className="e-card"
                  width="100%"
                  cellPadding={0}
                  cellSpacing={0}
                  border={0}
                  bgcolor={c.card}
                  style={{
                    maxWidth: '600px',
                    backgroundColor: c.card,
                    border: `1px solid ${c.border}`,
                    borderRadius: '12px',
                    overflow: 'hidden',
                  }}
                >
                  <tbody>
                    {copy.devBand && (
                      <tr>
                        <td
                          align="center"
                          style={{
                            backgroundColor: c.text,
                            padding: '8px 16px',
                            fontFamily: font,
                            fontSize: '14px',
                            lineHeight: '20px',
                            fontWeight: 700,
                            color: c.card,
                          }}
                        >
                          {copy.devBand}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="e-pad e-header" style={{ padding: '24px 32px 8px', textAlign: align }}>
                        <img
                          className="e-logo"
                          src={copy.logoUrl}
                          alt={copy.logoAlt}
                          width="32"
                          height="32"
                          style={{
                            display: 'inline-block',
                            verticalAlign: 'middle',
                            borderRadius: '8px',
                            border: `1px solid ${c.logoBorder}`,
                          }}
                        />
                        <span
                          className="e-text"
                          style={{
                            fontFamily: font,
                            fontSize: '18px',
                            fontWeight: 700,
                            color: c.text,
                            verticalAlign: 'middle',
                            paddingInlineStart: '10px',
                          }}
                        >
                          {copy.brand}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className="e-pad e-muted" style={{ padding: '0 32px 20px', ...small }}>
                        {copy.sentBy}
                      </td>
                    </tr>
                    {children}
                    <tr>
                      <td
                        className="e-pad e-footer e-muted e-rule"
                        style={{
                          padding: '20px 32px 24px',
                          borderTop: `1px solid ${c.border}`,
                          ...small,
                          lineHeight: '21px',
                        }}
                      >
                        <strong style={{ color: c.text }}>{copy.footer.workspace}</strong>
                        <br />
                        {copy.footer.reason}
                        <br />
                        {copy.footer.replies}
                        <br />
                        <span style={{ display: 'inline-block', paddingTop: '10px' }}>
                          {copy.footer.links.map((link, i) => (
                            <span key={link.href}>
                              {i > 0 && ' ·  '}
                              <a href={link.href} style={{ color: c.textMuted, textDecoration: 'underline' }}>
                                {link.label}
                              </a>
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}
