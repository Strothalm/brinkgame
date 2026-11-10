// Selectable backgrounds. Photos come from Unsplash (Unsplash License: free to use, no attribution required).
export const BACKGROUNDS = [
  { id: 'wald-lichtung', name: 'Wald, Lichtung', group: 'Wald' },
  { id: 'wald-nebel', name: 'Wald im Nebel', group: 'Wald' },
  { id: 'wald-strasse', name: 'Waldstraße', group: 'Wald' },
  { id: 'bergwald-abend', name: 'Bergwald am Abend', group: 'Wald' },
  { id: 'berge-see', name: 'Berge und Tal', group: 'Berge' },
  { id: 'berge-schnee', name: 'Schneeberge', group: 'Berge' },
  { id: 'berge-dunst', name: 'Berge im Dunst', group: 'Berge' },
  { id: 'strand-abend', name: 'Strand am Abend', group: 'Meer' },
  { id: 'stadt-nacht', name: 'Stadt bei Nacht', group: 'Stadt' },
  { id: 'nacht-berge', name: 'Milchstraße', group: 'Nacht' },
  { id: 'sterne-baeume', name: 'Sternenhimmel', group: 'Nacht' },
];

export const BG_CREDITS = 'Fotos von Unsplash (unsplash.com). Berge: Kalen Emsley, Rohit Tandon, Daniel Leone. Strand: Sean Oulashin. Stadt: Henry Chen. Nachthimmel: Chan Hoi, Ryan Hutton. Wald: Unsplash-Fotografen.';

export function bgUrl(bg) {
  if (!bg) return '';
  if (bg.id === 'custom') return bg.custom || '';
  if (bg.id === 'none') return '';
  return `backgrounds/${bg.id}.jpg`;
}

export function bgThumb(id) {
  return `backgrounds/${id}-thumb.jpg`;
}
