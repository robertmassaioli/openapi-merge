import DefaultTheme from 'vitepress/theme';

// A pass-through custom theme. Its only reason to exist is that
// `.vitepress/theme/` has to have an entry point once anything else lives
// under it -- here, `components/Playground.vue`, imported directly by
// `playground/index.md` rather than registered globally, so nothing else
// needs to change in this file.
export default DefaultTheme;
