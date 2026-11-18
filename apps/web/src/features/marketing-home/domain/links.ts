// Where the website's calls to action go. Section anchors are the ids of the sections below the hero.
export const links = {
  // shortcut: sign-up opens through the sign-in page (the tenant's hosted page offers "Sign up", then the no-workspace
  // page creates the workspace); point this at /signup when AIV-P1-059 ships that route.
  signUp: '/sign-in',
  signIn: '/sign-in',
  product: '/app',
  candidates: '/candidates',
  howItWorks: '#how-it-works',
  roles: '#roles',
  trust: '#why-trust-it',
} as const;

/** The five "How it works" steps, in order; each is `home.how.steps.<key>.title` and `.body` in packages/i18n. */
export const howSteps = ['agree', 'collect', 'rank', 'interview', 'decide'] as const;
