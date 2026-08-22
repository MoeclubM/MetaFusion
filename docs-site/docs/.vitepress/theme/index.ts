import DefaultTheme from 'vitepress/theme';

export default {
  extends: DefaultTheme,
  enhanceApp() {
    if (typeof window !== 'undefined') {
      window.addEventListener(
        'click',
        (e) => {
          const target = (e.target as HTMLElement).closest('a');
          if (!target) return;
          const text = target.textContent?.trim();
          const href = target.getAttribute('href');
          if (text === '返回主站' || href === '/' || href === 'http://localhost/' || href === 'http://localhost') {
            e.preventDefault();
            e.stopPropagation();
            window.location.href = '/';
          }
        },
        true
      );
    }
  }
};
