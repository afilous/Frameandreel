/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#FFFDF8',
          100: '#FDF9EE',
          200: '#F5F0E8',
          300: '#EDE5D5',
          400: '#D4C9B5',
          500: '#B8A98E',
        },
        burgundy: {
          50: '#FEF2F2',
          100: '#FCE4E4',
          200: '#F0C4C4',
          300: '#D49090',
          400: '#B85555',
          500: '#8B1A1A',
          600: '#6E1515',
          700: '#521010',
          800: '#370B0B',
          900: '#1C0606',
        },
        gold: {
          50: '#FDF9EF',
          100: '#F9F0D6',
          200: '#F0DFAB',
          300: '#E5C97A',
          400: '#C8A951',
          500: '#B8952E',
          600: '#9A7A1E',
          700: '#7A5F16',
          800: '#5C4610',
          900: '#3D2E0A',
        },
        noir: {
          50: '#F5F5F5',
          100: '#E0E0E0',
          200: '#A0A0A0',
          300: '#6B6B6B',
          400: '#4A4A4A',
          500: '#2C1810',
          600: '#241508',
          700: '#1A1008',
          800: '#130B06',
          900: '#0D0704',
        },
      },
      fontFamily: {
        display: ['Playfair Display', 'Georgia', 'serif'],
        body: ['Lora', 'Georgia', 'serif'],
        typewriter: ['Special Elite', 'Courier New', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.8s ease-out forwards',
        'slide-up': 'slideUp 0.6s ease-out forwards',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(30px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
    },
  },
  plugins: [],
}
