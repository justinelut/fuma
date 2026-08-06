/**
 * Tailwind runs only for the hosted Fuma surfaces. `src/styles/hosted.css`
 * deliberately omits Tailwind's preflight so the Instatic builder's CSS
 * modules keep their own base styles.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
