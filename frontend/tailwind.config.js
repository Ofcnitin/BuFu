module.exports = {
  content: ["./index.html", "./app.js"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "secondary-container": "#feb194", "inverse-primary": "#ffb59f", "on-tertiary": "#ffffff",
        "secondary": "#8a4f38", "on-error": "#ffffff", "inverse-surface": "#313030",
        "on-error-container": "#93000a", "primary-fixed-dim": "#ffb59f", "on-secondary-fixed": "#370e01",
        "on-tertiary-container": "#3e3634", "primary-container": "#ff7a50", "tertiary": "#665c59",
        "primary-fixed": "#ffdbd0", "surface-container-highest": "#e5e2e1", "surface-container": "#f0eded",
        "surface-bright": "#fcf9f8", "on-background": "#1c1b1b", "secondary-fixed": "#ffdbce",
        "on-primary-fixed": "#3a0a00", "error-container": "#ffdad6", "background": "#fcf9f8",
        "surface-container-low": "#f6f3f2", "on-surface": "#1c1b1b", "on-secondary": "#ffffff",
        "surface-dim": "#dcd9d9", "tertiary-fixed-dim": "#d0c4c0", "surface-container-high": "#eae7e7",
        "tertiary-container": "#ab9f9c", "on-primary-container": "#6b1b00", "outline-variant": "#dfc0b7",
        "outline": "#8b716a", "on-primary": "#ffffff", "error": "#ba1a1a", "secondary-fixed-dim": "#ffb599",
        "inverse-on-surface": "#f3f0ef", "on-tertiary-fixed": "#211a18", "on-primary-fixed-variant": "#852400",
        "on-secondary-container": "#79422b", "on-surface-variant": "#58423b", "tertiary-fixed": "#ede0dc",
        "primary": "#a73a15", "surface": "#fcf9f8", "surface-container-lowest": "#ffffff",
        "surface-tint": "#a73a15", "surface-variant": "#e5e2e1", "on-tertiary-fixed-variant": "#4d4542",
        "on-secondary-fixed-variant": "#6d3823"
      },
      borderRadius: { DEFAULT: "0.25rem", lg: "0.5rem", xl: "0.75rem", "2xl": "1rem", full: "9999px" },
      spacing: { "stack-lg": "48px", "stack-sm": "12px", "gutter": "24px", "container-padding": "32px", "stack-md": "24px", base: "8px", "margin-mobile": "16px" },
      fontFamily: {
        "body-lg": ["Inter"], "display-lg": ["Inter"], "headline-lg": ["Inter"], "title-md": ["Inter"],
        "headline-lg-mobile": ["Inter"], "label-bold": ["Inter"], "body-sm": ["Inter"], "label-caps": ["Inter"]
      },
      fontSize: {
        "body-lg": ["16px", { lineHeight: "26px", fontWeight: "400" }],
        "display-lg": ["40px", { lineHeight: "48px", letterSpacing: "-0.02em", fontWeight: "700" }],
        "headline-lg": ["28px", { lineHeight: "36px", letterSpacing: "-0.01em", fontWeight: "700" }],
        "title-md": ["18px", { lineHeight: "24px", fontWeight: "600" }],
        "headline-lg-mobile": ["22px", { lineHeight: "28px", fontWeight: "700" }],
        "label-bold": ["12px", { lineHeight: "16px", letterSpacing: "0.05em", fontWeight: "600" }],
        "body-sm": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "label-caps": ["11px", { lineHeight: "14px", letterSpacing: "0.1em", fontWeight: "700" }]
      }
    }
  },
  plugins: []
};
