// 樣式事先編譯成 assets/tailwind.css（修改 index.html 的 class 後請執行 npm run build:css）
module.exports = {
    content: ['./index.html'],
    theme: {
        extend: {
            // 全站字級整體放大一級；最小的 xs 再放大一點，楷體小字才看得清楚（座號按鈕的字級另外依格子大小自動計算，不受影響）
            fontSize: {
                xs: ['0.9375rem', { lineHeight: '1.3rem' }],
                sm: ['1rem', { lineHeight: '1.5rem' }],
                base: ['1.125rem', { lineHeight: '1.75rem' }],
                lg: ['1.25rem', { lineHeight: '1.75rem' }],
                xl: ['1.375rem', { lineHeight: '1.875rem' }],
                '2xl': ['1.625rem', { lineHeight: '2rem' }]
            }
        }
    }
};
