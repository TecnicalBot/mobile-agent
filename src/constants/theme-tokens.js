const Colors = {
  light: {
    text: "#132322",
    background: "#F2F7F6",
    backgroundElement: "#E5EFED",
    backgroundSelected: "#D7E5E2",
    textSecondary: "#536967",
    border: "#CFDEDB",
    input: "#FAFCFB",
    ring: "#23877E",
    accent: "#DCEEEA",
    accentForeground: "#163D38",
    syntaxComment: "#667873",
    syntaxConstant: "#B44B5B",
    syntaxFunction: "#176D8A",
    syntaxKeyword: "#7753A6",
    syntaxNumber: "#9A5A19",
    syntaxOperator: "#177A70",
    syntaxRegex: "#8B641D",
    syntaxString: "#2D7A50",
    destructive: "#D43E56",
    destructiveForeground: "#FFFFFF",
  },
  dark: {
    text: "#EAF4F1",
    background: "#091212",
    backgroundElement: "#12211F",
    backgroundSelected: "#1D3330",
    textSecondary: "#9DB5B0",
    border: "#28413D",
    input: "#0E1B1A",
    ring: "#63D5C6",
    accent: "#1A3430",
    accentForeground: "#D4FBF3",
    syntaxComment: "#92A9A1",
    syntaxConstant: "#FF788E",
    syntaxFunction: "#73C8F6",
    syntaxKeyword: "#C2A0FF",
    syntaxNumber: "#FFB86B",
    syntaxOperator: "#65DCCB",
    syntaxRegex: "#ECD37C",
    syntaxString: "#8DDEA9",
    destructive: "#FF647C",
    destructiveForeground: "#2B090D",
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
