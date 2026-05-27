// Standard legal / about screens — Privacy, Terms, Disclaimer, About.
//
// Rendered as a row of buttons in the SETTINGS panel; each button opens a
// modal with the full document text. The text is parameterised by `brand`
// so the same module serves both CosmicSeeker (Solana / $SKR) and the
// legacy BaseStriker fork (Base / $STRK).
//
// Why bake the text into the bundle instead of fetching from a CMS:
//   - Works offline / inside the Capacitor APK without a backend round-trip.
//   - One review pass before each release; the text is part of the
//     versioned build, so a player who installed v1.0 sees v1.0's legal text.
//   - No third-party tracking (no Iubenda / OneTrust SDK injected).

export interface LegalBrand {
  /** Game name shown in headings. */
  brand: string;
  /** Token symbol with $ prefix, e.g. `$SKR`. */
  token: string;
  /** Chain marketing name, e.g. `Solana` / `Base`. */
  chain: string;
  /** Support email — leave blank to omit the contact line. */
  supportEmail: string;
  /** Marketing URL — leave blank to omit. */
  website: string;
  /** Publisher / developer studio name, e.g. `Chisoft`. Leave blank to omit. */
  publisher?: string;
  /** Publisher / developer website, e.g. `https://chisoft.co`. Leave blank to omit. */
  publisherUrl?: string;
  /** Effective date stamped on every doc (ISO YYYY-MM-DD). */
  effectiveDate: string;
}

/**
 * Compose the row that hosts the four legal buttons. Append it to the
 * settings list before the CLOSE button.
 */
export function legalRow(brand: LegalBrand): HTMLElement {
  const row = document.createElement('div');
  row.className = 'item';
  // Inline link-style row — buttons-as-text so it never overflows the
  // 480 px shop column and doesn't introduce a horizontal scroll on a
  // narrow phone viewport.
  row.style.padding = '10px 14px';
  const head = document.createElement('div');
  head.style.cssText = 'color:#00d4ff;font-size:10px;margin-bottom:8px';
  head.textContent = 'LEGAL · ABOUT';
  row.appendChild(head);

  const linkBar = document.createElement('div');
  linkBar.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px 10px;font-size:9px;line-height:1.8';
  row.appendChild(linkBar);

  const docs: { id: keyof typeof DOC_BUILDERS; label: string; color: string }[] = [
    { id: 'privacy',    label: 'Privacy',    color: '#00d4ff' },
    { id: 'terms',      label: 'Terms',      color: '#9d4dff' },
    { id: 'disclaimer', label: 'Disclaimer', color: '#ffd84d' },
    { id: 'about',      label: 'About',      color: '#4cff7a' },
  ];

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const a = document.createElement('a');
    a.textContent = d.label;
    a.href = '#';
    a.style.cssText = `color:${d.color};text-decoration:underline;cursor:pointer;font-size:9px`;
    a.onclick = (ev) => { ev.preventDefault(); openLegalModal(d.id, brand); };
    linkBar.appendChild(a);
    if (i < docs.length - 1) {
      const sep = document.createElement('span');
      sep.textContent = '·';
      sep.style.color = '#5a5a7a';
      linkBar.appendChild(sep);
    }
  }

  return row;
}

// ── Modal ───────────────────────────────────────────────────────────────

function openLegalModal(id: keyof typeof DOC_BUILDERS, brand: LegalBrand) {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '9999',
    background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(8px)',
    display: 'flex', alignItems: 'stretch', justifyContent: 'center',
    padding: '20px',
  } as Partial<CSSStyleDeclaration>);

  const card = document.createElement('div');
  Object.assign(card.style, {
    background: '#0a0014', border: '2px solid #9d4dff',
    boxShadow: '0 0 30px rgba(157,77,255,0.4)',
    width: '100%', maxWidth: '520px', maxHeight: '100%',
    display: 'flex', flexDirection: 'column',
    fontFamily: '"Press Start 2P", monospace',
  } as Partial<CSSStyleDeclaration>);

  const head = document.createElement('div');
  Object.assign(head.style, {
    padding: '14px 16px', borderBottom: '2px solid #9d4dff',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  } as Partial<CSSStyleDeclaration>);
  const title = document.createElement('div');
  title.style.color = '#9d4dff';
  title.style.fontSize = '11px';
  title.textContent = DOC_TITLES[id];
  head.appendChild(title);
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  Object.assign(closeBtn.style, {
    background: 'transparent', color: '#ff4860', border: 'none',
    fontSize: '20px', fontFamily: 'inherit', cursor: 'pointer',
    padding: '0 6px', lineHeight: '1',
  } as Partial<CSSStyleDeclaration>);
  closeBtn.onclick = () => overlay.remove();
  head.appendChild(closeBtn);
  card.appendChild(head);

  const body = document.createElement('div');
  Object.assign(body.style, {
    flex: '1', overflowY: 'auto', padding: '16px 18px',
    color: '#cccce0', fontSize: '10px', lineHeight: '1.7',
    // Force the body font to a comfortable reading sans-serif. The
    // headings inherit the retro arcade font.
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    whiteSpace: 'pre-wrap',
  } as Partial<CSSStyleDeclaration>);
  body.innerHTML = DOC_BUILDERS[id](brand);
  card.appendChild(body);

  overlay.appendChild(card);
  // Click outside the card → dismiss. Click inside the card → don't bubble.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  // Escape closes the modal too.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
}

// ── Document bodies ────────────────────────────────────────────────────

const DOC_TITLES: Record<'privacy' | 'terms' | 'disclaimer' | 'about', string> = {
  privacy:    'PRIVACY POLICY',
  terms:      'TERMS OF SERVICE',
  disclaimer: 'DISCLAIMER',
  about:      'ABOUT',
};

const DOC_BUILDERS = {
  privacy:    privacyDoc,
  terms:      termsDoc,
  disclaimer: disclaimerDoc,
  about:      aboutDoc,
};

function h2(text: string) {
  return `<div style="color:#00d4ff;font-size:11px;margin:14px 0 8px;font-family:'Press Start 2P',monospace">${text}</div>`;
}
function p(text: string) {
  return `<p style="margin:0 0 10px">${text}</p>`;
}
function li(text: string) {
  return `<li style="margin:0 0 6px">${text}</li>`;
}
function ul(items: string[]) {
  return `<ul style="margin:0 0 10px;padding-left:18px">${items.map(li).join('')}</ul>`;
}
function footer(brand: LegalBrand) {
  const bits: string[] = [];
  bits.push(`Effective ${brand.effectiveDate}.`);
  if (brand.publisher && brand.publisherUrl) {
    bits.push(`Published by <a style="color:#00d4ff" href="${brand.publisherUrl}" target="_blank" rel="noopener">${brand.publisher}</a>`);
  } else if (brand.publisher) {
    bits.push(`Published by ${brand.publisher}`);
  }
  if (brand.supportEmail) bits.push(`Contact: <a style="color:#00d4ff" href="mailto:${brand.supportEmail}">${brand.supportEmail}</a>`);
  if (brand.website) bits.push(`<a style="color:#00d4ff" href="${brand.website}" target="_blank" rel="noopener">${brand.website}</a>`);
  return `<div style="margin-top:18px;padding-top:10px;border-top:1px solid #2a1a4a;color:#7a7a9a;font-size:9px">${bits.join(' · ')}</div>`;
}

function privacyDoc(b: LegalBrand): string {
  return [
    p(`${b.brand} is an on-chain arcade game. This policy covers what we collect, what we don't, and how to make us forget you.`),

    h2('What we collect'),
    ul([
      `<strong>Wallet address (public).</strong> The base58 / 0x pubkey you connect with. It's public information on ${b.chain}; we use it to record your progress, leaderboard rank, and reward claims.`,
      `<strong>Gameplay metrics.</strong> Level, score, time, input timestamps, and run seed. Needed to verify scores are physically possible.`,
      `<strong>IP address.</strong> Stored transiently for rate limiting at the score-attestation API. Not linked to wallets in our database.`,
      `<strong>Stripe metadata</strong> (only if you use the fiat onramp). Stripe holds the card; we receive the session id + your wallet address as metadata.`,
    ]),

    h2("What we don't collect"),
    ul([
      'Real names, postal addresses, phone numbers.',
      `Private keys, seed phrases, or passwords — we never see them. Signing happens on your device via the Mobile Wallet Adapter (Seeker) or your browser wallet.`,
      'Behavioural ad-tracking cookies. No Google Analytics, no Facebook Pixel, no third-party SDKs in the app build.',
    ]),

    h2('Where it lives'),
    p(`Our server is a single SQLite database. Backups are encrypted at rest. The on-chain layer (${b.chain}) is, by design, public; anything you sign with your wallet is visible to anyone with a node RPC.`),

    h2('How long we keep it'),
    p('Run metrics: 24 months rolling, then aggregated. IP addresses: 14 days. Wallet ↔ leaderboard entries: kept indefinitely as part of the public leaderboard (you can request anonymisation; see "Your rights").'),

    h2('Your rights (GDPR / similar)'),
    ul([
      'Access — request a JSON dump of every row tied to your wallet.',
      'Erasure — request anonymisation. On-chain history cannot be erased (the chain is the chain), but we will replace your wallet → display name mapping with a random handle on our side.',
      'Portability — same as access; the dump is in plain JSON.',
      'Objection — close the app, disconnect the wallet. We collect nothing if you don\'t play.',
    ]),

    h2('Cookies and local storage'),
    p('We use <code>localStorage</code> to remember your audio settings, current level, points, and shop inventory. There are no tracking cookies. Clearing site data resets your progress.'),

    h2('Children'),
    p(`${b.brand} is intended for players aged 13 and over. We do not knowingly collect data from anyone younger; if you believe a child has connected a wallet to our service, contact us and we'll anonymise the record.`),

    h2('Changes'),
    p('We may update this policy when the law changes or when we ship a new feature that changes data flow. Updates are versioned in the app build itself — the policy you read at install time is the one that applies to your install.'),

    footer(b),
  ].join('');
}

function termsDoc(b: LegalBrand): string {
  return [
    p(`These Terms govern your use of ${b.brand}. By installing or playing, you agree to them. If you don't, uninstall.`),

    h2('What you can do'),
    ul([
      `Play the game on any device that supports it (Seeker phone, Android, modern desktop browser).`,
      `Connect your own wallet to earn, spend, and claim ${b.token}.`,
      `Stream or record gameplay. Use the screenshots in articles or reviews.`,
    ]),

    h2('What you must not do'),
    ul([
      `Cheat. Modify the client, replay attacks, automated input macros, or any other circumvention of the score-attestation flow will get the offending wallet banned from the leaderboard.`,
      `Run more than one wallet per real person to multiply rewards (Sybil farming).`,
      `Reverse-engineer the backend, brute-force the score-attestation API, or scrape rate-limited endpoints.`,
      `Use ${b.brand} to launder funds, evade sanctions, or for any purpose illegal in your jurisdiction.`,
    ]),

    h2('Token utility'),
    p(`${b.token} is a utility token used inside ${b.brand} for shop purchases, equipment crafting, and weighted governance (post-launch). It is not equity, debt, a security, or a promise of future value. We do not guarantee any market price or buyer for ${b.token} outside the game's economy.`),

    h2('Account suspension'),
    p('We may suspend a wallet from earning rewards (but not from playing for fun) for any breach of these Terms. We do not unilaterally seize tokens — anything in your wallet stays in your wallet.'),

    h2('Liability'),
    p(`To the maximum extent permitted by law, ${b.brand} is provided <strong>"AS IS"</strong> without warranty of any kind. We are not liable for indirect, incidental, special, consequential, or punitive damages — including loss of profits, data, or use — arising from your use of the game, even if we were advised of the possibility of such damage. Our aggregate liability for any direct damages is capped at the ${b.token} balance of your connected wallet at the time the claim arose.`),

    h2('Disputes'),
    p('Disputes will first be raised informally via the support email below. If unresolved within 60 days, disputes are settled by arbitration in a jurisdiction to be confirmed before TGE. Class actions are waived where applicable law permits.'),

    h2('Changes'),
    p('We may update these Terms when the law changes or when new game features require it. Each release carries the Terms current at build time; continuing to play after a Terms update means you accept the new Terms.'),

    footer(b),
  ].join('');
}

function disclaimerDoc(b: LegalBrand): string {
  return [
    p(`<strong>Read this before you buy ${b.token} or connect a wallet.</strong>`),

    h2('Not financial advice'),
    p(`Nothing inside ${b.brand} — including the in-game shop UI, the tokenomics document, the whitepaper, social media accounts, or anything said by the team — is investment, financial, tax, legal, or accounting advice. ${b.token} is a utility token used to play the game. Treat any purchase as money spent on a game, not as an investment.`),

    h2('Volatility'),
    p(`The price of ${b.token} (and of ${b.chain}'s native token, and of any stablecoin) can go to zero. Smart-contract bugs, oracle failures, regulatory action, exchange delistings, exit liquidity drying up — these are real risks. Play with funds you are prepared to lose.`),

    h2('Smart-contract risk'),
    p(`The on-chain ${b.chain} programs that power ${b.brand} are audited but not provably bug-free. A vulnerability could drain the treasury, freeze the shop, or invalidate a claim. Our audits, bug bounty, and incident-response plan are documented in the whitepaper.`),

    h2('Regulatory risk'),
    p(`The legal status of in-game crypto tokens varies by country. ${b.brand} does not target any specific jurisdiction; YOU are responsible for verifying that playing, earning, and trading ${b.token} is legal where you live. We may geo-block access if a regulator requires it.`),

    h2('No promise of future development'),
    p(`Features described in the whitepaper, roadmap, or social posts represent intent at the time of writing, not commitments. We may pivot, deprecate features, or stop development entirely. Funds you spent on shop items will not be refunded if a feature ships differently than described.`),

    h2('Wallet hygiene'),
    p(`Always verify the URL before signing. We will never DM you for your seed phrase. We will never airdrop ${b.token} to wallets that didn't earn it on-chain — anything that looks like a "claim your tokens" link from a third party is a scam.`),

    footer(b),
  ].join('');
}

function aboutDoc(b: LegalBrand): string {
  const stack = (b.chain.toLowerCase() === 'solana')
    ? 'Vite, TypeScript, Canvas 2D, Capacitor, Anchor, Solana web3.js, Mobile Wallet Adapter'
    : 'Vite, TypeScript, Canvas 2D, viem, wagmi, Foundry';
  const publisherBlock = b.publisher
    ? [
        h2('Publisher'),
        p(b.publisherUrl
          ? `Published by <strong>${b.publisher}</strong> — <a style="color:#00d4ff" href="${b.publisherUrl}" target="_blank" rel="noopener">${b.publisherUrl.replace(/^https?:\/\//, '')}</a>. Independent game studio based in Prague, Czech Republic.`
          : `Published by <strong>${b.publisher}</strong>.`),
      ].join('')
    : '';
  return [
    p(`${b.brand} — a Galaxian-inspired arcade shooter with a fully on-chain economy.`),

    publisherBlock,

    h2('Tech'),
    p(stack),

    h2('Open content'),
    p(`Source layout and contract / program code are part of the project workspace. Game art and the ${b.brand} branding are © the contributors and may not be used to label other games.`),

    h2('Credits'),
    ul([
      'Game design, engine, on-chain integration: the CosmicSeeker contributors.',
      'Press Start 2P font: codeman38 (SIL Open Font License).',
      `Audio: synthesised in-engine with the Web Audio API; no third-party samples.`,
    ]),

    h2('Acknowledgements'),
    p(`Built on top of the work of countless open-source authors. ${b.chain} core, Anchor, Capacitor, Solana Mobile, Vite — none of this exists without them.`),

    h2('Bug reports'),
    p(b.supportEmail
      ? `Send a wallet address, screenshot, and "what happened" to ${b.supportEmail}. We triage in the order we get them.`
      : `File issues at ${b.website || 'the project repository'}. Include wallet address, screenshot, and "what happened". We triage in the order we get them.`),

    footer(b),
  ].join('');
}
