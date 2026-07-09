const { Colors, MaxContentWidth, Spacing } = require("./src/constants/theme-tokens");

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "media",
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      // These semantic tokens stay in Tailwind config because NativeWind still
      // needs them to generate native classes; the CSS variables live in
      // src/app/global.css for web alignment with shadcn-style theming.
      colors: {
        background: Colors.light.background,
        "background-dark": Colors.dark.background,
        foreground: Colors.light.text,
        "foreground-dark": Colors.dark.text,
        card: Colors.light.backgroundElement,
        "card-dark": Colors.dark.backgroundElement,
        popover: Colors.light.background,
        "popover-dark": Colors.dark.input,
        muted: Colors.light.backgroundSelected,
        "muted-dark": Colors.dark.backgroundSelected,
        "muted-foreground": Colors.light.textSecondary,
        "muted-foreground-dark": Colors.dark.textSecondary,
        "popover-foreground": Colors.light.text,
        "popover-foreground-dark": Colors.dark.text,
        border: Colors.light.border,
        "border-dark": Colors.dark.border,
        input: Colors.light.input,
        "input-dark": Colors.dark.input,
        ring: Colors.light.ring,
        "ring-dark": Colors.dark.ring,
        secondary: Colors.light.backgroundSelected,
        "secondary-dark": Colors.dark.backgroundSelected,
        destructive: Colors.light.destructive,
        "destructive-dark": Colors.dark.destructive,
        "destructive-foreground": Colors.light.destructiveForeground,
        "destructive-foreground-dark": Colors.dark.destructiveForeground,
      },
      fontFamily: {
        sans: ["system-ui"],
        serif: ["ui-serif"],
        rounded: ["ui-rounded"],
        mono: ["ui-monospace"],
      },
      spacing: {
        "sp-half": `${Spacing.half}px`,
        "sp-1": `${Spacing.one}px`,
        "sp-2": `${Spacing.two}px`,
        "sp-3": `${Spacing.three}px`,
        "sp-4": `${Spacing.four}px`,
        "sp-5": `${Spacing.five}px`,
        "sp-6": `${Spacing.six}px`,
      },
      borderRadius: {
        ui: `${Spacing.three}px`,
        card: `${Spacing.four}px`,
        pill: `${Spacing.five}px`,
      },
      maxWidth: {
        content: `${MaxContentWidth}px`,
      },
    },
  },
  plugins: [],
};
