export default defineNuxtConfig({
  compatibilityDate: '2026-11-17',
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: '信息通信技术协会 · 保持好奇，创造可能',
      meta: [
        { name: 'description', content: '信息工程学院直属协会。一起探索 Web 开发、计算机技术与创意实践，在分享与协作中，把想法变成现实。' },
        { name: 'theme-color', content: '#111310' }
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]
    },
    pageTransition: { name: 'page', mode: 'out-in' }
  },
  typescript: { strict: true },
  routeRules: { '/': { prerender: true } }
})
