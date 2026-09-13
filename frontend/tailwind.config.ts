import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
        accent: {
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
        },
        surface: {
          50: "#f7f7f8",
          100: "#f0f0f2",
          200: "#e4e4e7",
          300: "#d4d4d8",
          400: "#a1a1aa",
          500: "#71717a",
          600: "#52525b",
          700: "#3f3f46",
          800: "#27272a",
          900: "#18181b",
          950: "#0c0c0f",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      borderRadius: {
        xl: "0.9rem",
        "2xl": "1.15rem",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(0,0,0,0.04), 0 6px 24px -12px rgba(24,24,27,0.12)",
        lift: "0 2px 4px 0 rgba(0,0,0,0.04), 0 12px 32px -12px rgba(24,24,27,0.2)",
        pop: "0 16px 48px -16px rgba(24,24,27,0.28)",
      },
    },
  },
  plugins: [],
};

export default config;