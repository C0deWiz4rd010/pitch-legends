/**
 * The transfer engine writes German status texts, some of which are persisted inside saved
 * negotiations. They are translated at display time so existing saves stay unchanged.
 */
const EXACT: Record<string, string> = {
  'Angebot abgelehnt.': 'Offer rejected.',
  'Angebot ist nicht mehr offen.': 'The offer is no longer open.',
  'Budget reicht nicht für die Verlängerung.': 'The budget does not cover the extension.',
  'Das Angebot ist abgelaufen.': 'The offer has expired.',
  'Das Angebot liegt zu weit unter der Forderung.': 'The offer is too far below the asking price.',
  'Das Gehaltsangebot ist zu niedrig.': 'The salary offer is too low.',
  'Das Gehaltsbudget wird überschritten.': 'The wage budget would be exceeded.',
  'Das Transferbudget reicht nicht.': 'The transfer budget is not enough.',
  'Der Agent hat einmalig nachgebessert. Du kannst dieses Paket annehmen.': 'The agent improved the terms once. You can accept this package.',
  'Der Interessent steigt aus den Gesprächen aus.': 'The interested club walks away from the talks.',
  'Der Kader ist voll.': 'The squad is full.',
  'Kader ist voll.': 'The squad is full.',
  'Der Käufer hat nicht mehr genug Budget.': 'The buyer no longer has enough budget.',
  'Der Spieler gehört bereits zu deinem Kader.': 'The player is already in your squad.',
  'Der Spieler lehnt die Konditionen ab.': 'The player rejects the terms.',
  'Der Transfer ist nicht mehr möglich.': 'The transfer is no longer possible.',
  'Der abgebende Club kann den Spieler nicht freigeben.': 'The selling club cannot release the player.',
  'Die Ablöse ist noch nicht vereinbart.': 'The fee has not been agreed yet.',
  'Dieser Spieler ist nicht leihbar.': 'This player is not available on loan.',
  'Es ist nur ein Gegenangebot möglich.': 'Only one counter-offer is possible.',
  'Kein Gegenangebot des Agenten.': 'No counter-offer from the agent.',
  'Kein Spielstand.': 'No save loaded.',
  'Kein offenes Gegenangebot.': 'No open counter-offer.',
  'Mindestens 16 Spieler und ein Torwart müssen bleiben.': 'At least 16 players and one goalkeeper must remain.',
  'Nicht genug Budget für den Scoutbericht.': 'Not enough budget for the scouting report.',
  'Spieler nicht gefunden.': 'Player not found.',
  'Spieler oder Verein wurde nicht gefunden.': 'Player or club not found.',
  'Transferziel nicht gefunden.': 'Transfer target not found.',
  'Scoutbericht abgeschlossen: Werte und Potenzial sind jetzt verlässlicher.': 'Scouting report complete: ratings and potential are now more reliable.',
  'Scouting fehlgeschlagen.': 'Scouting failed.',
  'Gegenangebot konnte nicht angenommen werden.': 'The counter-offer could not be accepted.',
  'Vertrag gescheitert.': 'Contract talks failed.',
  'Verhandlung aktualisiert.': 'Negotiation updated.',
  'Listung fehlgeschlagen.': 'Listing failed.',
  'Verlängerung fehlgeschlagen.': 'Extension failed.',
  'Angebot aktualisiert.': 'Offer updated.',
};

const englishNumber = (value: string) => value.replace(/\./g, ',');
const PATTERNS: [RegExp, (...groups: string[]) => string][] = [
  [/^(.+) fordert CR ([\d.]+)\.$/, (club, fee) => `${club} ask for CR ${englishNumber(fee)}.`],
  [/^(.+) bietet CR ([\d.]+)\.$/, (club, fee) => `${club} offer CR ${englishNumber(fee)}.`],
  [/^(.+) akzeptiert dein Gegenangebot\.$/, club => `${club} accept your counter-offer.`],
  [/^(.+) wechselt zu (.+)\.$/, (player, club) => `${player} joins ${club}.`],
  [/^(.+) wurde verkauft\.$/, player => `${player} has been sold.`],
  [/^(.+) steht jetzt auf der Transferliste\.$/, player => `${player} is now transfer-listed.`],
  [/^(.+) wurde von der Transferliste genommen\.$/, player => `${player} has been taken off the transfer list.`],
  [/^Vertrag mit (.+) verlängert\.$/, player => `Contract with ${player} extended.`],
];

export function localizeTransferText(text: string | null | undefined, locale: 'de' | 'en'): string {
  if (!text) return '';
  if (locale === 'de') return text;
  const exact = EXACT[text];
  if (exact) return exact;
  for (const [pattern, render] of PATTERNS) {
    const match = pattern.exec(text);
    if (match) return render(...match.slice(1));
  }
  return text;
}
