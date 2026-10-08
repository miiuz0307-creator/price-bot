/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#1B3834',
    tint: '#249D70',

    // Core surfaces
    background: '#F8F7F2',
    foreground: '#1B3834',

    // Cards / elevated surfaces
    card: '#FFFEFC',
    cardForeground: '#1B3834',

    // Primary action color (buttons, links, active states)
    primary: '#249D70',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#EDE9E1',
    secondaryForeground: '#1B3834',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#EDE9E1',
    mutedForeground: '#66807A',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#F7B84B',
    accentForeground: '#1B3834',

    // Destructive actions (delete, error states)
    destructive: '#C74640',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#DDD7CA',
    input: '#DDD7CA',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 12,
};

export default colors;
