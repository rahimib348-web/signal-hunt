import { Platform } from 'react-native';

// Agenten-Look: dunkel, Signal-Grün für Agenten, Rot für Jäger, Gelb für Checkpoints.
export const colors = {
  bg: '#07090B',
  surface: '#0E1317',
  surfaceRaised: '#151C21',
  border: '#22303A',
  text: '#E6F1EC',
  muted: '#8A9A93',
  faint: '#55635D',
  signal: '#2CFF9A',
  signalDim: 'rgba(44, 255, 154, 0.14)',
  hunter: '#FF3B4E',
  hunterDim: 'rgba(255, 59, 78, 0.16)',
  warning: '#FFD23F',
  warningDim: 'rgba(255, 210, 63, 0.16)',
  black: '#000000',
  white: '#FFFFFF',
} as const;

export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 16 } as const;
