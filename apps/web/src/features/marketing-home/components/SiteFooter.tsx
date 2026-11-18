import { links } from '../domain/links.ts';
import { column } from '../domain/layout.ts';

export type SiteFooterProps = {
  wordmark: string;
  footerLabel: string;
  howItWorks: string;
  roles: string;
  trust: string;
  signIn: string;
  copyright: string;
};

const footerLink = 'inline-flex min-h-11 items-center text-text-2 hover:text-text';

/** The website footer (Landing artboard). */
export function SiteFooter(p: SiteFooterProps) {
  return (
    <footer className="border-t border-border">
      <div className={`${column} flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-6 text-body`}>
        <span className="font-display text-card font-bold">{p.wordmark}</span>
        <nav aria-label={p.footerLabel} className="flex flex-wrap gap-x-5">
          <a className={footerLink} href={links.howItWorks}>
            {p.howItWorks}
          </a>
          <a className={footerLink} href={links.roles}>
            {p.roles}
          </a>
          <a className={footerLink} href={links.trust}>
            {p.trust}
          </a>
          <a className={footerLink} href={links.signIn}>
            {p.signIn}
          </a>
        </nav>
        {/* shortcut: the privacy notice and terms links join this row when AIV-P5-011 publishes them. */}
        <span className="text-meta text-text-2">{p.copyright}</span>
      </div>
    </footer>
  );
}
