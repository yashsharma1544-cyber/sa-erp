import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#14532d", light: "#dcfce7" },
      },
    },
  },
  plugins: [],
} satisfies Config;
