export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: { "on-tertiary-container":"#3a2020","on-secondary":"#ffffff","surface-container-highest":"#e6e0d6","tertiary":"#8c3c3c","surface-container":"#f2ece4","surface-variant":"#ece6dc","surface-container-high":"#ece6dc","secondary-container":"#eae2da","on-background":"#3a302a","on-error-container":"#7a1a10","outline-variant":"#d8d0c8","on-error":"#ffffff","primary":"#c2652a","on-primary-container":"#fbe8d8","surface-bright":"#faf5ee","primary-container":"#e08850","tertiary-container":"#d47070","primary-fixed":"#fbe8d8","inverse-surface":"#3a302a","primary-fixed-dim":"#f0a878","surface-dim":"#dcd6cc","outline":"#9a9088","background":"#faf5ee","tertiary-fixed":"#fce0e0","error-container":"#fce4e0","on-primary":"#ffffff","surface-container-low":"#f6f0e8","on-surface-variant":"#605850","secondary":"#78706a","on-surface":"#3a302a","surface":"#faf5ee","error":"#c0392b","surface-container-lowest":"#ffffff" },
    borderRadius: { DEFAULT:"0.25rem", lg:"0.5rem", xl:"0.75rem", full:"9999px" },
    fontFamily: { headline:["EB Garamond","serif"], body:["Manrope","sans-serif"], label:["Manrope","sans-serif"] },
  } },
};
