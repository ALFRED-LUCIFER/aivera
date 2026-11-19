import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

type AuthPageProps = {
  wordmark: string;
  /** The display headline; the page wraps "evidence" in the highlighter. */
  headline: ReactNode;
  points: readonly string[];
  title: string;
  lead: string;
  children: ReactNode;
};

const check = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="mt-0.75 size-4.5 flex-none"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

/** The headline's highlighter: light tokens keep it bright on the ink panel; globals.css sweeps it in. */
export const inkMark = (chunks: ReactNode) => (
  <mark data-theme="light" className="mk-sweep rounded-tag bg-hl px-1.5 text-hl-text box-decoration-clone">
    {chunks}
  </mark>
);

const pad = 'min-w-0 p-[clamp(28px,5vw,64px)]';

/** The SignIn and SignUp artboards: the ink panel with the promise, the form on the right (stacks when narrow). */
export function AuthPage({ wordmark, headline, points, title, lead, children }: AuthPageProps) {
  return (
    <div className="flex min-h-screen flex-wrap bg-bg text-text">
      {/* An ink panel: dark tokens in either theme, as on the website's pilot band. */}
      <aside data-theme="dark" className={`${pad} flex flex-[5_1_360px] flex-col gap-10 bg-surface text-text`}>
        <Link
          href="/"
          className="flex items-center gap-2.5 self-start font-display text-[20px] font-bold tracking-[-0.01em] text-text no-underline"
        >
          <Image
            src="/brand/aivera-mark.png"
            alt=""
            width={34}
            height={34}
            className="rounded-[9px] ring-1 ring-border-strong"
          />
          {wordmark}
        </Link>
        <div className="my-auto flex flex-col gap-6">
          <p className="max-w-[14ch] font-display text-[clamp(30px,3.6vw,48px)] leading-[1.08] font-bold tracking-[-0.03em]">
            {headline}
          </p>
          <ul className="flex max-w-[40ch] flex-col gap-3.5 text-[16px] leading-6 text-text-2">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-3">
                {/* Light tokens keep the check the bright highlighter on the ink panel (CHome does the same). */}
                <span data-theme="light" className="flex text-hl">
                  {check}
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <main id="content" className={`${pad} flex flex-[6_1_420px] items-center justify-center`}>
        <div className="flex w-full max-w-110 flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-[32px] leading-10 font-bold tracking-[-0.02em] text-balance">{title}</h1>
            <p className="text-[16px] leading-6 text-text-2">{lead}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
