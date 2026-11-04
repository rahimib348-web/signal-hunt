// Decknamen im Agenten-Stil, z. B. "Falke-07".
const NAMES = [
  'Falke',
  'Fuchs',
  'Luchs',
  'Rabe',
  'Kobra',
  'Viper',
  'Wolf',
  'Marder',
  'Nebel',
  'Schatten',
  'Phantom',
  'Echo',
  'Komet',
  'Orion',
  'Sphinx',
  'Jaguar',
  'Specht',
  'Polar',
  'Kondor',
  'Mamba',
  'Delta',
  'Sigma',
  'Zero',
  'Nova',
];

export function randomCodename(random: () => number = Math.random): string {
  const name = NAMES[Math.floor(random() * NAMES.length) % NAMES.length];
  const number = String(Math.floor(random() * 100) % 100).padStart(2, '0');
  return `${name}-${number}`;
}
