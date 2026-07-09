const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    border: '#D4D7DE',
    input: '#FFFFFF',
    ring: '#94A3B8',
    destructive: '#DC2626',
    destructiveForeground: '#FFFFFF',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    border: '#3A3F46',
    input: '#181A1D',
    ring: '#64748B',
    destructive: '#EF4444',
    destructiveForeground: '#FFFFFF',
  },
};

const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
};

const MaxContentWidth = 800;

module.exports = {
  Colors,
  MaxContentWidth,
  Spacing,
};
