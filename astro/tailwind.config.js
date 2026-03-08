/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      fontFamily: {
        main: [
          "Inter",
          "Arimo",
          "Roboto",
          "Helvetica Neue",
          "Arial Nova",
          "Nimbus Sans",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "Fragment Mono",
          "ui-monospace",
          "Cascadia Code",
          "Source Code Pro",
          "Menlo",
          "Consolas",
          "DejaVu Sans Mono",
          "monospace",
        ],
        code: [
          "ui-monospace",
          "Cascadia Code",
          "Source Code Pro",
          "Menlo",
          "Consolas",
          "DejaVu Sans Mono",
          "monospace",
        ],
      },
      colors: {
        "text-secondary": "#787a7c",
        background: "black",
        text: "white",
      },
      backgroundImage: {
        "gradient-text": "linear-gradient(14deg, #d83333 0%, #f041ff 100%)",
        "gradient-code-bg":
          "linear-gradient(66.77deg, #f3cddd 0%, #f5cee7 100%)",
        "gradient-code-border":
          "linear-gradient(155deg, #d83333 0%, #f041ff 18%, #f5cee7 45%)",
      },
      fontSize: {
        "10rem": "10rem",
        "20rem": "20rem",
      },
      lineHeight: {
        0.8: "0.8",
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        ".line-clamp-2": {
          display: "-webkit-box",
          "-webkit-line-clamp": "2",
          "-webkit-box-orient": "vertical",
          overflow: "hidden",
        },
        ".line-clamp-3": {
          display: "-webkit-box",
          "-webkit-line-clamp": "3",
          "-webkit-box-orient": "vertical",
          overflow: "hidden",
        },
      });
    },
  ],
};
