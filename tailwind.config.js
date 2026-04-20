/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 暖系专业调色板
        paper: {
          50: "#FDFBF7",   // 主背景 暖米白
          100: "#F8F3EA",  // 浅卡片
          200: "#EFE7D5",  // 边界
          300: "#E0D4B8",  // 分隔强
        },
        ink: {
          900: "#1F1B16",  // 主文字
          700: "#3D3730",  // 次文字
          500: "#6B6357",  // 弱文字
          400: "#8B8272",  // 极弱
        },
        amber: {
          DEFAULT: "#C8941F",
          dark: "#A77B14",
          light: "#E5B547",
          soft: "#F7E9C6",
        },
        moss: "#5A7A47",     // 成功 苔绿
        ochre: "#C97B3E",    // 警告 赭石
        clay: "#B04D3F",     // 错误 陶土
      },
      fontFamily: {
        sans: [
          "PingFang SC",
          "Microsoft YaHei",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        serif: ["Source Han Serif SC", "Songti SC", "Georgia", "serif"],
      },
      boxShadow: {
        soft: "0 1px 3px rgba(50,40,20,0.06), 0 4px 16px rgba(50,40,20,0.04)",
        lifted: "0 4px 12px rgba(50,40,20,0.08), 0 12px 32px rgba(50,40,20,0.06)",
      },
      animation: {
        "fade-in": "fadeIn 0.25s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        "bar-grow": "barGrow 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        barGrow: {
          "0%": { transform: "scaleX(0)", transformOrigin: "left" },
          "100%": { transform: "scaleX(1)", transformOrigin: "left" },
        },
      },
    },
  },
  plugins: [],
};
